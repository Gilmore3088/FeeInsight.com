import type { sql } from "@/lib/data-store/connection";
import {
  countUnpostedOlderThan,
  listUnscoredPosted,
  markContentDraftUnmeasured,
  queueSchemaReady,
  setContentDraftScore,
  type ContentDraft,
} from "@/lib/data-store/content-drafts";
import { countTrackedOutcomes, touchSchemaReady } from "@/lib/data-store/marketing-touches";

type SqlTag = typeof sql;

/**
 * Weekly scoring of the queue (growth-os BUILD-PLAN 1.12), step `growth-score`. Free and
 * deterministic: no model call, nothing posted or sent.
 *
 * Each posted item with no score, posted at least `SCORE_AFTER_DAYS` ago, is measured over the
 * `SCORE_AFTER_DAYS` days after it was posted, from data the app really records:
 *   - tracked visits: `marketing_touches` sessions that landed from its link
 *     (same `utm_campaign` and `utm_content`);
 *   - leads: `leads` whose first tracked source was that link (`first_utm_campaign`/`content`).
 * The score written to `content_drafts.score` is the tracked visit count; the lead count sits
 * beside it in the step result.
 *
 * Where no measure exists, the score stays null and the step result says why, item by item:
 * email opens and clicks are not read into the app for queue items, PRs have no before-and-after
 * count yet (BUILD-PLAN 2.16), and an item without a tagged link can't be told apart from other
 * traffic. Nothing is estimated. Such an item gets `scored_at` with a null score, so it is
 * reported once rather than every week (clear `scored_at` to re-check it once a measure exists).
 * A missing touches table is not a verdict on the item: it stays in line for next week.
 * Items never posted are counted, not scored.
 */

export const SCORE_AFTER_DAYS = 7;
/** Items scored per run; the rest wait for next week. */
export const SCORE_BATCH = 200;
const DAY_MS = 86_400_000;

export const NO_MEASURE_REASONS = {
  email: "Email opens and clicks stay in MailerLite and are not read into the app for queue items; no score.",
  pull_request: "No before-and-after count exists for pull requests yet (BUILD-PLAN 2.16); no score.",
  no_link: "No tracked link (utm_campaign and utm_content) in the item, so its visits can't be told apart; no score.",
  no_tables: "marketing_touches or the leads.first_utm_* columns are missing (migration 20270110000022); no score.",
} as const;

export type Measure = { kind: "tracked_link"; campaign: string; content: string } | { kind: "none"; reason: string };

function utmFrom(url: string): { campaign: string; content: string } | null {
  try {
    const parsed = new URL(url);
    const campaign = parsed.searchParams.get("utm_campaign")?.trim();
    const content = parsed.searchParams.get("utm_content")?.trim();
    return campaign && content ? { campaign, content } : null;
  } catch {
    return null;
  }
}

/** The tagged link an item sends people to: its stored `facts.link`, else the first tagged URL in its text. */
export function trackedLinkOf(draft: Pick<ContentDraft, "facts" | "caption">): { campaign: string; content: string } | null {
  const link = typeof draft.facts?.link === "string" ? utmFrom(draft.facts.link) : null;
  if (link) return link;
  for (const match of draft.caption.matchAll(/https?:\/\/[^\s)>"']+/g)) {
    const found = utmFrom(match[0]);
    if (found) return found;
  }
  return null;
}

/** What can measure an item of this kind, or why nothing can. */
export function measureFor(draft: Pick<ContentDraft, "kind" | "facts" | "caption">): Measure {
  if (draft.kind === "email" || draft.kind === "outreach_email") return { kind: "none", reason: NO_MEASURE_REASONS.email };
  if (draft.kind === "pull_request") return { kind: "none", reason: NO_MEASURE_REASONS.pull_request };
  const link = trackedLinkOf(draft);
  return link ? { kind: "tracked_link", ...link } : { kind: "none", reason: NO_MEASURE_REASONS.no_link };
}

/** The date an item went out: when it was marked posted (older rows: when it was reviewed). */
export function postedAtOf(draft: Pick<ContentDraft, "postedAt" | "reviewedAt" | "createdAt">): Date {
  return new Date(draft.postedAt ?? draft.reviewedAt ?? draft.createdAt);
}

export interface ScoredItem {
  draftId: number;
  agent: string;
  kind: string;
  title: string;
  campaign: string;
  content: string;
  windowFrom: string;
  windowTo: string;
  visits: number;
  leads: number;
  score: number;
}

export interface UnscoredItem {
  draftId: number;
  agent: string;
  kind: string;
  title: string;
  reason: string;
}

export interface GrowthScoreResult {
  schemaReady: boolean;
  dryRun: boolean;
  checked: number;
  scored: ScoredItem[];
  unscored: UnscoredItem[];
  /** Items older than the window that were never posted, by status: nothing to score yet. */
  notPosted: Record<string, number>;
  reason: string | null;
}

export async function runGrowthScore(input: { db: SqlTag; runId: number | null; dryRun: boolean }): Promise<GrowthScoreResult> {
  const result: GrowthScoreResult = {
    schemaReady: false,
    dryRun: input.dryRun,
    checked: 0,
    scored: [],
    unscored: [],
    notPosted: {},
    reason: null,
  };
  if (!(await queueSchemaReady(input.db))) {
    return { ...result, reason: "content_drafts has no score columns yet (migration 20270110000025)" };
  }
  result.schemaReady = true;
  const touchesReady = await touchSchemaReady(input.db);
  const items = await listUnscoredPosted(SCORE_AFTER_DAYS, SCORE_BATCH, input.db);
  result.checked = items.length;
  result.notPosted = await countUnpostedOlderThan(SCORE_AFTER_DAYS, input.db);

  for (const draft of items) {
    const who = { draftId: draft.id, agent: draft.agent, kind: draft.kind, title: draft.title };
    const measure = measureFor(draft);
    if (measure.kind === "none") {
      // Checked once: score stays null, the reason goes in this step's event.
      if (!input.dryRun) await markContentDraftUnmeasured(draft.id, input.db);
      result.unscored.push({ ...who, reason: measure.reason });
      continue;
    }
    if (!touchesReady) {
      result.unscored.push({ ...who, reason: NO_MEASURE_REASONS.no_tables });
      continue;
    }
    const from = postedAtOf(draft);
    const to = new Date(from.getTime() + SCORE_AFTER_DAYS * DAY_MS);
    const { visits, leads } = await countTrackedOutcomes(measure.campaign, measure.content, from, to, input.db);
    if (!input.dryRun) await setContentDraftScore(draft.id, visits, input.db);
    result.scored.push({
      ...who,
      campaign: measure.campaign,
      content: measure.content,
      windowFrom: from.toISOString(),
      windowTo: to.toISOString(),
      visits,
      leads,
      score: visits,
    });
  }
  return result;
}

export function summarizeGrowthScore(result: GrowthScoreResult): string {
  if (!result.schemaReady) return `Scored nothing: ${result.reason ?? "queue not ready"}.`;
  if (result.checked === 0) return "No posted item is due a score this week.";
  const visits = result.scored.reduce((sum, item) => sum + item.visits, 0);
  const leads = result.scored.reduce((sum, item) => sum + item.leads, 0);
  const parts = [
    `${result.dryRun ? "Would score" : "Scored"} ${result.scored.length} of ${result.checked} posted item${result.checked === 1 ? "" : "s"}`
      + (result.scored.length ? ` (${visits} tracked visit${visits === 1 ? "" : "s"}, ${leads} lead${leads === 1 ? "" : "s"})` : ""),
  ];
  if (result.unscored.length) parts.push(`${result.unscored.length} left unscored with no measure; reasons are in the step result`);
  return `${parts.join("; ")}.`;
}
