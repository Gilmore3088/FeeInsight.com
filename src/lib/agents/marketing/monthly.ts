import type { sql } from "@/lib/data-store/connection";
import { recordFeedback, feedbackSchemaReady, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { paidModelCall, paidResponseJson, type PaidMessageCreator } from "@/lib/agents/paid-pass";
import { buildFactBundle, allowedNumbers, pickSpotlightState, readNational, readSpotlightStates, unbackedNumbers, type CoverageStat, type FeeStat } from "./facts";
import { copyProblems, copyText, renderEmail, withMailingAddress, writerPrompt, type EmailCopy } from "./email";
import {
  CAMPAIGN_NAME_PREFIX,
  campaignName,
  formatBrief,
  isLearnable,
  parseCampaignName,
  planMonth,
  scoreCampaign,
  type CampaignResult,
  type MarketingFormatKey,
} from "./formats";
import { STATE_EDITION_FORMAT, nationalAudience } from "./state-edition";
import { whatsNewFor } from "./whats-new";
import {
  activeSubscriberCount,
  createAbDraft,
  getDraftContent,
  listCampaigns,
  mailerLiteConfigured,
  sendCampaignNow,
  updateDraftHtml,
  type AgentCampaign,
  type FetchLike,
} from "./mailerlite-campaigns";

type SqlTag = typeof sql;

/**
 * Hamilton's monthly marketing loop, as three run steps:
 *   marketing-score (free)  score last month's sent campaigns, store results and a market snapshot
 *   marketing-write (paid)  plan this month's formats from past results, write, check, draft in MailerLite
 *   marketing-send  (free)  run only after James approves the month in /admin/customers/marketing
 * Results and lessons go to the shared learning store (`pipeline_feedback`), about_stage
 * "publish", about_strategy "marketing.<format>". Nothing is ever sent without approval.
 */

export const writerModel = () => process.env.MARKETING_WRITER_MODEL?.trim() || "claude-sonnet-5-5";

export function mailingAddress(): string | null {
  return process.env.MARKETING_MAILING_ADDRESS?.trim() || null;
}

/** The month a run works on, as YYYY-MM (UTC). */
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- score

export interface ScoreResult {
  scored: number;
  learnable: number;
  results: Array<CampaignResult & { id: string; score: number; winnerSubject: string | null }>;
  snapshotStored: boolean;
  skipped: string | null;
}

export async function runMarketingScore({
  db,
  runId,
  month,
  dryRun = false,
  fetcher,
}: {
  db: SqlTag;
  runId: number;
  month: string;
  dryRun?: boolean;
  fetcher?: FetchLike;
}): Promise<ScoreResult> {
  const empty: ScoreResult = { scored: 0, learnable: 0, results: [], snapshotStored: false, skipped: null };
  if (!(await feedbackSchemaReady(db))) return { ...empty, skipped: "pipeline_feedback is not migrated yet" };
  if (!mailerLiteConfigured()) return { ...empty, skipped: "MAILERLITE_API_KEY is not set" };

  const sent = await listCampaigns("sent", CAMPAIGN_NAME_PREFIX, fetcher);
  const results = sent
    .map((campaign) => {
      const parsed = parseCampaignName(campaign.name);
      if (!parsed) return null;
      const result: CampaignResult = {
        format: parsed.format,
        month: parsed.month,
        recipients: campaign.recipients,
        openRate: campaign.openRate,
        clickRate: campaign.clickRate,
        unsubscribeRate: campaign.unsubscribeRate,
      };
      return { ...result, id: campaign.id, score: scoreCampaign(result), winnerSubject: campaign.winnerSubject, subjects: campaign.subjects };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const rows: FeedbackRow[] = results.map((result) => ({
    aboutStage: "publish",
    aboutStrategy: `marketing.${result.format}`,
    signal: result.score >= 50 ? "right" : "wrong",
    kind: "campaign_result",
    reportedBy: "hamilton",
    checkName: "hamilton.marketing_score",
    // Small sends teach little: they count, but at a fraction of a full result.
    weight: isLearnable(result) ? 1 : 0.1,
    evidence: {
      campaign_id: result.id,
      month: result.month,
      format: result.format,
      recipients: result.recipients,
      open_rate: result.openRate,
      click_rate: result.clickRate,
      unsubscribe_rate: result.unsubscribeRate,
      score: result.score,
      learnable: isLearnable(result),
      subjects: result.subjects,
      winner_subject: result.winnerSubject,
    },
    runId,
    dedupeKey: `hamilton.marketing:campaign:${result.id}`,
  }));

  // This month's national figures, so next month's email can say how coverage grew.
  const national = await readNational();
  rows.push({
    aboutStage: "publish",
    aboutStrategy: "marketing.snapshot",
    signal: "right",
    kind: "market_snapshot",
    reportedBy: "hamilton",
    checkName: "hamilton.marketing_snapshot",
    weight: 0,
    evidence: { month, national },
    runId,
    dedupeKey: `hamilton.marketing:snapshot:${month}`,
  });

  if (!dryRun) await recordFeedback(db, rows);
  return {
    scored: results.length,
    learnable: results.filter(isLearnable).length,
    results: results.map((row) => ({ ...row, subjects: undefined })),
    snapshotStored: !dryRun,
    skipped: null,
  };
}

// ---------------------------------------------------------------- write

interface HistoryRow {
  result: CampaignResult;
  score: number;
  winnerSubject: string | null;
}

async function readHistory(db: SqlTag): Promise<HistoryRow[]> {
  const rows = await db`
    SELECT evidence FROM pipeline_feedback
     WHERE reported_by = 'hamilton' AND kind = 'campaign_result'
     ORDER BY created_at DESC LIMIT 60`;
  return rows.map((row) => {
    const e = (typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence) as Record<string, unknown>;
    return {
      result: {
        format: String(e.format ?? ""),
        month: String(e.month ?? ""),
        recipients: Number(e.recipients ?? 0),
        openRate: Number(e.open_rate ?? 0),
        clickRate: Number(e.click_rate ?? 0),
        unsubscribeRate: Number(e.unsubscribe_rate ?? 0),
      },
      score: Number(e.score ?? 0),
      winnerSubject: e.winner_subject ? String(e.winner_subject) : null,
    };
  });
}

async function readRecentSpotlightStates(db: SqlTag): Promise<string[]> {
  const rows = await db`
    SELECT evidence->>'state_code' AS state_code FROM pipeline_feedback
     WHERE reported_by = 'hamilton' AND kind = 'campaign_plan' AND evidence ? 'state_code'
     ORDER BY created_at DESC LIMIT 6`;
  return rows.map((row) => String(row.state_code ?? "")).filter(Boolean);
}

async function readPreviousSnapshot(db: SqlTag, month: string): Promise<CoverageStat[] | null> {
  const [row] = await db`
    SELECT evidence FROM pipeline_feedback
     WHERE reported_by = 'hamilton' AND kind = 'market_snapshot'
       AND dedupe_key < ${`hamilton.marketing:snapshot:${month}`}
       AND dedupe_key LIKE 'hamilton.marketing:snapshot:%'
     ORDER BY dedupe_key DESC LIMIT 1`;
  if (!row) return null;
  const e = (typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence) as { national?: FeeStat[] };
  return Array.isArray(e.national) ? e.national.map((f) => ({ key: f.key, institutions: f.institutions })) : null;
}

/** Plain-language lessons from learnable results: the best and worst, with what won. */
export function lessonsFrom(history: HistoryRow[]): string[] {
  const learnable = history.filter((row) => isLearnable(row.result)).sort((a, b) => b.score - a.score);
  const describe = (row: HistoryRow) =>
    `${row.result.format} (${row.result.month}) scored ${row.score}: opens ${pct(row.result.openRate)}, clicks ${pct(row.result.clickRate)}, unsubscribes ${pct(row.result.unsubscribeRate)}${row.winnerSubject ? `; winning subject "${row.winnerSubject}"` : ""}.`;
  const best = learnable.slice(0, 2).map((row) => `Worked: ${describe(row)}`);
  const worst = learnable.length > 2 ? learnable.slice(-2).map((row) => `Fell flat: ${describe(row)}`) : [];
  return [...best, ...worst];
}

export interface WriteResult {
  month: string;
  planned: MarketingFormatKey[];
  drafts: Array<{ format: string; campaignId: string; name: string; subjects: string[]; previewUrl: string | null }>;
  failures: Array<{ format: string; reason: string }>;
  alreadyDrafted: boolean;
  costMicrousd: number;
  groupSize: number | null;
  /** States whose readers get the national email because their state has no edition yet. */
  thinStates: string[];
  addressMissing: boolean;
  skipped: string | null;
}

async function writeOne(
  {
    runId,
    format,
    prompt,
    allowed,
    create,
  }: { runId: number; format: MarketingFormatKey; prompt: string; allowed: Set<string>; create?: PaidMessageCreator },
): Promise<{ copy: EmailCopy | null; problems: string[]; costMicrousd: number }> {
  let problems: string[] = [];
  let cost = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const content = attempt === 1
      ? prompt
      : `${prompt}\n\nYour last draft was rejected for: ${problems.join("; ")}. Fix exactly that and reply with JSON only.`;
    const { message, costMicrousd } = await paidModelCall({
      agent: "growth",
      operation: "marketing_write",
      runId,
      create,
      params: { model: writerModel(), max_tokens: 2_000, messages: [{ role: "user", content }] },
      metadata: { format, attempt },
    });
    cost += costMicrousd;
    const copy = paidResponseJson<EmailCopy>(message);
    if (!copy) {
      problems = ["the reply was not valid JSON"];
      continue;
    }
    copy.sections = Array.isArray(copy.sections) ? copy.sections : [];
    // Signup promises one table every month, so an email never goes out without one.
    if (!["national", "state", "charter"].includes(copy.table)) copy.table = "national";
    const unbacked = unbackedNumbers(copyText(copy), allowed);
    problems = [...copyProblems(copy), ...(unbacked.length ? [`numbers not in FACTS: ${unbacked.join(", ")}`] : [])];
    if (problems.length === 0) return { copy, problems, costMicrousd: cost };
  }
  return { copy: null, problems, costMicrousd: cost };
}

export async function runMarketingWrite({
  db,
  runId,
  month,
  dryRun = false,
  fetcher,
  create,
}: {
  db: SqlTag;
  runId: number;
  month: string;
  dryRun?: boolean;
  fetcher?: FetchLike;
  create?: PaidMessageCreator;
}): Promise<WriteResult> {
  const base: WriteResult = {
    month,
    planned: [],
    drafts: [],
    failures: [],
    alreadyDrafted: false,
    costMicrousd: 0,
    groupSize: null,
    thinStates: [],
    addressMissing: !mailingAddress(),
    skipped: null,
  };
  if (!(await feedbackSchemaReady(db))) return { ...base, skipped: "pipeline_feedback is not migrated yet" };
  if (!mailerLiteConfigured()) return { ...base, skipped: "MAILERLITE_API_KEY is not set" };

  // State editions are drafted by their own step; only the rotating formats count here.
  const existing = (await listCampaigns("draft", `${CAMPAIGN_NAME_PREFIX} ${month} `, fetcher))
    .filter((campaign) => parseCampaignName(campaign.name)?.format !== STATE_EDITION_FORMAT);
  const audience = await nationalAudience(db, month, { fetcher, dryRun });
  const groupIds = audience.groupIds;
  base.thinStates = audience.thinStates;
  base.groupSize = await activeSubscriberCount(groupIds, fetcher);
  if (existing.length) {
    return {
      ...base,
      alreadyDrafted: true,
      drafts: existing.map((c) => ({ format: parseCampaignName(c.name)?.format ?? "", campaignId: c.id, name: c.name, subjects: c.subjects, previewUrl: c.previewUrl })),
    };
  }

  const history = await readHistory(db);
  const planned = planMonth(month, history.map((row) => row.result));
  const states = planned.includes("state_spotlight") ? await readSpotlightStates(db) : [];
  const recentStates = await readRecentSpotlightStates(db);
  const stateCode = pickSpotlightState(states, recentStates);
  const bundle = await buildFactBundle(db, {
    month,
    previousCoverage: await readPreviousSnapshot(db, month),
    stateCode: planned.includes("state_spotlight") ? stateCode : null,
  });
  const allowed = allowedNumbers(bundle);
  allowed.add(String(Number(bundle.asOf.slice(8, 10))));
  const lessons = lessonsFrom(history);
  const result: WriteResult = { ...base, planned };

  for (const format of planned) {
    const brief = formatBrief(format)?.brief ?? "";
    if (dryRun) {
      result.failures.push({ format, reason: "dry run: not written" });
      continue;
    }
    try {
      const written = await writeOne({ runId, format, prompt: writerPrompt({ format, brief, bundle, lessons }), allowed, create });
      result.costMicrousd += written.costMicrousd;
      if (!written.copy) {
        result.failures.push({ format, reason: `rejected twice: ${written.problems.join("; ")}` });
        continue;
      }
      const html = renderEmail(written.copy, bundle, format, mailingAddress(), whatsNewFor(month));
      const draft: AgentCampaign = await createAbDraft(
        {
          name: campaignName(month, format, written.copy.headline.slice(0, 60)),
          subjectA: written.copy.subjectA,
          subjectB: written.copy.subjectB,
          html,
          groupIds,
        },
        fetcher,
      );
      result.drafts.push({ format, campaignId: draft.id, name: draft.name, subjects: [written.copy.subjectA, written.copy.subjectB], previewUrl: draft.previewUrl });
      if (format === "state_spotlight" && bundle.state) {
        // Remember which state ran, so the rotation moves on next time.
        await recordFeedback(db, [{
          aboutStage: "publish",
          aboutStrategy: "marketing.state_spotlight",
          signal: "right",
          kind: "campaign_plan",
          reportedBy: "hamilton",
          checkName: "hamilton.marketing_write",
          weight: 0,
          evidence: { campaign_id: draft.id, month, format, state_code: bundle.state.code },
          runId,
          dedupeKey: `hamilton.marketing:plan:${draft.id}`,
        }]);
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const reason = error instanceof Error ? error.message : String(error);
      result.failures.push({ format, reason });
      if (["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"].includes(name)) break;
    }
  }
  return result;
}

// ---------------------------------------------------------------- send

export interface SendResult {
  month: string;
  sent: Array<{ campaignId: string; name: string }>;
  failures: Array<{ campaignId: string; reason: string }>;
  refused: string | null;
}

/** Sends the month's drafts. Called only from the run James starts by approving the month. */
export async function runMarketingSend({ month, fetcher }: { month: string; fetcher?: FetchLike }): Promise<SendResult> {
  const result: SendResult = { month, sent: [], failures: [], refused: null };
  const address = mailingAddress();
  if (!address) {
    return { ...result, refused: "MARKETING_MAILING_ADDRESS is not set; marketing email needs a postal address in the footer." };
  }
  if (!mailerLiteConfigured()) return { ...result, refused: "MAILERLITE_API_KEY is not set." };
  const drafts = await listCampaigns("draft", `${CAMPAIGN_NAME_PREFIX} ${month} `, fetcher);
  if (!drafts.length) return { ...result, refused: `No ${month} drafts to send.` };
  for (const draft of drafts) {
    try {
      // Drafts written before the address was set leave that footer line out; add it before sending.
      const content = await getDraftContent(draft.id, fetcher);
      const html = withMailingAddress(content.html, address);
      if (!html) {
        result.failures.push({ campaignId: draft.id, reason: "no unsubscribe link to put the mailing address beside; not sent" });
        continue;
      }
      if (html !== content.html) await updateDraftHtml(draft.id, content, html, fetcher);
      await sendCampaignNow(draft.id, fetcher);
      result.sent.push({ campaignId: draft.id, name: draft.name });
    } catch (error) {
      result.failures.push({ campaignId: draft.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

// ---------------------------------------------------------------- summaries

export function summarizeScore(result: ScoreResult): string {
  if (result.skipped) return `Skipped scoring campaigns: ${result.skipped}.`;
  // A dry run stores nothing, so it says what it would have stored.
  const snapshot = result.snapshotStored ? "stored this month's market snapshot" : "would store this month's market snapshot (dry run: nothing saved)";
  if (!result.scored) return `No sent campaigns to score yet; ${snapshot}.`;
  return `Scored ${result.scored} sent campaign${result.scored === 1 ? "" : "s"} (${result.learnable} large enough to learn from); ${snapshot}.`;
}

export function summarizeWrite(result: WriteResult): string {
  if (result.skipped) return `Skipped writing: ${result.skipped}.`;
  if (result.alreadyDrafted) return `${result.month} is already drafted (${result.drafts.length} campaign${result.drafts.length === 1 ? "" : "s"}), waiting for approval.`;
  const parts = [`Drafted ${result.drafts.length} of ${result.planned.length} national ${result.month} email${result.planned.length === 1 ? "" : "s"} (${result.planned.join(", ")}) as A/B subject tests, waiting for James's approval.`];
  if (result.failures.length) parts.push(`Not drafted: ${result.failures.map((f) => `${f.format} (${f.reason})`).join("; ")}.`);
  if (result.addressMissing) parts.push("Sending is blocked until MARKETING_MAILING_ADDRESS is set.");
  if (result.groupSize !== null) parts.push(`It goes to ${result.groupSize} active reader${result.groupSize === 1 ? "" : "s"} without a state edition.`);
  if (result.thinStates.length) parts.push(`Readers in ${result.thinStates.join(", ")} get it because their state has too little data for its own edition.`);
  return parts.join(" ");
}

export function summarizeSend(result: SendResult): string {
  if (result.refused) return `Did not send: ${result.refused}`;
  const failed = result.failures.length ? ` ${result.failures.length} failed: ${result.failures.map((f) => f.reason).join("; ")}.` : "";
  return `Sent ${result.sent.length} approved ${result.month} campaign${result.sent.length === 1 ? "" : "s"}.${failed}`;
}
