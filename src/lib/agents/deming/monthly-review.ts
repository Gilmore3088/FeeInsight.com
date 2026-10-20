import { sql } from "@/lib/data-store/connection";
import { SITE_URL } from "@/lib/constants";
import { getLatestAnswerKeyScoreRun, type AnswerKeyScoreRunRow } from "@/lib/data-store/answer-key";
import { incurredProviderUsageSql } from "@/lib/provider-usage-accounting";
import { inSavepoint } from "@/lib/agents/savepoint";
import { OTHER_BANK_DOCUMENT_REASON, UNCONFIRMED_HOST_REASON } from "@/lib/agents/hamilton/other-bank-document";
import { RULES_RECHECK_REASON } from "@/lib/agents/hamilton/rules-recheck";
import { PRODUCT_PAGE_REASON } from "@/lib/agents/hamilton/product-page";
import { BUSINESS_SCHEDULE_REASON } from "@/lib/agents/hamilton/business-schedule";

type SqlTag = typeof sql;

/**
 * Monthly agent review (#1107). The agent reviews of 2026-10-12 (`docs/plans/magellan-review-2026-10-12.md`,
 * `rosetta-review-…`, `knox-review-…`, `hamilton-review-…`) were snapshots of one day. Their core
 * measures live here as named read-only SQL, run once a month by the `deming-monthly-review` step
 * (Atlas's daily scoreboard run, the 1st of the month UTC only), so each agent's page on
 * /admin/agents/health shows this month against last month and against the 2026-10-12 figure.
 *
 * Rules:
 * - Every measure is a SELECT. The step writes nothing but its own ledger row.
 * - A baseline is the figure the review states, or null where it states none. Never a guess.
 * - A measure that fails to read is stored as unknown (null with its error), never as 0, and runs
 *   in its own savepoint so a failed read cannot abort the step's transaction.
 * - A measure that moves the wrong way past its limit raises an alarm in the step summary, on the
 *   page and in the Sunday email. The app has no GitHub access, so it opens no issue itself.
 */

export const MONTHLY_REVIEW_VERSION = 1;
export const MONTHLY_REVIEW_STEP_KEY = "deming-monthly-review";
/** The reviews these baselines come from. */
export const MONTHLY_REVIEW_BASELINE_DATE = "2026-10-12";
/** One slow measure cannot hold the step: its statement times out and it is stored as unknown. */
export const MONTHLY_MEASURE_TIMEOUT_MS = 30_000;
/** Statement timeout for the reads before the measures (last month's review, the answer-key run). */
export const MONTHLY_PREREAD_TIMEOUT_MS = 10_000;
/**
 * The step's whole budget, the reads before the measures included. A measure starts only while
 * it can finish inside it at its statement timeout (every measure is one SELECT; the answer-key
 * measures read the run fetched before them), so the step ends within about this long. Matches
 * `STEP_EXPECTED_MS["deming-monthly-review"]` in run-store, which adds a margin for the ledger.
 */
export const MONTHLY_REVIEW_BUDGET_MS = 110_000;

export const MONTHLY_REVIEW_AGENTS = ["magellan", "rosetta", "knox", "hamilton"] as const;
export type MonthlyReviewAgent = (typeof MONTHLY_REVIEW_AGENTS)[number];

export type MeasureUnit = "count" | "share" | "usd" | "hours";

/**
 * How far a measure may move the wrong way before it alarms: `relative` is a share of the earlier
 * value (0.25 = 25%), `points` an absolute change of a share (0.05 = 5 points). `minDelta` keeps
 * tiny counts (2 → 3) from alarming.
 */
export interface MeasureLimit {
  relative?: number;
  points?: number;
  minDelta?: number;
}

export interface MonthlyMeasure {
  key: string;
  label: string;
  unit: MeasureUnit;
  better: "higher" | "lower";
  limit: MeasureLimit;
  /** The 2026-10-12 review's own figure, or null where the review states none. */
  baseline: number | null;
  /** Where the baseline comes from, and how its window differs from this measure's, if it does. */
  baselineNote: string | null;
  /**
   * What the baseline was measured on, when that can change (the answer-key scorer and cohort).
   * A baseline is compared, and can alarm, only when this month's reading has the same basis.
   */
  baselineBasis?: string | null;
  /**
   * One read-only SELECT. Returns null when there is nothing to measure (for example no paid rows),
   * or a reading with its basis when the number depends on one.
   */
  read: (db: SqlTag, context: MeasureContext) => Promise<number | null | MeasureReading>;
}

export interface MeasureReading {
  value: number | null;
  /** What the number was measured on; two readings compare only when their bases are equal. */
  basis: string | null;
}

/** Reads made once before the measures, shared by the measures that need them. */
export interface MeasureContext {
  /** The newest answer-key score run, through the shared reader's reference-cohort check. */
  answerKey: { run: AnswerKeyScoreRunRow | null; error: string | null };
}

export interface MonthlyAgentDefinition {
  agent: MonthlyReviewAgent;
  name: string;
  tracker: number;
  review: string;
  measures: MonthlyMeasure[];
}

const num = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function one(rows: Promise<Array<Record<string, unknown>>>): Promise<number | null> {
  const [row] = await rows;
  return num(row?.value);
}

/** USD an agent's incurred provider calls cost over the last `days` days. */
function spend(agent: string, days: number) {
  return (db: SqlTag) => one(db`
    SELECT (COALESCE(SUM(estimated_cost_microusd), 0) / 1e6)::numeric(12,2) AS value
      FROM ai_api_usage_events
     WHERE agent_name = ${agent}
       AND ${incurredProviderUsageSql(db)}
       AND created_at >= NOW() - make_interval(days => ${days}::int)
  `);
}

/** Hours of server time the named steps took over the last 7 days. */
function stepHours(stepKeys: readonly string[]) {
  return (db: SqlTag) => one(db`
    SELECT ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM (completed_at - started_at))), 0) / 3600)::numeric, 1) AS value
      FROM agent_run_steps
     WHERE step_key = ANY(${[...stepKeys]}::text[])
       AND started_at >= NOW() - INTERVAL '7 days'
       AND completed_at IS NOT NULL
  `);
}

/** Live fees taken down in the last 7 days whose reason starts with one of `prefixes`. */
function takedowns(prefixes: readonly string[]) {
  const patterns = prefixes.map((prefix) => `${prefix}%`);
  return (db: SqlTag) => one(db`
    SELECT COUNT(*)::int AS value
      FROM published_fee_records
     WHERE rolled_back_at >= NOW() - INTERVAL '7 days'
       AND rolled_back_reason LIKE ANY(${patterns}::text[])
  `);
}

/**
 * One stage's precision or recall from the newest answer-key score at the current scorer version,
 * read through `getLatestAnswerKeyScoreRun`, so a run scored on another reference cohort is not a
 * score: it is stored as unknown. The basis names the scorer version and cohort, so a month scored
 * on a different one is never compared with this one. Pure over the context.
 */
export function answerKeyReading(context: MeasureContext, stage: "knox" | "hamilton", field: "precision" | "recall"): MeasureReading {
  const { run, error } = context.answerKey;
  if (error) throw new Error(`The answer-key score could not be read: ${error}`);
  if (!run) throw new Error("No answer-key score at the current scorer version.");
  if (run.referenceState !== "measured") {
    throw new Error(`The newest answer-key score is not comparable with the current reference cohort (${run.referenceState ?? "unknown"}).`);
  }
  const value = num((run.by_stage[stage] as Record<string, unknown> | undefined)?.[field]);
  if (value == null) throw new Error(`The newest answer-key score has no ${stage} ${field}.`);
  return { value, basis: `answer-key scorer v${run.scorer_version}, cohort ${run.reference?.cohortFingerprint ?? "unknown"}` };
}

function answerKey(stage: "knox" | "hamilton", field: "precision" | "recall") {
  return async (_db: SqlTag, context: MeasureContext) => answerKeyReading(context, stage, field);
}

/** The publish step and its aliases, and the sweeps split out of it after the review (HR3). */
const PUBLISH_STEP_KEYS = ["publish", "publish-index", "publish-context", "publish-sweeps"] as const;

const ANSWER_KEY_NOTE =
  "Answer key of 2026-10-11 (62 banks, 2,321 fees, scorer v1). Not comparable with today's scorer and cohort, so it never raises an alarm; only last month at the same scorer and cohort does.";
/** The basis the answer-key baselines were scored on; no current reading has it. */
const ANSWER_KEY_BASELINE_BASIS = "answer-key scorer v1, 62-bank key of 2026-10-11";

/** Each agent's measures, from its 2026-10-12 review. Baselines are the reviews' own figures. */
export const MONTHLY_REVIEW_DEFINITIONS: readonly MonthlyAgentDefinition[] = [
  {
    agent: "magellan",
    name: "Magellan",
    tracker: 1027,
    review: "docs/plans/magellan-review-2026-10-12.md",
    measures: [
      {
        key: "live_institutions",
        label: "Active institutions with live fees",
        unit: "count",
        better: "higher",
        limit: { relative: 0.05 },
        baseline: 3835,
        baselineNote: "Review: 3,835 of 8,522 active institutions have live fees.",
        read: (db) => one(db`
          SELECT COUNT(DISTINCT c.institution_id)::int AS value
            FROM published_fee_catalog c
            JOIN institution_sources inst ON inst.id = c.institution_id
           WHERE COALESCE(inst.status, 'active') = 'active'
        `),
      },
      {
        key: "wrong_bank_takedowns_7d",
        label: "Live fees taken down in 7 days as another bank's document or an unconfirmed host",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 20 },
        baseline: 815,
        baselineNote: "Review: 815 published fees taken down in the 7 days to 2026-10-12.",
        read: takedowns([OTHER_BANK_DOCUMENT_REASON, UNCONFIRMED_HOST_REASON]),
      },
      {
        key: "paid_spend_30d",
        label: "Magellan paid spend, last 30 days (USD)",
        unit: "usd",
        better: "lower",
        limit: { relative: 0.25, minDelta: 10 },
        baseline: null,
        baselineNote: "The review gives daily and 7-day figures by search, not a 30-day total.",
        read: spend("magellan", 30),
      },
    ],
  },
  {
    agent: "rosetta",
    name: "Rosetta",
    tracker: 1050,
    review: "docs/plans/rosetta-review-2026-10-12.md",
    measures: [
      {
        key: "text_institutions",
        label: "Institutions with completed text",
        unit: "count",
        better: "higher",
        limit: { relative: 0.05 },
        baseline: 6037,
        baselineNote: "Review: 19,213 completed texts at 6,037 institutions.",
        read: (db) => one(db`SELECT COUNT(DISTINCT institution_id)::int AS value FROM agent_source_texts WHERE status = 'completed'`),
      },
      {
        key: "text_without_live_fees",
        label: "Institutions with completed text and no live fees",
        unit: "count",
        better: "lower",
        limit: { relative: 0.1, minDelta: 20 },
        baseline: 2178,
        baselineNote: "Review: 2,178 institutions have completed text but no fees in published_fee_catalog.",
        read: (db) => one(db`
          WITH live AS (SELECT DISTINCT institution_id FROM published_fee_catalog)
          SELECT COUNT(DISTINCT t.institution_id)::int AS value
            FROM agent_source_texts t
           WHERE t.status = 'completed'
             AND NOT EXISTS (SELECT 1 FROM live WHERE live.institution_id = t.institution_id)
        `),
      },
      {
        key: "failed_texts",
        label: "Texts that failed to read",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 10 },
        baseline: 432,
        baselineNote: "Review: texts by status, 432 failed.",
        read: (db) => one(db`SELECT COUNT(*)::int AS value FROM agent_source_texts WHERE status = 'failed'`),
      },
      {
        key: "needs_ocr_texts",
        label: "Scanned texts waiting for OCR",
        unit: "count",
        better: "lower",
        limit: { relative: 0.5, minDelta: 10 },
        baseline: 22,
        baselineNote: "Review: texts by status, 22 needs_ocr.",
        read: (db) => one(db`SELECT COUNT(*)::int AS value FROM agent_source_texts WHERE status = 'needs_ocr'`),
      },
      {
        key: "paid_spend_30d",
        label: "Rosetta paid spend, last 30 days (USD)",
        unit: "usd",
        better: "lower",
        limit: { relative: 0.5, minDelta: 5 },
        baseline: 16.62,
        baselineNote: "Review: $16.62 on 278 paid reads in the 30 days to 2026-10-12.",
        read: spend("rosetta", 30),
      },
    ],
  },
  {
    agent: "knox",
    name: "Knox",
    tracker: 1092,
    review: "docs/plans/knox-review-2026-10-12.md",
    measures: [
      {
        key: "answer_key_recall",
        label: "Answer key: share of real fees Knox finds",
        unit: "share",
        better: "higher",
        limit: { points: 0.03 },
        baseline: 0.65,
        baselineNote: ANSWER_KEY_NOTE,
        baselineBasis: ANSWER_KEY_BASELINE_BASIS,
        read: answerKey("knox", "recall"),
      },
      {
        key: "answer_key_precision",
        label: "Answer key: share of Knox's finds that are right",
        unit: "share",
        better: "higher",
        limit: { points: 0.03 },
        baseline: 0.78,
        baselineNote: ANSWER_KEY_NOTE,
        baselineBasis: ANSWER_KEY_BASELINE_BASIS,
        read: answerKey("knox", "precision"),
      },
      {
        key: "text_without_knox_rows",
        label: "Institutions with readable text and no Knox rows",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 10 },
        baseline: 131,
        baselineNote: "Review: of 6,037 institutions with readable text, 131 have no Knox rows.",
        read: (db) => one(db`
          WITH knox AS (SELECT DISTINCT institution_id FROM raw_fee_observations WHERE source = 'knox')
          SELECT COUNT(DISTINCT t.institution_id)::int AS value
            FROM agent_source_texts t
           WHERE t.status = 'completed'
             AND NOT EXISTS (SELECT 1 FROM knox WHERE knox.institution_id = t.institution_id)
        `),
      },
      {
        key: "knox_without_darwin",
        label: "Institutions with Knox rows and no Darwin result",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 10 },
        baseline: 512,
        baselineNote: "Review: 512 institutions have Knox rows and no Darwin result.",
        read: (db) => one(db`
          WITH knox AS (SELECT DISTINCT institution_id FROM raw_fee_observations WHERE source = 'knox'),
               darwin AS (SELECT DISTINCT institution_id FROM verified_fee_observations)
          SELECT COUNT(*)::int AS value
            FROM knox
           WHERE NOT EXISTS (SELECT 1 FROM darwin WHERE darwin.institution_id = knox.institution_id)
        `),
      },
      {
        key: "unknown_audience_share_30d",
        label: "Share of Knox rows written in 30 days with audience unknown",
        unit: "share",
        better: "lower",
        limit: { points: 0.05 },
        baseline: 0.973,
        baselineNote: "Review: 97.3% of rows written since 2026-10-10 (a 2-day window, this measure reads 30 days).",
        read: (db) => one(db`
          SELECT ROUND((COUNT(*) FILTER (WHERE COALESCE(fee_audience, 'unknown') = 'unknown'))::numeric
                       / NULLIF(COUNT(*), 0), 4) AS value
            FROM raw_fee_observations
           WHERE source = 'knox'
             AND created_at >= NOW() - INTERVAL '30 days'
        `),
      },
      {
        key: "paid_cost_per_row_30d",
        label: "Paid pass: USD per row added, last 30 days",
        unit: "usd",
        better: "lower",
        limit: { relative: 0.5 },
        baseline: 0.011,
        baselineNote: "Review: $76.80 for 6,822 rows, about 1.1 cents a row (October 1 to 12).",
        read: async (db) => {
          const [row] = await db`
            SELECT (SELECT COALESCE(SUM(estimated_cost_microusd), 0) / 1e6
                      FROM ai_api_usage_events
                     WHERE agent_name = 'knox'
                       AND ${incurredProviderUsageSql(db)}
                       AND created_at >= NOW() - INTERVAL '30 days') AS usd,
                   (SELECT COUNT(*)
                      FROM raw_fee_observations
                     WHERE source = 'knox'
                       AND COALESCE(outlier_flags, '[]'::jsonb) ? 'knox_paid_extraction'
                       AND created_at >= NOW() - INTERVAL '30 days')::int AS rows
          `;
          const rows = num(row?.rows) ?? 0;
          const usd = num(row?.usd);
          return rows > 0 && usd != null ? Math.round((usd / rows) * 10_000) / 10_000 : null;
        },
      },
      {
        key: "extract_hours_7d",
        label: "Server hours on free extraction, last 7 days",
        unit: "hours",
        better: "lower",
        limit: { relative: 0.5, minDelta: 2 },
        baseline: 14.3,
        baselineNote: "Review: 3,386 extract steps, 14.3 hours, in the 7 days to 2026-10-12.",
        read: stepHours(["extract"]),
      },
      {
        key: "extract_paid_hours_7d",
        label: "Server hours on the paid pass, last 7 days",
        unit: "hours",
        better: "lower",
        limit: { relative: 0.5, minDelta: 2 },
        baseline: 5.4,
        baselineNote: "Review: 1,514 extract-paid steps, 5.4 hours, in the 7 days to 2026-10-12.",
        read: stepHours(["extract-paid"]),
      },
    ],
  },
  {
    agent: "hamilton",
    name: "Hamilton (publisher, now run as Gutenberg)",
    tracker: 975,
    review: "docs/plans/hamilton-review-2026-10-12.md",
    measures: [
      {
        key: "live_rows",
        label: "Live fee rows (not taken down, not quarantined)",
        unit: "count",
        better: "higher",
        limit: { relative: 0.05 },
        baseline: 76749,
        baselineNote: "Review: 76,749 live rows of 129,793 ever written.",
        read: (db) => one(db`
          SELECT COUNT(*)::int AS value
            FROM published_fee_records
           WHERE rolled_back_at IS NULL
             AND quarantined_at IS NULL
        `),
      },
      {
        key: "answer_key_recall_live",
        label: "Answer key: share of real fees live",
        unit: "share",
        better: "higher",
        limit: { points: 0.03 },
        baseline: 0.56,
        baselineNote: ANSWER_KEY_NOTE,
        baselineBasis: ANSWER_KEY_BASELINE_BASIS,
        read: answerKey("hamilton", "recall"),
      },
      {
        key: "answer_key_precision_live",
        label: "Answer key: share of live fees that are right",
        unit: "share",
        better: "higher",
        limit: { points: 0.03 },
        baseline: 0.89,
        baselineNote: ANSWER_KEY_NOTE,
        baselineBasis: ANSWER_KEY_BASELINE_BASIS,
        read: answerKey("hamilton", "precision"),
      },
      {
        key: "refreshed_closures_7d",
        label: "Rows closed as \"refreshed by\" a newer copy, last 7 days",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 100 },
        baseline: 32556,
        baselineNote: "Review: 32,556 \"refreshed by\" closures in the 7 days to 2026-10-12.",
        read: (db) => one(db`
          SELECT COUNT(*)::int AS value
            FROM published_fee_records
           WHERE rolled_back_at >= NOW() - INTERVAL '7 days'
             AND rolled_back_reason LIKE 'refreshed by #%'
        `),
      },
      {
        key: "rules_recheck_takedowns_7d",
        label: "Take-downs by the rules re-check, last 7 days",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 50 },
        baseline: 7019,
        baselineNote: "Review: 7,019 in the 7 days to 2026-10-12, most before #1022 stopped the churn on Oct 12.",
        read: takedowns([RULES_RECHECK_REASON]),
      },
      {
        key: "product_page_takedowns_7d",
        label: "Take-downs as product-page fees, last 7 days",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 20 },
        baseline: 745,
        baselineNote: "Review: 745 in the 7 days to 2026-10-12 (this measure counts product_page and product_page_conflict).",
        read: takedowns([PRODUCT_PAGE_REASON]),
      },
      {
        key: "business_schedule_takedowns_7d",
        label: "Take-downs as business-schedule fees, last 7 days",
        unit: "count",
        better: "lower",
        limit: { relative: 0.25, minDelta: 20 },
        baseline: 366,
        baselineNote: "Review: 366 in the 7 days to 2026-10-12.",
        read: takedowns([BUSINESS_SCHEDULE_REASON]),
      },
      {
        key: "publish_failed_steps_7d",
        label: "Failed publish steps, last 7 days",
        unit: "count",
        better: "lower",
        limit: { relative: 0.5, minDelta: 5 },
        baseline: 8,
        baselineNote: "Review: 8 of 3,382 publish steps failed in the 7 days to 2026-10-12.",
        read: (db) => one(db`
          SELECT COUNT(*)::int AS value
            FROM agent_run_steps
           WHERE step_key = ANY(${[...PUBLISH_STEP_KEYS]}::text[])
             AND status = 'failed'
             AND started_at >= NOW() - INTERVAL '7 days'
        `),
      },
      {
        key: "publish_hours_7d",
        label: "Server hours on publishing, last 7 days",
        unit: "hours",
        better: "lower",
        limit: { relative: 0.25, minDelta: 2 },
        baseline: 20.7,
        baselineNote: "Review: 20.7 hours a week of publish steps, sweeps included (since split into publish-sweeps, counted here too).",
        read: stepHours(PUBLISH_STEP_KEYS),
      },
      {
        key: "product_spend_30d",
        label: "Hamilton product paid spend, last 30 days (USD)",
        unit: "usd",
        better: "lower",
        limit: { relative: 0.5, minDelta: 5 },
        baseline: 9.41,
        baselineNote: "Review: $9.41 in the 30 days to 2026-10-12, all from research, reports, chat and memos.",
        read: spend("hamilton", 30),
      },
    ],
  },
];

// ---------------------------------------------------------------- comparison (pure)

export type Move = "up" | "down" | "flat" | "unknown";

export interface MeasureResult {
  key: string;
  label: string;
  unit: MeasureUnit;
  better: "higher" | "lower";
  limit: MeasureLimit;
  /** This month's value; null when it could not be read (`error`) or there was nothing to measure. */
  value: number | null;
  error: string | null;
  /** What this month's value was measured on, when that can change; null for plain counts. */
  basis: string | null;
  lastMonth: number | null;
  /** Whether last month's value was measured on the same basis; a different one is not compared. */
  lastMonthComparable: boolean;
  baseline: number | null;
  baselineNote: string | null;
  /** Whether the 2026-10-12 figure was measured on the same basis; a different one is not compared. */
  baselineComparable: boolean;
  vsLastMonth: Move;
  vsBaseline: Move;
  /** What the alarm compared against: last month when both are known, else the 2026-10-12 figure. */
  comparedWith: "last_month" | "baseline" | null;
  alarm: boolean;
}

export interface MonthlyAgentPage {
  agent: MonthlyReviewAgent;
  name: string;
  tracker: number;
  review: string;
  measures: MeasureResult[];
}

export interface MonthlyAlarm {
  agent: MonthlyReviewAgent;
  key: string;
  label: string;
  from: number;
  to: number;
  comparedWith: "last_month" | "baseline";
  tracker: number;
}

export interface MonthlyReview {
  version: number;
  /** YYYY-MM, UTC. */
  month: string;
  ranAt: string;
  /** The month the "last month" column comes from, or null on the first run. */
  lastMonth: string | null;
  baselineDate: string;
  agents: MonthlyAgentPage[];
  alarms: MonthlyAlarm[];
  measured: number;
  unknown: number;
}

/** Up, down or flat; unknown when either side is unknown. Pure. */
export function moveOf(now: number | null, before: number | null): Move {
  if (now == null || before == null) return "unknown";
  const delta = now - before;
  if (Math.abs(delta) <= Math.max(Math.abs(before), 1) * 1e-6) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Whether `now` moved the wrong way from `before` by more than the measure's limit. Pure. */
export function pastLimit(measure: Pick<MonthlyMeasure, "better" | "limit">, now: number | null, before: number | null): boolean {
  if (now == null || before == null) return false;
  const worse = measure.better === "higher" ? before - now : now - before;
  if (worse <= 0) return false;
  if (measure.limit.minDelta != null && worse < measure.limit.minDelta) return false;
  if (measure.limit.points != null && worse > measure.limit.points) return true;
  if (measure.limit.relative != null && worse > Math.abs(before) * measure.limit.relative) return true;
  return false;
}

/**
 * One measure's row: this month against last month and the 2026-10-12 figure. Each comparison is
 * made only on the same basis (for the answer key: the same scorer version and cohort); one on a
 * different basis shows no move and cannot alarm. Pure.
 */
export function compareMeasure(
  measure: Omit<MonthlyMeasure, "read">,
  reading: { value: number | null; error: string | null; basis?: string | null },
  last: { value: number | null; basis?: string | null } | null,
): MeasureResult {
  const value = reading.value;
  const basis = reading.basis ?? null;
  const lastMonth = last?.value ?? null;
  const lastMonthComparable = lastMonth != null && (last?.basis ?? null) === basis;
  const baselineComparable = measure.baseline != null && (measure.baselineBasis ?? null) === basis;
  const comparedWith = value == null ? null : lastMonthComparable ? "last_month" : baselineComparable ? "baseline" : null;
  const before = comparedWith === "last_month" ? lastMonth : comparedWith === "baseline" ? measure.baseline : null;
  return {
    key: measure.key,
    label: measure.label,
    unit: measure.unit,
    better: measure.better,
    limit: measure.limit,
    value,
    error: reading.error,
    basis,
    lastMonth,
    lastMonthComparable,
    baseline: measure.baseline,
    baselineNote: measure.baselineNote,
    baselineComparable,
    vsLastMonth: lastMonthComparable ? moveOf(value, lastMonth) : "unknown",
    vsBaseline: baselineComparable ? moveOf(value, measure.baseline) : "unknown",
    comparedWith,
    alarm: pastLimit(measure, value, before),
  };
}

/** Whether a move is the good way, the bad way, or neither. Pure. */
export function moveTone(move: Move, better: "higher" | "lower"): "good" | "bad" | "neutral" {
  if (move === "unknown" || move === "flat") return "neutral";
  return (move === "up") === (better === "higher") ? "good" : "bad";
}

export function formatMeasure(value: number | null, unit: MeasureUnit): string {
  if (value == null) return "unknown";
  if (unit === "share") return `${(value * 100).toFixed(1)}%`;
  if (unit === "usd") return value < 1 ? `$${value.toFixed(4)}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (unit === "hours") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
  return value.toLocaleString("en-US");
}

// ---------------------------------------------------------------- run

export function isFirstOfMonthUtc(now: Date): boolean {
  return now.getUTCDate() === 1;
}

export interface MonthlyReviewResult {
  ran: boolean;
  reason: string | null;
  review: MonthlyReview | null;
}

function parseReview(detail: unknown): MonthlyReview | null {
  const parsed = (typeof detail === "string" ? JSON.parse(detail) : detail) as { ran?: unknown; review?: unknown } | null;
  if (!parsed || parsed.ran !== true || !parsed.review || typeof parsed.review !== "object") return null;
  const review = parsed.review as MonthlyReview;
  return Array.isArray(review.agents) && typeof review.month === "string" ? review : null;
}

/** The newest stored monthly review, optionally only from a month before `beforeMonth` (YYYY-MM). */
export async function readLatestMonthlyReview(db: SqlTag = sql, beforeMonth?: string): Promise<MonthlyReview | null> {
  const rows = await db<Array<{ detail: unknown }>>`
    SELECT e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = ${MONTHLY_REVIEW_STEP_KEY}
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.detail->>'ran' = 'true'
       AND (${beforeMonth ?? null}::text IS NULL OR e.detail->'review'->>'month' < ${beforeMonth ?? null}::text)
     ORDER BY e.created_at DESC
     LIMIT 1
  `;
  return rows.length > 0 ? parseReview(rows[0].detail) : null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/**
 * `work` in its own savepoint under a statement timeout, restored afterwards. A failure rolls back
 * only the savepoint (the timeout setting with it) and is rethrown for the caller.
 */
async function timed<T>(db: SqlTag, timeoutMs: number, restoreTimeout: string | null, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  return inSavepoint(db, async (scope) => {
    await scope`SELECT set_config('statement_timeout', ${String(timeoutMs)}::text, true)`;
    const result = await work(scope);
    if (restoreTimeout != null) await scope`SELECT set_config('statement_timeout', ${restoreTimeout}::text, true)`;
    return result;
  });
}

/** One measure in its own savepoint with a statement timeout; a failure becomes unknown, never 0. */
async function readMeasure(
  db: SqlTag,
  measure: MonthlyMeasure,
  context: MeasureContext,
  restoreTimeout: string | null,
): Promise<{ value: number | null; error: string | null; basis: string | null }> {
  try {
    const read = await timed(db, MONTHLY_MEASURE_TIMEOUT_MS, restoreTimeout, (scope) => measure.read(scope, context));
    return read != null && typeof read === "object"
      ? { value: read.value, error: null, basis: read.basis }
      : { value: read, error: null, basis: null };
  } catch (error) {
    return { value: null, error: message(error), basis: null };
  }
}

/**
 * Runs every measure and compares it with last month's stored review and the 2026-10-12 figure.
 * Only on the 1st of the month (UTC) unless `force`. Read-only.
 */
export async function runMonthlyReview({
  db = sql,
  now = new Date(),
  force = false,
  definitions = MONTHLY_REVIEW_DEFINITIONS,
  clock = () => Date.now(),
}: {
  db?: SqlTag;
  now?: Date;
  force?: boolean;
  definitions?: readonly MonthlyAgentDefinition[];
  clock?: () => number;
} = {}): Promise<MonthlyReviewResult> {
  if (!force && !isFirstOfMonthUtc(now)) {
    return { ran: false, reason: "Not the 1st of the month (UTC).", review: null };
  }
  const month = now.toISOString().slice(0, 7);
  const started = clock();
  const restoreTimeout = await inSavepoint(db, async (scope) => {
    const [row] = await scope<Array<{ value: string }>>`SELECT current_setting('statement_timeout') AS value`;
    return row?.value ?? null;
  }).catch(() => null);
  const previous = await timed(db, MONTHLY_PREREAD_TIMEOUT_MS, restoreTimeout, (scope) => readLatestMonthlyReview(scope, month)).catch((error: unknown) => {
    console.error("Monthly agent review: last month's review could not be read", error);
    return null;
  });
  const context: MeasureContext = {
    answerKey: await timed(db, MONTHLY_PREREAD_TIMEOUT_MS, restoreTimeout, (scope) => getLatestAnswerKeyScoreRun(scope))
      .then((run) => ({ run, error: null }))
      .catch((error: unknown) => ({ run: null, error: message(error) })),
  };

  const agents: MonthlyAgentPage[] = [];
  for (const definition of definitions) {
    const before = previous?.agents.find((page) => page.agent === definition.agent);
    const measures: MeasureResult[] = [];
    for (const measure of definition.measures) {
      // Start a measure only while it can finish, at its statement timeout, inside the budget.
      const outOfTime = clock() - started + MONTHLY_MEASURE_TIMEOUT_MS > MONTHLY_REVIEW_BUDGET_MS;
      const reading = outOfTime
        ? { value: null, error: "Not read: the step's time budget ran out.", basis: null }
        : await readMeasure(db, measure, context, restoreTimeout);
      const last = before?.measures.find((row) => row.key === measure.key);
      measures.push(compareMeasure(measure, reading, last ? { value: last.value, basis: last.basis ?? null } : null));
    }
    agents.push({ agent: definition.agent, name: definition.name, tracker: definition.tracker, review: definition.review, measures });
  }

  const alarms: MonthlyAlarm[] = agents.flatMap((page) =>
    page.measures
      .filter((row) => row.alarm && row.value != null && row.comparedWith != null)
      .map((row) => ({
        agent: page.agent,
        key: row.key,
        label: row.label,
        from: (row.comparedWith === "last_month" ? row.lastMonth : row.baseline) as number,
        to: row.value as number,
        comparedWith: row.comparedWith as "last_month" | "baseline",
        tracker: page.tracker,
      })),
  );
  const all = agents.flatMap((page) => page.measures);
  return {
    ran: true,
    reason: null,
    review: {
      version: MONTHLY_REVIEW_VERSION,
      month,
      ranAt: now.toISOString(),
      lastMonth: previous?.month ?? null,
      baselineDate: MONTHLY_REVIEW_BASELINE_DATE,
      agents,
      alarms,
      measured: all.filter((row) => row.value != null).length,
      unknown: all.filter((row) => row.value == null).length,
    },
  };
}

// ---------------------------------------------------------------- words (pure)

function agentName(review: MonthlyReview, agent: MonthlyReviewAgent): string {
  return review.agents.find((page) => page.agent === agent)?.name.split(" (")[0] ?? agent;
}

function alarmText(review: MonthlyReview, alarm: MonthlyAlarm): string {
  const unit = review.agents.find((page) => page.agent === alarm.agent)?.measures.find((row) => row.key === alarm.key)?.unit ?? "count";
  const against = alarm.comparedWith === "last_month" ? "since last month" : `since ${review.baselineDate}`;
  return `${agentName(review, alarm.agent)}: ${alarm.label} ${formatMeasure(alarm.from, unit)} → ${formatMeasure(alarm.to, unit)} ${against} (tracker #${alarm.tracker})`;
}

export function summarizeMonthlyReview(result: MonthlyReviewResult): string {
  if (!result.ran || !result.review) return `Skipped the monthly agent review: ${result.reason ?? "not due"}`;
  const review = result.review;
  const total = review.measured + review.unknown;
  const unknown = review.unknown > 0 ? `, ${review.unknown} could not be read` : "";
  const head = `Monthly agent review ${review.month}: ${review.measured} of ${total} measures read${unknown}`;
  if (review.alarms.length === 0) return `${head}; none moved the wrong way past its limit.`;
  return `${head}. ALARM, ${review.alarms.length} past ${review.alarms.length === 1 ? "its" : "their"} limit: ${review.alarms.map((alarm) => alarmText(review, alarm)).join("; ")}.`;
}

/** Days a review stays news for the Sunday email: the first Sunday after the 1st. */
const SUNDAY_LINE_DAYS = 7;

/** The Sunday email's line for the month's review, or null when it is older than a week. Pure. */
export function monthlyReviewSundayLine(review: MonthlyReview | null | undefined, now: Date): string | null {
  if (!review) return null;
  const age = now.getTime() - new Date(review.ranAt).getTime();
  if (!(age >= 0 && age <= SUNDAY_LINE_DAYS * 86_400_000)) return null;
  const link = `${SITE_URL}/admin/agents/health`;
  const unknown = review.unknown > 0 ? ` ${review.unknown} could not be read.` : "";
  if (review.alarms.length === 0) {
    return `Monthly agent review (${review.month}): every measure read is inside its limit.${unknown}\n${link}`;
  }
  return `Monthly agent review (${review.month}): ${review.alarms.length} past ${review.alarms.length === 1 ? "its" : "their"} limit.${unknown}\n${review.alarms.map((alarm) => `- ${alarmText(review, alarm)}`).join("\n")}\n${link}`;
}
