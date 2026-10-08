import { CONTACT_EMAIL, SITE_DOMAIN } from "@/lib/constants";
import type { sql } from "@/lib/data-store/connection";
import { findRecentQueueItem, insertContentDraft, queueSchemaReady } from "@/lib/data-store/content-drafts";
import { channelForKind, GROWTH_AGENTS, isGrowthAgent, isQueueKind, QUEUE_KINDS, type GrowthAgent, type QueueKind } from "./roster";

type SqlTag = typeof sql;

/**
 * Intake (growth-os BUILD-PLAN 1.8): a scheduled Claude Code session files a draft or a PR it
 * opened into the queue (`content_drafts`) through `POST /api/admin/growth/intake`. The route
 * starts a growth run with one `growth-intake` step, so every filing is on the run ledger.
 * Nothing is posted or sent: the item waits for James like every other draft.
 *
 * An item carries only what the queue needs: who made it, what it is, a title, the text and,
 * for a code change, the PR link. No recipient, contact or other personal data field exists,
 * unknown fields are refused, and text naming an email address outside our own domains is
 * refused.
 */

export const INTAKE_FIELDS = ["agent", "kind", "title", "body", "pr_url", "subject_key"] as const;
export const INTAKE_TITLE_MAX = 200;
export const INTAKE_BODY_MAX = 20_000;
export const INTAKE_SUBJECT_MAX = 200;
/** A filing with the same agent, kind and subject inside this window is not queued again. */
export const INTAKE_REPEAT_DAYS = 30;
/** Addresses that may appear in a draft: our own (the contact address's domain and the site's). */
const OWN_EMAIL_DOMAINS = [CONTACT_EMAIL.split("@")[1].toLowerCase(), SITE_DOMAIN.toLowerCase()];
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const SUBJECT_KEY = /^[a-z0-9][a-z0-9:._/-]*$/;
const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)/gi;

export interface IntakeItem {
  agent: GrowthAgent;
  kind: QueueKind;
  title: string;
  body: string;
  prUrl: string | null;
  /** What it is about, so a retried filing is recognised; defaults to the PR link or the title. */
  subjectKey: string;
}

export type IntakeParse = { ok: true; item: IntakeItem } | { ok: false; errors: string[] };

/** Email addresses in the text that are not ours. */
export function foreignEmailAddresses(text: string): string[] {
  return [...text.matchAll(EMAIL)]
    .filter((match) => !OWN_EMAIL_DOMAINS.some((domain) => match[1].toLowerCase() === domain || match[1].toLowerCase().endsWith(`.${domain}`)))
    .map((match) => match[0]);
}

export function slugSubject(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, INTAKE_SUBJECT_MAX) || "untitled";
}

/** Validates a filing. Returns every problem at once so the session can fix them in one go. */
export function parseIntakeItem(input: unknown): IntakeParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["Body must be a JSON object."] };
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];

  const unknown = Object.keys(raw).filter((key) => !(INTAKE_FIELDS as readonly string[]).includes(key));
  if (unknown.length) errors.push(`Unknown fields (only ${INTAKE_FIELDS.join(", ")} are accepted): ${unknown.join(", ")}.`);

  if (!isGrowthAgent(raw.agent)) errors.push(`agent must be one of ${GROWTH_AGENTS.join(", ")}.`);
  if (!isQueueKind(raw.kind)) errors.push(`kind must be one of ${QUEUE_KINDS.join(", ")}.`);

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) errors.push("title is required.");
  else if (title.length > INTAKE_TITLE_MAX) errors.push(`title is longer than ${INTAKE_TITLE_MAX} characters.`);

  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) errors.push("body is required.");
  else if (body.length > INTAKE_BODY_MAX) errors.push(`body is longer than ${INTAKE_BODY_MAX} characters.`);

  let prUrl: string | null = null;
  if (raw.pr_url !== undefined && raw.pr_url !== null && raw.pr_url !== "") {
    prUrl = typeof raw.pr_url === "string" ? raw.pr_url.trim() : "";
    if (!PR_URL.test(prUrl)) errors.push("pr_url must be a GitHub pull request link (https://github.com/<owner>/<repo>/pull/<number>).");
  }
  if (raw.kind === "pull_request" && !prUrl) errors.push("A pull_request item needs its pr_url.");

  let subjectKey: string | null = null;
  if (raw.subject_key !== undefined && raw.subject_key !== null && raw.subject_key !== "") {
    subjectKey = typeof raw.subject_key === "string" ? raw.subject_key.trim().toLowerCase() : "";
    if (!subjectKey || subjectKey.length > INTAKE_SUBJECT_MAX || !SUBJECT_KEY.test(subjectKey)) {
      errors.push(`subject_key must be up to ${INTAKE_SUBJECT_MAX} lowercase letters, digits and : . _ / -.`);
    }
  }

  const foreign = foreignEmailAddresses(`${title}\n${body}`);
  if (foreign.length) errors.push("The queue holds no personal data: remove the email addresses from the title and body.");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    item: {
      agent: raw.agent as GrowthAgent,
      kind: raw.kind as QueueKind,
      title,
      body,
      prUrl,
      subjectKey: subjectKey ?? prUrl ?? slugSubject(title),
    },
  };
}

/** The step input a parsed item travels in (`agent_run_steps.input_payload.item`). */
export function intakePayload(item: IntakeItem): Record<string, unknown> {
  return {
    agent: item.agent,
    kind: item.kind,
    title: item.title,
    body: item.body,
    pr_url: item.prUrl,
    subject_key: item.subjectKey,
  };
}

export interface IntakeResult {
  schemaReady: boolean;
  dryRun: boolean;
  agent: string | null;
  kind: string | null;
  title: string | null;
  subjectKey: string | null;
  prUrl: string | null;
  draftId: number | null;
  alreadyFiled: boolean;
  errors: string[];
}

/** The `growth-intake` step: re-checks the item and writes it to the queue as a draft. */
export async function runGrowthIntake(input: { db: SqlTag; runId: number | null; item: unknown; dryRun: boolean; now?: Date }): Promise<IntakeResult> {
  const parsed = parseIntakeItem(input.item);
  const base: IntakeResult = {
    schemaReady: false,
    dryRun: input.dryRun,
    agent: null,
    kind: null,
    title: null,
    subjectKey: null,
    prUrl: null,
    draftId: null,
    alreadyFiled: false,
    errors: [],
  };
  if (!parsed.ok) return { ...base, errors: parsed.errors };
  const { item } = parsed;
  const described = { ...base, agent: item.agent, kind: item.kind, title: item.title, subjectKey: item.subjectKey, prUrl: item.prUrl };
  if (!(await queueSchemaReady(input.db))) {
    return { ...described, errors: ["content_drafts has no agent/kind columns yet (migration 20270110000025)."] };
  }
  const ready = { ...described, schemaReady: true };

  const existing = await findRecentQueueItem(item.agent, item.kind, item.subjectKey, INTAKE_REPEAT_DAYS, input.db);
  if (existing !== null) return { ...ready, draftId: existing, alreadyFiled: true };
  if (input.dryRun) return ready;

  const draftId = await insertContentDraft(
    {
      agent: item.agent,
      kind: item.kind,
      prUrl: item.prUrl,
      workflow: `intake:${item.agent}`,
      channel: channelForKind(item.kind),
      subjectKey: item.subjectKey,
      title: item.title,
      caption: item.body,
      facts: { source: "intake" },
      asOf: input.now ?? new Date(),
      agentRunId: input.runId,
    },
    input.db,
  );
  return { ...ready, draftId };
}

export function summarizeGrowthIntake(result: IntakeResult): string {
  if (result.errors.length) return `Filed nothing: ${result.errors.join(" ")}`;
  const what = `${result.agent}'s ${String(result.kind).replace(/_/g, " ")} "${result.title}"`;
  if (result.alreadyFiled) return `Already in the queue as #${result.draftId}: ${what}.`;
  if (result.draftId === null) return `Dry run: would file ${what}.`;
  return `Filed ${what} into the queue as #${result.draftId} for James to review.`;
}
