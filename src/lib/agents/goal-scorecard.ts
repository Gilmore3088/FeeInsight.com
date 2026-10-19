import { incurredProviderUsageSql } from "@/lib/provider-usage-accounting";
import { sql } from "@/lib/data-store/connection";
import { ACCURACY_TARGET_LABEL } from "@/lib/accuracy-target";
import { inSavepoint } from "@/lib/agents/savepoint";
import { accuracyStatusLabel, formatAccuracyBound, type AccuracyMeasure } from "@/lib/agents/deming/accuracy-measure";
export { poolFreshAudits, wilsonRange } from "@/lib/agents/deming/accuracy-measure";
import { poolFreshAudits } from "@/lib/agents/deming/accuracy-measure";
import { BATCH_REVIEW_CHECK, type BatchMissKind } from "@/lib/agents/rosetta/batch-review";

/**
 * The goal scorecard (#1040): the numbers that say whether Fee Insight is getting closer to a
 * benchmark in every state and size group, with fees that are right, at a cost that falls.
 * Atlas reads it with the daily scoreboard snapshot and stores it in `detail.goal`; the page
 * and the morning brief show the same numbers. Deterministic, read-only SQL; no model calls.
 *
 * Every number carries the name of its query (`GOAL_QUERIES`), so a reader can find the SQL.
 * None counts a refresh or a rollback as progress:
 *   - "added this week" is an institution live now that had no live fee seven days ago, so a
 *     refresh (the fee stays live under a new row) adds nothing;
 *   - "wrong after publish" leaves out refresh copies and housekeeping take-downs
 *     (refreshes, duplicates, rule re-checks, a bank's newer copy), and counts only errors.
 * Windows are the trailing seven days at read time.
 */

type SqlTag = typeof sql;

export const GOAL_WINDOW_DAYS = 7;
/** `published_fee_catalog` shows an institution only once it has live fees in this many categories. */
export const CATALOG_MIN_CATEGORIES = 3;

/** James, 2026-10-12 (#1028): a state × size group under $10B is covered at 30 live institutions, or 75% below 40. */
export const COVERAGE_TARGET_INSTITUTIONS = 30;
export const COVERAGE_SMALL_GROUP_BELOW = 40;
export const COVERAGE_SMALL_GROUP_SHARE = 0.75;

/** Size groups under $10B. `asset_size` is in thousands of dollars. */
export const SIZE_GROUPS = [
  { key: "under_300m", label: "Under $300M", maxThousands: 300_000 },
  { key: "300m_1b", label: "$300M–$1B", maxThousands: 1_000_000 },
  { key: "1b_10b", label: "$1–10B", maxThousands: 10_000_000 },
] as const;
export type SizeGroupKey = (typeof SIZE_GROUPS)[number]["key"];

/** Query names shown beside each number on the page. */
export const GOAL_QUERIES = {
  coverageCells: "goal.coverage_cells",
  liveInstitutions: "goal.live_institutions",
  accuracy: "goal.deming_accuracy_7d",
  wrongAfterPublish: "goal.wrong_after_publish_7d",
  spend: "goal.provider_spend_7d",
  knoxPasses: "goal.knox_passes_7d",
  unstatedAudience: "goal.unstated_audience",
  answerQuality: "goal.hamilton_answer_eval_latest",
  readerMissWeeks: "goal.rosetta_miss_rate_weekly",
  readerRemedies: "goal.rosetta_remedy_outcomes",
  dataQuality: "goal.deming_data_quality_latest",
} as const;

/** Weeks of text-reading misses shown, oldest first, the current week last (#1054). */
export const READER_MISS_WEEKS = 8;
/** The miss kinds Rosetta's batch review writes (`rosetta/batch-review.ts`). */
export const READER_MISS_KINDS: BatchMissKind[] = ["no_fees_found", "short_text", "missed_fee_page", "unresolved_fee_page", "unread"];

export interface ReaderMissWeek {
  /** Monday of the week, UTC, as YYYY-MM-DD. Batches count in the week they were reviewed. */
  weekStart: string;
  batches: number;
  reads: number;
  errors: number;
  /** Misses ÷ reads; null in a week with no reviewed batch. */
  rate: number | null;
  byKind: Record<BatchMissKind, number>;
  /** True for the week still running: its counts are not a full week yet. */
  partial: boolean;
}

export interface ReaderMissWeeks {
  query: string;
  weeks: ReaderMissWeek[];
}

export interface ReaderRemedyOutcome {
  remedy: string;
  /** Misses the batch review sent to a fix. */
  remedied: number;
  /** Of those, misses whose document (or, for `INSTITUTION_JUDGED_REMEDIES`, institution) later gave Knox fees. */
  knoxFound: number;
  share: number | null;
}

export interface ReaderRemedies {
  query: string;
  remedied: number;
  knoxFound: number;
  share: number | null;
  byRemedy: ReaderRemedyOutcome[];
}

export interface CoverageCells {
  query: string;
  readyCells: number;
  totalCells: number;
  /** Covered institutions still needed to bring every group to its target. */
  institutionsShort: number;
  /** The same gap seven days ago, from the institutions live then. Absent on snapshots from before it. */
  institutionsShortWeekAgo?: number;
  bySize: Array<{ size: SizeGroupKey; label: string; readyCells: number; totalCells: number; institutionsShort: number }>;
  /** Each state's gap (#1117), largest first: the same groups, summed per state. Absent on snapshots from before it. */
  byState?: StateCoverageGap[];
}

export interface StateCoverageGap {
  state: string;
  readyCells: number;
  totalCells: number;
  /** Covered institutions the state's groups under $10B still need to reach their targets. */
  institutionsShort: number;
  /** The same gap seven days ago, from the institutions live then (group totals as of now). */
  institutionsShortWeekAgo: number;
  /** Institutions newly live this week in a group still short a week ago, capped at that group's gap. */
  closingThisWeek: number;
}

/** One state × size group: institutions in it, covered now and seven days ago, and newly covered this week. */
export interface CoverageGroupRow {
  state_code?: string;
  size_group: string;
  total: number;
  covered: number;
  covered_week_ago?: number;
  newly_covered?: number;
}

export interface LiveInstitutions {
  query: string;
  live: number;
  /** Live now, with no live fee seven days ago. */
  addedThisWeek: number;
  /** Live seven days ago, with no live fee now (taken down). Absent on snapshots from before it. */
  droppedThisWeek?: number;
}

export interface WeeklyAccuracy extends AccuracyMeasure {
  query: string;
}

export interface WrongAfterPublish {
  query: string;
  /** Fees first published in the window (refresh copies left out). */
  published: number;
  /** Of those, taken down since as an error. */
  wrong: number;
  rate: number | null;
  /** Taken down for housekeeping (refresh, duplicate, re-check, newer copy): not errors. */
  housekeeping: number;
  topErrors: Array<{ reason: string; count: number }>;
}

export interface AgentSpend {
  agent: string;
  weekUsd: number;
  weekCalls: number;
  monthUsd: number;
  monthlyCapUsd: number | null;
}

export interface GoalSpend {
  query: string;
  weekUsd: number;
  /** Week spend ÷ institutions added this week; null when none were added. */
  costPerNewInstitutionUsd: number | null;
  byAgent: AgentSpend[];
}

export interface KnoxPass {
  rowsKept: number;
  documents: number;
  institutions: number;
}

export interface KnoxPasses {
  query: string;
  free: KnoxPass;
  paid: KnoxPass & { spendUsd: number; calls: number; costPerRowUsd: number | null };
  /** Share of Knox's kept rows found by the free pass: the work done at $0. */
  zeroCostShare: number | null;
}

export interface UnstatedAudience {
  query: string;
  liveFees: number;
  unknownFees: number;
  /** Live fees shown with the asterisk (#1058); should fall toward zero as #1059 labels them. */
  share: number | null;
}

/** One answer path's form pass rate and correctness rate from the latest answer eval (#1079). */
export interface AnswerPathQuality {
  path: "free_ask" | "pro_replay" | "written_answer" | "memo" | "simulate" | "report";
  label: string;
  /** False for a paid path the eval does not sample yet; its numbers are then null. */
  measured: boolean;
  answers: number | null;
  /** Answers that meet the quality bar on form (a number, a source, a peer count, no advice). */
  formPassed: number | null;
  formRate: number | null;
  /** Answers whose fee figures could be checked against the live catalog. */
  checked: number | null;
  /** Checked answers whose every fee figure ties to a live catalog row. */
  correct: number | null;
  correctRate: number | null;
  /** For a paid path: when the sample its rates come from finished (ISO). */
  at?: string;
}

export interface AnswerQuality {
  query: string;
  /** When the free eval run finished (ISO): the date its rates are for. */
  at: string;
  /** When the latest paid sample finished (ISO), the date the paid rates are for; null when none ran in the window. */
  paidAt?: string | null;
  timedOut: boolean;
  institutionsAsked?: number | null;
  institutionsPlanned?: number | null;
  proQuestionsAsked?: number | null;
  proQuestionsPlanned?: number | null;
  paths: AnswerPathQuality[];
}

/** The paid paths, each sampled daily (`paid-answer-eval.ts`, five a day): memos, and one Simulate read, written answer and report answer page. */
export const PAID_ANSWER_PATHS: Array<Pick<AnswerPathQuality, "path" | "label">> = [
  { path: "written_answer", label: "Written answer (paid)" },
  { path: "memo", label: "Memo (paid)" },
  { path: "simulate", label: "Simulate (paid)" },
  { path: "report", label: "Report (paid)" },
];

const correctnessOf = (value: unknown): { checked: number; correct: number } | null => {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  return { checked: Number(c.checked ?? 0), correct: Number(c.correct ?? 0) };
};

type PaidRun = { at: string; detail: Record<string, unknown> };

/**
 * The latest answer eval's detail as one row per path; an eval from before #1079 has no correctness.
 * `paid` is the paid sample runs, newest first: each paid path takes the newest run that measured it,
 * so a later run that sampled only memos does not drop the Simulate, written answer or report row (#1414).
 */
export function answerQualityFrom(
  at: string,
  detail: Record<string, unknown>,
  paid: PaidRun | PaidRun[] | null = null,
): Omit<AnswerQuality, "query"> {
  const path = (
    key: AnswerPathQuality["path"],
    label: string,
    answers: unknown,
    passed: unknown,
    correctness: unknown,
  ): AnswerPathQuality => {
    const total = Number(answers ?? 0);
    const formPassed = Number(passed ?? 0);
    const c = correctnessOf(correctness);
    return {
      path: key,
      label,
      measured: true,
      answers: total,
      formPassed,
      formRate: ratio(formPassed, total),
      checked: c?.checked ?? null,
      correct: c?.correct ?? null,
      correctRate: c ? ratio(c.correct, c.checked) : null,
    };
  };
  const pro = (detail.pro ?? null) as Record<string, unknown> | null;
  // Each paid path's row from the newest run that answered it; a path no run answered measures nothing yet.
  const paidRows = new Map<string, { at: string; row: Record<string, unknown> }>();
  for (const run of paid ? (Array.isArray(paid) ? paid : [paid]) : []) {
    for (const row of Array.isArray(run.detail.paths) ? (run.detail.paths as Array<Record<string, unknown>>) : []) {
      if (Number(row.answers ?? 0) > 0 && !paidRows.has(String(row.path))) paidRows.set(String(row.path), { at: run.at, row });
    }
  }
  const newestPaid = [...paidRows.values()].map((r) => r.at).sort().at(-1) ?? null;
  return {
    at,
    paidAt: newestPaid,
    timedOut: detail.timedOut === true,
    institutionsAsked: detail.institutions == null ? null : Number(detail.institutions),
    institutionsPlanned: detail.planned == null ? null : Number(detail.planned),
    proQuestionsAsked: pro?.questions == null ? null : Number(pro.questions),
    proQuestionsPlanned: pro?.planned == null ? null : Number(pro.planned),
    paths: [
      path("free_ask", "Free Ask, standard questions", detail.answers, detail.passed, detail.correctness),
      ...(pro ? [path("pro_replay", "Free Ask, Pro readers' questions", pro.questions, pro.passed, pro.correctness)] : []),
      ...PAID_ANSWER_PATHS.map((p) => {
        const measured = paidRows.get(p.path);
        return measured
          ? { ...path(p.path, p.label, measured.row.answers, measured.row.passed, measured.row.correctness), at: measured.at }
          : { ...p, measured: false, answers: null, formPassed: null, formRate: null, checked: null, correct: null, correctRate: null };
      }),
    ],
  };
}

/** One line of the daily data-quality checks (#1065), each with its own query name. */
export interface DataQualityLine {
  catalog: "dollar" | "rate";
  check: "duplicates" | "stale" | "noCategory" | "noSource" | "categoryShare";
  query: string;
  count: number;
  rate: number | null;
  status: string;
}

export interface DataQuality {
  query: string;
  /** When the check finished (ISO). */
  at: string;
  /** Checks at FAIL, as "catalog.check": the alarm. */
  failing: string[];
  warning: string[];
  lines: DataQualityLine[];
  /** Categories out of line with their normal share of live institutions. */
  drifts: Array<{ catalog: "dollar" | "rate"; category: string; normalShare: number; share: number; direction: string }>;
}

const DATA_QUALITY_CHECKS = ["duplicates", "stale", "noCategory", "noSource"] as const;

/** The latest `deming-data-quality` step detail as scorecard lines; null when it is not that step's shape. */
export function dataQualityFrom(at: string, detail: Record<string, unknown>): Omit<DataQuality, "query"> | null {
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  const lines: DataQualityLine[] = [];
  const drifts: DataQuality["drifts"] = [];
  for (const catalog of ["dollar", "rate"] as const) {
    const part = detail[catalog] as Record<string, unknown> | undefined;
    if (!part || typeof part !== "object") continue;
    const checks = (part.checks ?? {}) as Record<string, { query?: unknown; count?: unknown; rate?: unknown; status?: unknown }>;
    for (const check of DATA_QUALITY_CHECKS) {
      const row = checks[check];
      if (!row) continue;
      lines.push({
        catalog,
        check,
        query: String(row.query ?? ""),
        count: Number(row.count ?? 0),
        rate: row.rate == null ? null : Number(row.rate),
        status: String(row.status ?? "unknown"),
      });
    }
    const share = (part.category_share ?? {}) as { query?: unknown; status?: unknown; drifts?: unknown };
    const shareDrifts = Array.isArray(share.drifts) ? (share.drifts as Array<Record<string, unknown>>) : [];
    lines.push({ catalog, check: "categoryShare", query: String(share.query ?? ""), count: shareDrifts.length, rate: null, status: String(share.status ?? "unknown") });
    for (const drift of shareDrifts) {
      drifts.push({
        catalog,
        category: String(drift.category ?? ""),
        normalShare: Number(drift.normalShare ?? 0),
        share: Number(drift.share ?? 0),
        direction: String(drift.direction ?? ""),
      });
    }
  }
  if (lines.length === 0) return null;
  return { at, failing: strings(detail.failing), warning: strings(detail.warning), lines, drifts };
}

export interface GoalScorecard {
  readAt: string;
  windowDays: number;
  /** Each number is null when its read failed; the others still stand. */
  coverageCells: CoverageCells | null;
  liveInstitutions: LiveInstitutions | null;
  accuracy: WeeklyAccuracy | null;
  wrongAfterPublish: WrongAfterPublish | null;
  spend: GoalSpend | null;
  knoxPasses: KnoxPasses | null;
  unstatedAudience: UnstatedAudience | null;
  /** Hamilton's answers: form and correctness per path (#1079); absent on snapshots from before it. */
  answerQuality?: AnswerQuality | null;
  /** Rosetta's batch review: weekly miss rate by kind, and whether its fixes gave Knox fees (#1054). */
  readerMisses?: ReaderMissWeeks | null;
  readerRemedies?: ReaderRemedies | null;
  /** Deming's daily data-quality checks (#1065); absent on snapshots from before it. */
  dataQuality?: DataQuality | null;
}

const usd = (micro: unknown): number => Math.round(Number(micro ?? 0) / 10_000) / 100;

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

/** Institutions with live fees a group needs to count as covered. */
export function coverageTarget(total: number): number {
  if (total < COVERAGE_SMALL_GROUP_BELOW) return Math.ceil(total * COVERAGE_SMALL_GROUP_SHARE);
  return COVERAGE_TARGET_INSTITUTIONS;
}

/** Covered institutions a group still needs to reach its target. */
export function coverageShort(total: number, covered: number): number {
  return Math.max(0, coverageTarget(total) - covered);
}

/**
 * Institutions live seven days ago, by the catalog's own rule: a fee neither taken down nor
 * quarantined by then, at an institution with three or more such categories. Without the
 * three-category rule an institution with one or two fees counted as live a week ago though the
 * catalog never showed it, so it read as dropped this week (283 "dropped" on 2026-10-17, 98 real).
 */
export function liveWeekAgoSql(db: SqlTag) {
  return db`
    SELECT fp.institution_id FROM public.published_fee_records fp
     WHERE fp.published_at < NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
       AND (fp.rolled_back_at IS NULL OR fp.rolled_back_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int))
       AND (fp.quarantined_at IS NULL OR fp.quarantined_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int))
     GROUP BY fp.institution_id
    HAVING COUNT(DISTINCT fp.canonical_fee_key) >= ${CATALOG_MIN_CATEGORIES}::int
  `;
}

/**
 * The state × size groups under $10B, one row each: state_code, size_group, total, covered,
 * covered_week_ago, newly_covered, target and short. The one definition the scorecard and Atlas's lane
 * priority (#1117) both read, so the gap a lane works on is the gap the page shows. Institutions
 * over $10B are compared nationally and by district, never by state, so they are not here.
 * `weekAgo` fills the seven-days-ago columns (zero otherwise); the hourly priority skips them.
 *
 * The live list is a MATERIALIZED CTE (#1264). Postgres estimates 43 institution rows where
 * 8,331 pass the filter, so with the list as a plain subquery it nested-looped the catalog
 * result against every institution: 25.3M rows discarded, 3.9 s hourly and 4.7 s with
 * `weekAgo` on prod (2026-10-14). Materialized, the list is read once and hash-joined: 0.31 s
 * and 0.49 s, the same 160 rows (md5 of both outputs equal, read in one snapshot).
 */
export function coverageGroupsSql(db: SqlTag, options: { weekAgo?: boolean } = {}) {
  const liveWeekAgo = options.weekAgo
    ? db`(i.id IN (SELECT institution_id FROM week_ago))`
    : db`FALSE`;
  const weekAgoCte = options.weekAgo
    ? db`, week_ago AS MATERIALIZED (${liveWeekAgoSql(db)})`
    : db``;
  return db`
    WITH live AS MATERIALIZED (
      SELECT DISTINCT institution_id FROM public.published_fee_catalog
    )${weekAgoCte}
    SELECT state_code, size_group, total, covered, covered_week_ago, newly_covered, target,
           GREATEST(0, target - covered)::int AS short
      FROM (
        SELECT state_code, size_group,
               COUNT(*)::int AS total,
               (COUNT(*) FILTER (WHERE covered))::int AS covered,
               (COUNT(*) FILTER (WHERE covered_week_ago))::int AS covered_week_ago,
               (COUNT(*) FILTER (WHERE covered AND NOT covered_week_ago))::int AS newly_covered,
               CASE WHEN COUNT(*) < ${COVERAGE_SMALL_GROUP_BELOW}::int
                    THEN CEIL(COUNT(*) * ${COVERAGE_SMALL_GROUP_SHARE}::numeric)::int
                    ELSE ${COVERAGE_TARGET_INSTITUTIONS}::int END AS target
          FROM (
            SELECT upper(btrim(i.state_code)) AS state_code,
                   CASE WHEN i.asset_size < ${SIZE_GROUPS[0].maxThousands}::bigint THEN ${SIZE_GROUPS[0].key}::text
                        WHEN i.asset_size < ${SIZE_GROUPS[1].maxThousands}::bigint THEN ${SIZE_GROUPS[1].key}::text
                        ELSE ${SIZE_GROUPS[2].key}::text END AS size_group,
                   (live.institution_id IS NOT NULL) AS covered,
                   ${liveWeekAgo} AS covered_week_ago
              FROM public.institution_sources i
              LEFT JOIN live ON live.institution_id = i.id
             WHERE COALESCE(i.status, 'active') = 'active'
               AND NULLIF(btrim(i.state_code), '') IS NOT NULL
               AND i.asset_size IS NOT NULL
               AND i.asset_size < ${SIZE_GROUPS[2].maxThousands}::bigint
          ) inst
         GROUP BY 1, 2
      ) coverage_group
  `;
}

/** Pure: each state's groups summed into its gap, largest gap first. */
export function summarizeStateGaps(rows: CoverageGroupRow[]): StateCoverageGap[] {
  const byState = new Map<string, StateCoverageGap>();
  for (const row of rows) {
    if (!row.state_code || row.total <= 0) continue;
    const state = byState.get(row.state_code) ?? {
      state: row.state_code, readyCells: 0, totalCells: 0, institutionsShort: 0, institutionsShortWeekAgo: 0, closingThisWeek: 0,
    };
    const short = coverageShort(row.total, row.covered);
    const shortWeekAgo = coverageShort(row.total, row.covered_week_ago ?? row.covered);
    state.totalCells += 1;
    if (short === 0) state.readyCells += 1;
    state.institutionsShort += short;
    state.institutionsShortWeekAgo += shortWeekAgo;
    state.closingThisWeek += Math.min(row.newly_covered ?? 0, shortWeekAgo);
    byState.set(row.state_code, state);
  }
  return [...byState.values()].sort((a, b) => b.institutionsShort - a.institutionsShort || a.state.localeCompare(b.state));
}

/** Pure: covered/total per state × size group into ready cells and the gap. */
export function summarizeCoverageCells(rows: CoverageGroupRow[]): Omit<CoverageCells, "query"> {
  const bySize = SIZE_GROUPS.map((group) => {
    const cells = rows.filter((row) => row.size_group === group.key && row.total > 0);
    const ready = cells.filter((row) => coverageShort(row.total, row.covered) === 0).length;
    const short = cells.reduce((sum, row) => sum + coverageShort(row.total, row.covered), 0);
    return { size: group.key, label: group.label, readyCells: ready, totalCells: cells.length, institutionsShort: short };
  });
  return {
    readyCells: bySize.reduce((sum, row) => sum + row.readyCells, 0),
    totalCells: bySize.reduce((sum, row) => sum + row.totalCells, 0),
    institutionsShort: bySize.reduce((sum, row) => sum + row.institutionsShort, 0),
    ...(rows.some((row) => row.covered_week_ago !== undefined)
      ? { institutionsShortWeekAgo: rows.reduce((sum, row) => sum + (row.total > 0 ? coverageShort(row.total, row.covered_week_ago ?? row.covered) : 0), 0) }
      : {}),
    bySize,
    ...(rows.some((row) => row.state_code) ? { byState: summarizeStateGaps(rows) } : {}),
  };
}

/**
 * Take-down reasons that are not errors: a refresh or newer copy replaced the fee, a duplicate
 * was collapsed, a rule re-check could not reproduce it under a changed rule, a category was
 * folded into another, the page it came from was retired, or the institution no longer operates. Matched on the reason's key (the
 * text before ":" or " #"). Every other reason counts as an error, so a new reason is never
 * hidden; the page lists the top errors so the split can be checked.
 */
export const HOUSEKEEPING_REASON_KEYS: ReadonlySet<string> = new Set([
  "refreshed by",
  "superseded by",
  "duplicate of",
  "same_line_duplicate",
  "newer_copy_drops_fee",
  "not_on_current_copy",
  "companion_page_retired",
  "rules_recheck_unreproduced",
  "rules_recheck_restore",
  "taxonomy_fold",
  "closed_institution",
  // A non-checking account's monthly fee held as verified (#1100): publish policy, not a wrong fee.
  "account_type_hold",
]);

/** The reason's key: "source_check_untraceable:no_amount" → "source_check_untraceable", "refreshed by #9" → "refreshed by". */
export function reasonKey(reason: string): string {
  return reason.split(":")[0].split(" #")[0].trim();
}

/** Pure: per-reason counts of this week's publishes into the wrong-after-publish rate. */
export function summarizeWrongAfterPublish(rows: Array<{ reason: string | null; count: number }>): Omit<WrongAfterPublish, "query"> {
  let published = 0;
  let housekeeping = 0;
  const errors = new Map<string, number>();
  for (const row of rows) {
    published += row.count;
    if (row.reason == null) continue;
    const key = reasonKey(row.reason);
    if (HOUSEKEEPING_REASON_KEYS.has(key)) housekeeping += row.count;
    else errors.set(key, (errors.get(key) ?? 0) + row.count);
  }
  const wrong = [...errors.values()].reduce((sum, count) => sum + count, 0);
  const topErrors = [...errors.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 6);
  return { published, wrong, rate: ratio(wrong, published), housekeeping, topErrors };
}

const missCount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

async function readCoverageCells(db: SqlTag): Promise<CoverageCells> {
  const rows = await db<Array<Record<string, number | string>>>`
    SELECT state_code, size_group, total, covered, covered_week_ago, newly_covered
      FROM (${coverageGroupsSql(db, { weekAgo: true })}) coverage_groups
  `;
  return {
    query: GOAL_QUERIES.coverageCells,
    ...summarizeCoverageCells(rows.map((row) => ({
      state_code: String(row.state_code),
      size_group: String(row.size_group),
      total: Number(row.total),
      covered: Number(row.covered),
      covered_week_ago: Number(row.covered_week_ago),
      newly_covered: Number(row.newly_covered),
    }))),
  };
}

async function readLiveInstitutions(db: SqlTag): Promise<LiveInstitutions> {
  // Added and dropped both compare with the institutions live seven days ago, so a week of
  // takedowns shows beside the week's additions instead of hiding behind them.
  const [row] = await db`
    WITH live AS MATERIALIZED (
      SELECT DISTINCT institution_id FROM published_fee_catalog
    ), week_ago AS MATERIALIZED (${liveWeekAgoSql(db)})
    SELECT (SELECT COUNT(*) FROM live)::int AS live,
           (SELECT COUNT(*) FROM live
             WHERE NOT EXISTS (SELECT 1 FROM week_ago w WHERE w.institution_id = live.institution_id))::int AS added,
           (SELECT COUNT(*) FROM week_ago w
             WHERE NOT EXISTS (SELECT 1 FROM live WHERE live.institution_id = w.institution_id))::int AS dropped
  `;
  return {
    query: GOAL_QUERIES.liveInstitutions,
    live: Number(row?.live ?? 0),
    addedThisWeek: Number(row?.added ?? 0),
    ...(row?.dropped == null ? {} : { droppedThisWeek: Number(row.dropped) }),
  };
}

async function readAccuracy(db: SqlTag): Promise<WeeklyAccuracy> {
  const rows = await db<Array<{ created_at: Date | string; detail: unknown }>>`
    SELECT e.created_at, e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = 'deming-fresh-audit'
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
     ORDER BY e.created_at DESC
  `;
  const events = rows.map((row) => ({
    at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    detail: (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as Record<string, unknown> | null,
  }));
  return { query: GOAL_QUERIES.accuracy, ...poolFreshAudits(events) };
}

async function readWrongAfterPublish(db: SqlTag): Promise<WrongAfterPublish> {
  const rows = await db<Array<{ reason: string | null; count: number | string }>>`
    WITH refresh_copy AS (
      SELECT substring(rolled_back_reason FROM '^[a-z]+ by #([0-9]+)')::bigint AS id
        FROM published_fee_records
       WHERE (rolled_back_reason LIKE 'refreshed by #%' OR rolled_back_reason LIKE 'superseded by #%')
         AND rolled_back_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
    )
    SELECT CASE WHEN fp.rolled_back_at IS NULL THEN NULL ELSE COALESCE(fp.rolled_back_reason, 'no reason') END AS reason,
           COUNT(*)::int AS count
      FROM published_fee_records fp
     WHERE fp.published_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
       AND NOT EXISTS (SELECT 1 FROM refresh_copy rc WHERE rc.id = fp.fee_published_id)
     GROUP BY 1
  `;
  return {
    query: GOAL_QUERIES.wrongAfterPublish,
    ...summarizeWrongAfterPublish(rows.map((row) => ({ reason: row.reason == null ? null : String(row.reason), count: Number(row.count) }))),
  };
}

async function readSpend(db: SqlTag, addedThisWeek: number | null): Promise<GoalSpend> {
  const [usage, policies] = await Promise.all([
    db<Array<{ agent: string; week: number | string; week_calls: number | string; month: number | string }>>`
      SELECT COALESCE(agent_name, 'unattributed') AS agent,
             COALESCE(SUM(estimated_cost_microusd) FILTER (
               WHERE created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)), 0)::bigint AS week,
             (COUNT(*) FILTER (WHERE created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)))::int AS week_calls,
             COALESCE(SUM(estimated_cost_microusd) FILTER (
               WHERE created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS month
        FROM public.ai_api_usage_events
       WHERE ${incurredProviderUsageSql(db)}
         AND created_at >= LEAST(
               NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int),
               date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
       GROUP BY 1
    `,
    db<Array<{ agent_name: string; hard_monthly_microusd: number | string | null }>>`
      SELECT agent_name, hard_monthly_microusd
        FROM public.api_budget_policies
       WHERE policy_key LIKE 'agent:%' AND agent_name IS NOT NULL
    `,
  ]);
  const caps = new Map(policies.map((row) => [String(row.agent_name), row.hard_monthly_microusd == null ? null : usd(row.hard_monthly_microusd)]));
  const byAgent = usage
    .map((row) => ({
      agent: String(row.agent),
      weekUsd: usd(row.week),
      weekCalls: Number(row.week_calls),
      monthUsd: usd(row.month),
      monthlyCapUsd: caps.get(String(row.agent)) ?? null,
    }))
    .sort((a, b) => b.weekUsd - a.weekUsd || a.agent.localeCompare(b.agent));
  const weekUsd = Math.round(byAgent.reduce((sum, row) => sum + row.weekUsd, 0) * 100) / 100;
  return {
    query: GOAL_QUERIES.spend,
    weekUsd,
    costPerNewInstitutionUsd: addedThisWeek && addedThisWeek > 0 ? Math.round((weekUsd / addedThisWeek) * 100) / 100 : null,
    byAgent,
  };
}

async function readKnoxPasses(db: SqlTag, knoxSpend: AgentSpend | undefined): Promise<KnoxPasses> {
  const rows = await db<Array<{ paid: boolean; rows_kept: number | string; documents: number | string; institutions: number | string }>>`
    SELECT (COALESCE(fr.outlier_flags, '[]'::jsonb) ? 'knox_paid_extraction') AS paid,
           COUNT(*)::int AS rows_kept,
           COUNT(DISTINCT fr.source_document_id)::int AS documents,
           COUNT(DISTINCT fr.institution_id)::int AS institutions
      FROM raw_fee_observations fr
     WHERE fr.source = 'knox'
       AND fr.created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
       AND EXISTS (
         SELECT 1 FROM verified_fee_observations fv
          WHERE fv.fee_raw_id = fr.fee_raw_id
            AND fv.review_status IN ('verified', 'approved')
       )
     GROUP BY 1
  `;
  const pass = (paid: boolean): KnoxPass => {
    const row = rows.find((candidate) => Boolean(candidate.paid) === paid);
    return { rowsKept: Number(row?.rows_kept ?? 0), documents: Number(row?.documents ?? 0), institutions: Number(row?.institutions ?? 0) };
  };
  const free = pass(false);
  const paidPass = pass(true);
  const spendUsd = knoxSpend?.weekUsd ?? 0;
  return {
    query: GOAL_QUERIES.knoxPasses,
    free,
    paid: {
      ...paidPass,
      spendUsd,
      calls: knoxSpend?.weekCalls ?? 0,
      costPerRowUsd: paidPass.rowsKept > 0 ? Math.round((spendUsd / paidPass.rowsKept) * 10_000) / 10_000 : null,
    },
    zeroCostShare: ratio(free.rowsKept, free.rowsKept + paidPass.rowsKept),
  };
}

async function readUnstatedAudience(db: SqlTag): Promise<UnstatedAudience> {
  const [row] = await db`
    SELECT COUNT(*)::int AS live_fees,
           (COUNT(*) FILTER (WHERE fee_audience = 'unknown'))::int AS unknown_fees
      FROM published_fee_catalog
  `;
  const liveFees = Number(row?.live_fees ?? 0);
  const unknownFees = Number(row?.unknown_fees ?? 0);
  return { query: GOAL_QUERIES.unstatedAudience, liveFees, unknownFees, share: ratio(unknownFees, liveFees) };
}

async function readAnswerQuality(db: SqlTag): Promise<AnswerQuality | null> {
  const [row] = await db<Array<{ created_at: Date | string; detail: unknown }>>`
    SELECT e.created_at, e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = 'hamilton-answer-eval'
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
       -- An eval stopped at its time budget before asking any institution measures nothing (run 5997).
       AND NOT (e.detail ? 'institutions' AND (e.detail->>'institutions')::numeric = 0)
     ORDER BY e.created_at DESC
     LIMIT 1
  `;
  if (!row) return null;
  const parsed = (r: { created_at: Date | string; detail: unknown }) => ({
    at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    detail: (typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail) as Record<string, unknown> | null,
  });
  const free = parsed(row);
  if (!free.detail) return null;
  // The window's paid samples that answered something, newest first (#1079); each paid path takes the
  // newest that measured it (#1414). A capped or paused run measures nothing. Its own savepoint: a
  // failed paid read leaves the free rates standing.
  const paidRows = await inSavepoint(db, (scope) => scope<Array<{ created_at: Date | string; detail: unknown }>>`
    SELECT e.created_at, e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = 'hamilton-paid-answer-eval'
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
       AND jsonb_path_exists(e.detail, '$.paths[*] ? (@.answers > 0)')
     ORDER BY e.created_at DESC
     LIMIT 30
  `).catch((error) => {
    console.error("Goal scorecard: the paid answer eval could not be read", error);
    return [];
  });
  const paid = paidRows.map(parsed).filter((run): run is PaidRun => Boolean(run.detail));
  return {
    query: GOAL_QUERIES.answerQuality,
    ...answerQualityFrom(free.at, free.detail, paid),
  };
}

/** Monday 00:00 UTC of the week holding `date`, as YYYY-MM-DD (Postgres `date_trunc('week')`). */
export function weekStartUtc(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** The first day `bucketReaderMissWeeks` shows: Monday of the oldest week. */
export function readerMissSince(now: Date, weeks = READER_MISS_WEEKS): string {
  const start = new Date(`${weekStartUtc(now)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7);
  return start.toISOString().slice(0, 10);
}

const emptyKinds = (): Record<BatchMissKind, number> =>
  Object.fromEntries(READER_MISS_KINDS.map((kind) => [kind, 0])) as Record<BatchMissKind, number>;

/**
 * Pure: the batch review's `batch_error_rate` rows, one per batch of 50 reads, summed into
 * the last `weeks` UTC weeks. Every week is listed, so a week with no reviewed batch shows as
 * empty (no rate) rather than dropping out of the trend.
 */
export function bucketReaderMissWeeks(
  rows: Array<{ at: string; evidence: Record<string, unknown> | null }>,
  now: Date,
  weeks = READER_MISS_WEEKS,
): ReaderMissWeek[] {
  const buckets: ReaderMissWeek[] = [];
  const first = new Date(`${readerMissSince(now, weeks)}T00:00:00Z`);
  for (let index = 0; index < weeks; index += 1) {
    const start = new Date(first);
    start.setUTCDate(first.getUTCDate() + index * 7);
    buckets.push({ weekStart: start.toISOString().slice(0, 10), batches: 0, reads: 0, errors: 0, rate: null, byKind: emptyKinds(), partial: index === weeks - 1 });
  }
  const byWeek = new Map(buckets.map((bucket) => [bucket.weekStart, bucket]));
  for (const row of rows) {
    const at = new Date(row.at);
    if (!row.evidence || Number.isNaN(at.getTime())) continue;
    const bucket = byWeek.get(weekStartUtc(at));
    if (!bucket) continue;
    bucket.batches += 1;
    bucket.reads += missCount(row.evidence.reads);
    bucket.errors += missCount(row.evidence.errors);
    const kinds = row.evidence.by_kind as Record<string, unknown> | null | undefined;
    for (const kind of READER_MISS_KINDS) bucket.byKind[kind] += missCount(kinds?.[kind]);
  }
  for (const bucket of buckets) bucket.rate = ratio(bucket.errors, bucket.reads);
  return buckets;
}

async function readReaderMissWeeks(db: SqlTag, now: Date): Promise<ReaderMissWeeks> {
  const rows = await db<Array<{ created_at: Date | string; evidence: unknown }>>`
    SELECT created_at, evidence
      FROM pipeline_feedback
     WHERE check_name = ${BATCH_REVIEW_CHECK}
       AND kind = 'batch_error_rate'
       AND created_at >= ${`${readerMissSince(now)}T00:00:00Z`}::timestamptz
  `;
  return {
    query: GOAL_QUERIES.readerMissWeeks,
    weeks: bucketReaderMissWeeks(rows.map((row) => ({
      at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      evidence: (typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence) as Record<string, unknown> | null,
    })), now),
  };
}

/** Pure: per-remedy counts summed, largest first. */
export function summarizeReaderRemedies(rows: Array<{ remedy: string; remedied: number; knox_found: number }>): Omit<ReaderRemedies, "query"> {
  const byRemedy = rows
    .map((row) => ({ remedy: row.remedy, remedied: Number(row.remedied) || 0, knoxFound: Number(row.knox_found) || 0 }))
    .map((row) => ({ ...row, share: ratio(row.knoxFound, row.remedied) }))
    .sort((a, b) => b.remedied - a.remedied || a.remedy.localeCompare(b.remedy));
  const remedied = byRemedy.reduce((sum, row) => sum + row.remedied, 0);
  const knoxFound = byRemedy.reduce((sum, row) => sum + row.knoxFound, 0);
  return { remedied, knoxFound, share: ratio(knoxFound, remedied), byRemedy };
}

/**
 * Remedies whose Knox fees can land on another document row: a new link search, a JS re-read of
 * a linked document stored as its own row (`covered_by`), and a reopened fee page's new copy.
 * Their success is judged by the institution, not the document (#1581).
 */
const INSTITUTION_JUDGED_REMEDIES = ["magellan_paid_find", "reread_js_fallback", "reopen_fee_page"];

/**
 * Misses the batch review sent to a fix (every remedy but `lesson_only`) in the shown weeks,
 * and how many later gave Knox fees: a Knox fee from the same document after the review, or,
 * for the remedies in `INSTITUTION_JUDGED_REMEDIES`, from the same institution.
 */
async function readReaderRemedies(db: SqlTag, now: Date): Promise<ReaderRemedies> {
  const rows = await db<Array<{ remedy: string; remedied: number; knox_found: number }>>`
    SELECT f.evidence->>'remedy' AS remedy,
           COUNT(*)::int AS remedied,
           (COUNT(*) FILTER (WHERE
             (NOT (f.evidence->>'remedy' = ANY(${INSTITUTION_JUDGED_REMEDIES}::text[])) AND EXISTS (
               SELECT 1 FROM raw_fee_observations fr
                WHERE fr.source = 'knox' AND fr.source_document_id = f.source_document_id AND fr.created_at > f.created_at
             ))
             OR (f.evidence->>'remedy' = ANY(${INSTITUTION_JUDGED_REMEDIES}::text[]) AND EXISTS (
               SELECT 1 FROM raw_fee_observations fr
                WHERE fr.source = 'knox' AND fr.institution_id = f.institution_id AND fr.created_at > f.created_at
             ))
           ))::int AS knox_found
      FROM pipeline_feedback f
     WHERE f.check_name = ${BATCH_REVIEW_CHECK}
       AND f.kind = ANY(${READER_MISS_KINDS}::text[])
       AND f.evidence->>'remedy' IS NOT NULL
       AND f.evidence->>'remedy' <> 'lesson_only'
       AND f.created_at >= ${`${readerMissSince(now)}T00:00:00Z`}::timestamptz
     GROUP BY 1
  `;
  return { query: GOAL_QUERIES.readerRemedies, ...summarizeReaderRemedies(rows) };
}

async function readDataQuality(db: SqlTag): Promise<DataQuality | null> {
  const [row] = await db<Array<{ created_at: Date | string; detail: unknown }>>`
    SELECT e.created_at, e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = 'deming-data-quality'
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.created_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
     ORDER BY e.created_at DESC
     LIMIT 1
  `;
  if (!row) return null;
  const detail = (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as Record<string, unknown> | null;
  const at = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const read = detail ? dataQualityFrom(at, detail) : null;
  return read ? { query: GOAL_QUERIES.dataQuality, ...read } : null;
}

/** One read, in its own savepoint: a failure leaves that number null and the others standing. */
async function guarded<T>(db: SqlTag, name: string, read: (scope: SqlTag) => Promise<T>): Promise<T | null> {
  return inSavepoint(db, read).catch((error) => {
    console.error(`Goal scorecard: ${name} could not be read`, error);
    return null;
  });
}

export async function readGoalScorecard(db: SqlTag = sql, now = new Date()): Promise<GoalScorecard> {
  // Sequential: each read has its own savepoint inside the ledger transaction.
  const coverageCells = await guarded(db, GOAL_QUERIES.coverageCells, readCoverageCells);
  const liveInstitutions = await guarded(db, GOAL_QUERIES.liveInstitutions, readLiveInstitutions);
  const accuracy = await guarded(db, GOAL_QUERIES.accuracy, readAccuracy);
  const wrongAfterPublish = await guarded(db, GOAL_QUERIES.wrongAfterPublish, readWrongAfterPublish);
  const spend = await guarded(db, GOAL_QUERIES.spend, (scope) => readSpend(scope, liveInstitutions?.addedThisWeek ?? null));
  const knoxPasses = await guarded(db, GOAL_QUERIES.knoxPasses, (scope) =>
    readKnoxPasses(scope, spend?.byAgent.find((row) => row.agent === "knox")));
  const unstatedAudience = await guarded(db, GOAL_QUERIES.unstatedAudience, readUnstatedAudience);
  const answerQuality = await guarded(db, GOAL_QUERIES.answerQuality, readAnswerQuality);
  const readerMisses = await guarded(db, GOAL_QUERIES.readerMissWeeks, (scope) => readReaderMissWeeks(scope, now));
  const readerRemedies = await guarded(db, GOAL_QUERIES.readerRemedies, (scope) => readReaderRemedies(scope, now));
  const dataQuality = await guarded(db, GOAL_QUERIES.dataQuality, readDataQuality);
  return {
    readAt: now.toISOString(),
    windowDays: GOAL_WINDOW_DAYS,
    coverageCells,
    liveInstitutions,
    accuracy,
    wrongAfterPublish,
    spend,
    knoxPasses: spend ? knoxPasses : null,
    unstatedAudience,
    answerQuality,
    readerMisses,
    readerRemedies,
    dataQuality,
  };
}

const pct = (value: number | null | undefined) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const count = (value: number) => value.toLocaleString("en-US");
const signedCount = (value: number) => `${value > 0 ? "+" : ""}${count(value)}`;

/** One clause for the step summary: the three numbers the goal turns on. */
export function goalHeadline(goal: GoalScorecard): string {
  const c = goal.coverageCells;
  return [
    c ? `${c.readyCells} of ${c.totalCells} groups covered` : "coverage n/a",
    `stored-copy support ${pct(goal.accuracy?.accuracy)} (7 days)`,
    `wrong after publish ${pct(goal.wrongAfterPublish?.rate)}`,
  ].join(", ");
}

/** Plain lines for the morning brief: the same numbers as the page, unknown said as unknown. */
export function goalBriefLines(goal: GoalScorecard): string[] {
  const lines: string[] = [];
  const c = goal.coverageCells;
  lines.push(c
    ? `Coverage: ${c.readyCells} of ${c.totalCells} state and size groups under $10B meet the target; ${count(c.institutionsShort)} more covered institutions would close the gap${c.institutionsShortWeekAgo == null ? "" : ` (${count(c.institutionsShortWeekAgo)} 7 days ago)`}.`
    : "Coverage: could not be read today.");
  const gaps = c?.byState?.filter((state) => state.institutionsShort > 0).slice(0, 5) ?? [];
  if (gaps.length > 0) {
    lines.push(`Largest state gaps (institutions short now, 7 days ago): ${gaps.map((state) => `${state.state} ${count(state.institutionsShort)} (${count(state.institutionsShortWeekAgo)})`).join(", ")}.`);
  }
  const live = goal.liveInstitutions;
  lines.push(live
    ? `Institutions with live fees: ${count(live.live)}, ${count(live.addedThisWeek)} added in the last 7 days${live.droppedThisWeek == null ? "" : ` and ${count(live.droppedThisWeek)} dropped (net ${signedCount(live.addedThisWeek - live.droppedThisWeek)})`}.`
    : "Institutions with live fees: could not be read today.");
  const a = goal.accuracy;
  lines.push(!a ? "Automated stored-copy audit: could not be read today."
    : a.accuracy == null
      ? `Automated stored-copy audit: not enough audited fees in the last 7 days (${count(a.scorable)} scorable, ${a.audits} audits).`
      : `Automated stored-copy audit: ${(Math.floor(a.accuracy * 10000) / 100).toFixed(2)}% over the last 7 days${a.range ? ` (95% range ${formatAccuracyBound(a.range.low, "low")}–${formatAccuracyBound(a.range.high, "high")})` : ""}: ${count(a.right)} of ${count(a.scorable)} fees supported, ${a.audits} Deming audits; diagnostic target ${ACCURACY_TARGET_LABEL}, ${accuracyStatusLabel(a)}.`);
  const w = goal.wrongAfterPublish;
  lines.push(w
    ? `Wrong after publish: ${pct(w.rate)} (${count(w.wrong)} of ${count(w.published)} fees published in the last 7 days taken down as errors).`
    : "Wrong after publish: could not be read today.");
  const s = goal.spend;
  lines.push(s
    ? `Provider spend, last 7 days: $${s.weekUsd.toFixed(2)}${s.costPerNewInstitutionUsd == null ? "; no institutions added, so no cost per new one" : `; $${s.costPerNewInstitutionUsd.toFixed(2)} per institution added`}.`
    : "Provider spend: could not be read today.");
  const k = goal.knoxPasses;
  if (k) {
    lines.push(`Knox, last 7 days: ${count(k.free.rowsKept)} fees kept from the free pass and ${count(k.paid.rowsKept)} from the paid pass ($${k.paid.spendUsd.toFixed(2)}, ${count(k.paid.calls)} calls${k.paid.costPerRowUsd == null ? "" : `, ${(k.paid.costPerRowUsd * 100).toFixed(1)} cents per fee`}); ${pct(k.zeroCostShare)} found at $0.`);
  }
  const u = goal.unstatedAudience;
  if (u) lines.push(`Audience not stated: ${pct(u.share)} of live fees (${count(u.unknownFees)} of ${count(u.liveFees)}) carry the asterisk.`);
  const q = goal.answerQuality;
  if (q) {
    const measured = q.paths.filter((p) => p.measured);
    const sampleDay = (p: AnswerPathQuality) => (p.at && q.paidAt && p.at.slice(0, 10) !== q.paidAt.slice(0, 10) ? ` (sample of ${p.at.slice(0, 10)})` : "");
    const parts = measured.map((p) => `${p.label}${sampleDay(p)}: form ${pct(p.formRate)} (${p.formPassed} of ${p.answers}), figures tie out ${p.checked == null ? "not checked" : `${pct(p.correctRate)} (${p.correct} of ${p.checked})`}`);
    const unmeasured = q.paths.filter((p) => !p.measured).map((p) => p.label.replace(/ \(paid\)$/, "").toLowerCase());
    const paidAt = q.paidAt ? `; paid sample of ${q.paidAt.slice(0, 16).replace("T", " ")} UTC` : "";
    const completeness = [
      q.institutionsAsked != null && q.institutionsPlanned != null ? `${q.institutionsAsked} of ${q.institutionsPlanned} planned institutions asked` : null,
      q.proQuestionsAsked != null && q.proQuestionsPlanned != null ? `${q.proQuestionsAsked} of ${q.proQuestionsPlanned} Pro questions replayed` : null,
    ].filter(Boolean).join(", ");
    const smallPaid = measured.some(p => PAID_ANSWER_PATHS.some(paid => paid.path === p.path) && (p.answers ?? 0) < 10)
      ? " Paid paths with fewer than 10 answers are small samples, not reliability estimates." : "";
    const rest = unmeasured.length === PAID_ANSWER_PATHS.length
      ? " Paid paths not measured yet."
      : unmeasured.length > 0 ? ` Not measured yet: ${unmeasured.join(", ")}.` : "";
    lines.push(`Hamilton answers (eval of ${q.at.slice(0, 16).replace("T", " ")} UTC${q.timedOut ? ", stopped at its time budget" : ""}${paidAt}${completeness ? `; ${completeness}` : ""}): ${parts.join("; ")}.${rest}${smallPaid}`);
  }
  const d = goal.dataQuality;
  if (d) {
    lines.push(d.failing.length === 0
      ? `Data checks (${d.at.slice(0, 10)}): no check failed its threshold${d.warning.length > 0 ? `; ${d.warning.length} to watch` : ""}.`
      : `Data checks (${d.at.slice(0, 10)}): ALARM, ${d.failing.length} failed their threshold (${d.failing.join(", ")}).`);
  }
  return lines;
}
