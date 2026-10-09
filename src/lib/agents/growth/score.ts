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
import { journeyForInstitution, journeySchemaReady } from "@/lib/data-store/outreach-journey";
import { journeyStage, type JourneyStage } from "@/lib/outreach-journey";
import { JOURNEY_SCORE } from "./score-label";
import { OUTREACH_CAMPAIGN } from "./outreach";
import { searchForScore, summarizeSearch, type SearchResult } from "./search-console";

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
 * An outreach email James sent (marked posted, so its "sent" outcome is recorded) is scored by
 * how far that institution got on the outreach journey in the same window: its snapshot page
 * events from the outreach link and the outcomes James recorded (`journeyStage`). The score is
 * the stage's place on the journey: 1 sent, 2 snapshot opened, 3 engaged with the data,
 * 4 commercial interest, 5 purchase (`JOURNEY_SCORE`).
 *
 * Where no measure exists, the score stays null and the step result says why, item by item:
 * opens and clicks of MailerLite emails are not read into the app for queue items, PRs have no before-and-after
 * count yet (BUILD-PLAN 2.16), and an item without a tagged link can't be told apart from other
 * traffic. Nothing is estimated. Such an item gets `scored_at` with a null score, so it is
 * reported once rather than every week (clear `scored_at` to re-check it once a measure exists).
 * A missing touches table is not a verdict on the item: it stays in line for next week.
 * Items never posted are counted, not scored.
 *
 * After the queue, the step reads Google Search Console (`search-console.ts`) into `search`:
 * clicks, impressions and average position for the 7 days ending 3 days ago (Search Console
 * lags about 3 days) against the 7 days before, and the top 10 pages by clicks. Without
 * `GSC_SERVICE_ACCOUNT_JSON` it records `measured: false` with the reason; a failed API call
 * records the error the same way. It never fails the step and never estimates.
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
  no_institution: "The outreach email names no institution, so its journey can't be read; no score.",
  no_journey_tables: "snapshot_events or outreach_outcomes is missing (migration 20270110000029); no score.",
} as const;

export type Measure =
  | { kind: "tracked_link"; campaign: string; content: string }
  | { kind: "journey"; institutionId: number }
  | { kind: "none"; reason: string };

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
  if (draft.kind === "outreach_email") {
    const institutionId = Number(draft.facts?.institution_id);
    return Number.isInteger(institutionId) && institutionId > 0
      ? { kind: "journey", institutionId }
      : { kind: "none", reason: NO_MEASURE_REASONS.no_institution };
  }
  if (draft.kind === "email") return { kind: "none", reason: NO_MEASURE_REASONS.email };
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
  /** For an outreach email: the furthest journey stage its institution reached in the window. */
  stage?: JourneyStage | null;
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
  /** Search Console this week vs the week before, or why it was not read. */
  search: SearchResult;
}

type QueueResult = Omit<GrowthScoreResult, "search">;

export async function runGrowthScore(input: {
  db: SqlTag;
  runId: number | null;
  dryRun: boolean;
  /** Injectable for tests; defaults to the live Search Console read. */
  readSearch?: () => Promise<SearchResult>;
}): Promise<GrowthScoreResult> {
  const queue = await scoreQueue(input);
  // Read-only, so a dry run reads it too. searchForScore never throws.
  const search = await (input.readSearch ?? (() => searchForScore()))();
  return { ...queue, search };
}

async function scoreQueue(input: { db: SqlTag; runId: number | null; dryRun: boolean }): Promise<QueueResult> {
  const result: QueueResult = {
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
  const journeyReady = await journeySchemaReady(input.db);
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
    const from = postedAtOf(draft);
    const to = new Date(from.getTime() + SCORE_AFTER_DAYS * DAY_MS);
    if (measure.kind === "journey") {
      if (!journeyReady) {
        result.unscored.push({ ...who, reason: NO_MEASURE_REASONS.no_journey_tables });
        continue;
      }
      const journey = await journeyForInstitution(measure.institutionId, OUTREACH_CAMPAIGN, from, to, input.db);
      const stage = journeyStage(journey.events, journey.outcomes);
      const score = stage ? JOURNEY_SCORE[stage] : 0;
      if (!input.dryRun) await setContentDraftScore(draft.id, score, input.db);
      result.scored.push({
        ...who,
        campaign: OUTREACH_CAMPAIGN,
        content: `inst-${measure.institutionId}`,
        windowFrom: from.toISOString(),
        windowTo: to.toISOString(),
        visits: journey.events.filter((event) => event === "opened").length,
        leads: 0,
        score,
        stage,
      });
      continue;
    }
    if (!touchesReady) {
      result.unscored.push({ ...who, reason: NO_MEASURE_REASONS.no_tables });
      continue;
    }
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
  return `${summarizeQueue(result)} ${summarizeSearch(result.search)}`;
}

function summarizeQueue(result: QueueResult): string {
  if (!result.schemaReady) return `Scored nothing: ${result.reason ?? "queue not ready"}.`;
  if (result.checked === 0) return "No posted item is due a score this week.";
  const linked = result.scored.filter((item) => item.stage === undefined);
  const outreach = result.scored.filter((item) => item.stage !== undefined);
  const visits = linked.reduce((sum, item) => sum + item.visits, 0);
  const leads = linked.reduce((sum, item) => sum + item.leads, 0);
  const answered = outreach.filter((item) => item.score >= 4).length;
  const counts = [
    linked.length ? `${visits} tracked visit${visits === 1 ? "" : "s"}, ${leads} lead${leads === 1 ? "" : "s"}` : null,
    outreach.length ? `${outreach.length} outreach email${outreach.length === 1 ? "" : "s"}, ${answered} reaching commercial interest` : null,
  ].filter(Boolean);
  const parts = [
    `${result.dryRun ? "Would score" : "Scored"} ${result.scored.length} of ${result.checked} posted item${result.checked === 1 ? "" : "s"}`
      + (counts.length ? ` (${counts.join("; ")})` : ""),
  ];
  if (result.unscored.length) parts.push(`${result.unscored.length} left unscored with no measure; reasons are in the step result`);
  return `${parts.join("; ")}.`;
}

