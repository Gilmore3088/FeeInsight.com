import { sql } from "@/lib/data-store/connection";
import { computePercentile } from "@/lib/data-store/fees";
import { STATS_ROW_FILTER } from "@/lib/data-store/fee-stats";
import { contentSchemaReady, insertContentDraft, recentSubjects } from "@/lib/data-store/content-drafts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import {
  asOfLabel,
  captionWithCta,
  freeReportLink,
  metroLabel,
  summarizeMarkets,
  type MarketRow,
  type MarketSpread,
} from "./market-spread";
import { checkSpreadEnds } from "./end-check";

/**
 * W3 fee depth at work (every other Friday, free, no model). Shows how a banking
 * professional uses a full fee schedule: one use case from a rotating list, set in the
 * metro whose local schedules carry the most fee types. The card is a competitor grid of
 * the fees local institutions publish most, each with its local range. Never posts.
 *
 * James, Oct 7 2026: no fee-change content (catalog changes mostly reflect loading, not
 * price moves); show the depth of the data and how a banker uses it.
 */

type SqlTag = typeof sql;

export const FEE_DEPTH_WORKFLOW = "w3-fee-depth";
/** A schedule with at least this many fee types counts as a full schedule. */
export const FULL_SCHEDULE_TYPES = 15;
/** Fewest full schedules a metro needs before it is featured. */
export const MIN_FULL_SCHEDULES = 10;
/** Rows on the card's competitor grid. */
export const GRID_ROWS = 8;
/** Fewest institutions behind one grid row. */
export const MIN_GRID_INSTITUTIONS = 5;
export const REPEAT_WINDOW_DAYS = 56;
/** Drafted every other week: a run within this many days of the last draft skips. */
export const CADENCE_DAYS = 10;

export interface UseCase {
  key: string;
  label: string;
  /** Opening line; `{place}` is replaced with the metro label. No numbers. */
  opener: string;
  /** How Hamilton fits the job. Says what it does, never what it can't; no numbers. */
  hamilton: string;
}

export const USE_CASES: readonly UseCase[] = [
  {
    key: "pricing-committee",
    label: "Pricing committee prep",
    opener: "Pricing committee prep in the {place} area starts with what every local competitor publishes, fee by fee.",
    hamilton: "In Hamilton, a pricing team sets its own schedule beside each competitor's before the meeting, with its peers, state and Fed district alongside.",
  },
  {
    key: "account-launch",
    label: "Launching a new checking account",
    opener: "Before a new checking account launches in the {place} area, the product team needs the local prices for every fee that comes with it.",
    hamilton: "In Hamilton, the team checks each fee on the new account against local competitors and asset-size peers in one view.",
  },
  {
    key: "competitor-review",
    label: "Annual competitor review",
    opener: "An annual competitor review in the {place} area used to mean collecting fee schedules one PDF at a time.",
    hamilton: "In Hamilton, every local schedule is already read, sorted into comparable fee types and kept current.",
  },
  {
    key: "board-question",
    label: "Answering a board question",
    opener: "When a director asks how your fees compare in the {place} area, the answer needs more than overdraft.",
    hamilton: "Hamilton answers that question in plain language, fee by fee, against the market, peers, state and Fed district.",
  },
  {
    key: "marketing-claim",
    label: "Checking a lower-fees claim",
    opener: "Before a campaign in the {place} area says your fees are lower, marketing and compliance need each competitor's published price for the fees in the ad.",
    hamilton: "In Hamilton, the team checks each fee in the claim against every local competitor's schedule, with the source for each figure.",
  },
  {
    key: "schedule-review",
    label: "Annual fee schedule review",
    opener: "An annual fee schedule review in the {place} area goes faster when every competitor's schedule sits in one place.",
    hamilton: "In Hamilton, the review starts from your own schedule, with each fee placed against the local range.",
  },
];

export interface MetroDepth {
  metro: string;
  institutions: number;
  fullSchedules: number;
  medianTypes: number;
  maxTypes: number;
  /** The fees local institutions publish most, each with its local spread. */
  grid: MarketSpread[];
}

export function summarizeDepth(rows: MarketRow[]): MetroDepth[] {
  const byMetro = new Map<string, MarketRow[]>();
  for (const row of rows) {
    const list = byMetro.get(row.cbsa_name);
    if (list) list.push(row);
    else byMetro.set(row.cbsa_name, [row]);
  }
  const metros: MetroDepth[] = [];
  for (const [metro, list] of byMetro) {
    const types = new Map<number, Set<string>>();
    for (const row of list) {
      const id = Number(row.institution_id);
      const set = types.get(id) ?? new Set<string>();
      set.add(row.fee_category);
      types.set(id, set);
    }
    const counts = [...types.values()].map((set) => set.size).sort((a, b) => a - b);
    const grid = summarizeMarkets(list)
      .filter((spread) => spread.institutions >= MIN_GRID_INSTITUTIONS)
      .sort((a, b) => b.institutions - a.institutions || a.feeCategory.localeCompare(b.feeCategory))
      .slice(0, GRID_ROWS);
    metros.push({
      metro,
      institutions: counts.length,
      fullSchedules: counts.filter((count) => count >= FULL_SCHEDULE_TYPES).length,
      medianTypes: Math.round(computePercentile(counts, 50)),
      maxTypes: counts[counts.length - 1] ?? 0,
      grid,
    });
  }
  return metros;
}

export function rankDepthMetros(metros: MetroDepth[], recent: Set<string>): MetroDepth[] {
  const eligible = metros.filter(
    (metro) => metro.fullSchedules >= MIN_FULL_SCHEDULES && metro.grid.length === GRID_ROWS && !recent.has(metro.metro),
  );
  return eligible.sort((a, b) => b.fullSchedules - a.fullSchedules || b.medianTypes - a.medianTypes || a.metro.localeCompare(b.metro));
}

export function pickDepthMetro(metros: MetroDepth[], recent: Set<string>): MetroDepth | null {
  return rankDepthMetros(metros, recent)[0] ?? null;
}

/** Metros tried, best first, before the run gives up on grid ends that won't trace. */
export const DEPTH_END_CHECK_TRIES = 3;

/** The next use case after the ones already drafted, in list order. */
export function nextUseCase(draftedSoFar: number): UseCase {
  return USE_CASES[draftedSoFar % USE_CASES.length];
}

export function draftDepthCaption(metro: MetroDepth, useCase: UseCase, asOf: Date) {
  const place = metroLabel(metro.metro);
  const body = [
    useCase.opener.replace("{place}", place),
    `${metro.fullSchedules} local banks and credit unions publish schedules with ${FULL_SCHEDULE_TYPES} or more fee types. The typical one lists ${metro.medianTypes}. The card shows the ${GRID_ROWS} fees they publish most, with the local range for each.`,
    useCase.hamilton,
    `Source: the Bank Fee Index, built from each institution's own published fee schedule. As of ${asOfLabel(asOf)}.`,
  ].join("\n\n");
  const week = asOf.toISOString().slice(0, 10);
  const link = freeReportLink(FEE_DEPTH_WORKFLOW, `${useCase.key}-${week}`);
  return { title: `${useCase.label}: ${place}`, body, link, caption: captionWithCta(body, link) };
}

export function allowedDepthNumbers(metro: MetroDepth, asOf: Date): Set<string> {
  return new Set(
    [metro.fullSchedules, metro.medianTypes, metro.institutions, metro.maxTypes, FULL_SCHEDULE_TYPES, GRID_ROWS, asOf.getUTCDate(), asOf.getUTCFullYear()].map(String),
  );
}

export async function loadDepthRows(db: SqlTag = sql): Promise<MarketRow[]> {
  const rows = await db.unsafe(
    `SELECT ef.institution_id, s.cbsa_name, ef.fee_category, ef.amount
       FROM published_fee_catalog ef
       JOIN institution_sources s ON s.id = ef.institution_id
      WHERE ${STATS_ROW_FILTER}
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND s.cbsa_name IS NOT NULL`,
  );
  return rows as unknown as MarketRow[];
}

export interface FeeDepthResult {
  schemaReady: boolean;
  dryRun: boolean;
  metrosConsidered: number;
  eligible: number;
  useCase: string | null;
  draftId: number | null;
  /** Metros passed over because a grid end did not trace to its schedule. */
  endsRejected: Array<{ metro: string; failing: number }>;
  picked: { metro: string; fullSchedules: number; medianTypes: number } | null;
  reason: string | null;
}

export async function runFeeDepth(input: { db?: SqlTag; runId: number | null; now?: Date; dryRun: boolean; avoidSubjects?: Iterable<string> }): Promise<FeeDepthResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const base: FeeDepthResult = { schemaReady: false, dryRun: input.dryRun, metrosConsidered: 0, eligible: 0, useCase: null, endsRejected: [], draftId: null, picked: null, reason: null };
  if (!(await contentSchemaReady(db))) return { ...base, reason: "content_drafts table is missing" };

  const depthRows = await loadDepthRows(db);
  const metros = summarizeDepth(depthRows);
  // Featured lately, or skipped by James with a reason (a lesson): neither is drafted again.
  const recent = await recentSubjects(FEE_DEPTH_WORKFLOW, REPEAT_WINDOW_DAYS, db);
  for (const subject of input.avoidSubjects ?? []) recent.add(subject);
  const [{ drafted, lately }] = await db`
    SELECT count(*)::int AS drafted,
           count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${CADENCE_DAYS}::int))::int AS lately
      FROM content_drafts WHERE workflow = ${FEE_DEPTH_WORKFLOW}
  `;
  const useCase = nextUseCase(Number(drafted));
  const result: FeeDepthResult = {
    ...base,
    schemaReady: true,
    metrosConsidered: metros.length,
    eligible: metros.filter((metro) => metro.fullSchedules >= MIN_FULL_SCHEDULES).length,
    useCase: useCase.key,
    endsRejected: [],
  };
  if (Number(lately) > 0) return { ...result, reason: "drafted last week; this one runs every other week" };
  const ranked = rankDepthMetros(metros, recent);
  if (ranked.length === 0) return { ...result, reason: `no metro has ${MIN_FULL_SCHEDULES} full schedules that wasn't featured recently` };
  let pick: MetroDepth | null = null;
  for (const candidate of ranked.slice(0, DEPTH_END_CHECK_TRIES)) {
    let failing = 0;
    for (const row of candidate.grid) {
      const ends = await checkSpreadEnds(db, depthRows, { metro: candidate.metro, feeCategory: row.feeCategory, low: row.low, high: row.high });
      failing += ends.failing.length;
    }
    if (failing === 0) {
      pick = candidate;
      break;
    }
    result.endsRejected.push({ metro: candidate.metro, failing });
  }
  if (!pick) return { ...result, reason: `a low or high end on the grid didn't trace to its own schedule in the top ${result.endsRejected.length} metros` };

  const draft = draftDepthCaption(pick, useCase, now);
  const picked = { metro: pick.metro, fullSchedules: pick.fullSchedules, medianTypes: pick.medianTypes };
  const unbacked = unbackedNumbers(draft.body, allowedDepthNumbers(pick, now));
  if (unbacked.length) return { ...result, picked, reason: `caption carries numbers not in the facts: ${unbacked.join(", ")}` };
  if (input.dryRun) return { ...result, picked, reason: "dry run: nothing written" };

  const draftId = await insertContentDraft(
    {
      workflow: FEE_DEPTH_WORKFLOW,
      subjectKey: pick.metro,
      title: draft.title,
      caption: draft.caption,
      facts: {
        kind: "depth",
        metro: pick.metro,
        metro_label: metroLabel(pick.metro),
        use_case: useCase.key,
        use_case_label: useCase.label,
        institutions: pick.institutions,
        full_schedules: pick.fullSchedules,
        median_types: pick.medianTypes,
        max_types: pick.maxTypes,
        grid: pick.grid.map((row) => ({
          fee_category: row.feeCategory,
          fee_label: getDisplayName(row.feeCategory),
          institutions: row.institutions,
          low: row.low,
          median: row.median,
          high: row.high,
        })),
        method: `published_fee_catalog, sourced rows only; a full schedule has ${FULL_SCHEDULE_TYPES}+ fee types; grid values are one per institution (overdraft at its highest tier), $0 counts; every low and high traced to the institution's own schedule`,
        link: draft.link,
      },
      asOf: now,
      agentRunId: input.runId,
    },
    db,
  );
  return { ...result, picked, draftId };
}

export function summarizeFeeDepth(result: FeeDepthResult): string {
  if (!result.schemaReady) return "Content queue table is missing; nothing drafted.";
  if (result.draftId !== null && result.picked) {
    return `Drafted a fee-depth post (${result.useCase}) for ${metroLabel(result.picked.metro)}: ${result.picked.fullSchedules} full schedules, typical one lists ${result.picked.medianTypes} fee types.`;
  }
  return `No fee-depth post drafted (${result.reason ?? "unknown"}).`;
}

