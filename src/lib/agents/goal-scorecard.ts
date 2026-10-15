import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { FRESH_AUDIT_MIN_SCORABLE } from "@/lib/agents/deming/fresh-audit";

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
} as const;

export interface CoverageCells {
  query: string;
  readyCells: number;
  totalCells: number;
  /** Covered institutions still needed to bring every group to its target. */
  institutionsShort: number;
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
}

export interface WeeklyAccuracy {
  query: string;
  /** Right ÷ scorable over every Deming fresh audit in the window; null below the minimum sample. */
  accuracy: number | null;
  right: number;
  scorable: number;
  audits: number;
  latestAt: string | null;
  latestAccuracy: number | null;
  /** 95% Wilson range around `accuracy` (200 fees gives about ±3–4 points); null with no percentage. */
  range: { low: number; high: number } | null;
  /** One dated row per audit in the window, newest first, kept with each daily snapshot (#1119). */
  daily: FreshAuditDay[];
  /** Misses per check across the window. */
  misses: FreshAuditMisses;
}

export interface FreshAuditMisses {
  amount: number;
  category: number;
  evidence: number;
  notAFee: number;
  name: number;
}

export interface FreshAuditDay extends FreshAuditMisses {
  at: string;
  right: number;
  scorable: number;
  accuracy: number | null;
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
}

export interface AnswerQuality {
  query: string;
  /** When the free eval run finished (ISO): the date its rates are for. */
  at: string;
  /** When the latest paid sample finished (ISO), the date the paid rates are for; null when none ran in the window. */
  paidAt?: string | null;
  timedOut: boolean;
  paths: AnswerPathQuality[];
}

/** The paid paths. Memos, one Simulate read and one written answer are sampled daily (`paid-answer-eval.ts`, five a day); reports are not yet. */
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

/** The latest answer eval's detail as one row per path; an eval from before #1079 has no correctness. */
export function answerQualityFrom(
  at: string,
  detail: Record<string, unknown>,
  paid: { at: string; detail: Record<string, unknown> } | null = null,
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
  // The paid sample's rows by path; a path with no memo answered measures nothing yet.
  const paidRows = new Map(
    (Array.isArray(paid?.detail.paths) ? (paid!.detail.paths as Array<Record<string, unknown>>) : [])
      .filter((row) => Number(row.answers ?? 0) > 0)
      .map((row) => [String(row.path), row] as const),
  );
  return {
    at,
    paidAt: paidRows.size > 0 ? paid!.at : null,
    timedOut: detail.timedOut === true,
    paths: [
      path("free_ask", "Free Ask, standard questions", detail.answers, detail.passed, detail.correctness),
      ...(pro ? [path("pro_replay", "Free Ask, Pro readers' questions", pro.questions, pro.passed, pro.correctness)] : []),
      ...PAID_ANSWER_PATHS.map((p) => {
        const row = paidRows.get(p.path);
        return row
          ? path(p.path, p.label, row.answers, row.passed, row.correctness)
          : { ...p, measured: false, answers: null, formPassed: null, formRate: null, checked: null, correct: null, correctRate: null };
      }),
    ],
  };
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
    ? db`EXISTS (
        SELECT 1 FROM public.published_fee_records fp
         WHERE fp.institution_id = i.id
           AND fp.published_at < NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
           AND (fp.rolled_back_at IS NULL OR fp.rolled_back_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int))
      )`
    : db`FALSE`;
  return db`
    WITH live AS MATERIALIZED (
      SELECT DISTINCT institution_id FROM public.published_fee_catalog
    )
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

/** Pure: Deming's fresh-audit step details from the window, pooled. */
/** 95% Wilson score interval for `right` of `n`; rounded to four places. */
export function wilsonRange(right: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = right / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
  return { low: round((centre - margin) / denominator), high: round((centre + margin) / denominator) };
}

const missCount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Pure: Deming's fresh-audit step details from the window, pooled, with a dated row per audit. */
export function poolFreshAudits(events: Array<{ at: string; detail: Record<string, unknown> | null }>): Omit<WeeklyAccuracy, "query"> {
  let right = 0;
  let scorable = 0;
  const daily: FreshAuditDay[] = [];
  for (const event of events) {
    if (!event.detail || event.detail.readable === false) continue;
    const r = Number(event.detail.right);
    const s = Number(event.detail.scorable);
    if (!Number.isFinite(r) || !Number.isFinite(s) || s <= 0) continue;
    right += r;
    scorable += s;
    daily.push({
      at: event.at,
      right: r,
      scorable: s,
      accuracy: ratio(r, s),
      amount: missCount(event.detail.amount_miss),
      category: missCount(event.detail.category_miss),
      evidence: missCount(event.detail.evidence_miss),
      notAFee: missCount(event.detail.not_a_fee),
      name: missCount(event.detail.name_miss),
    });
  }
  daily.sort((a, b) => b.at.localeCompare(a.at));
  const newest = [...events].sort((a, b) => b.at.localeCompare(a.at))[0];
  const latestAccuracy = newest?.detail?.accuracy == null ? null : Number(newest.detail.accuracy);
  const enough = scorable >= FRESH_AUDIT_MIN_SCORABLE;
  const sum = (key: keyof FreshAuditMisses) => daily.reduce((total, day) => total + day[key], 0);
  return {
    accuracy: enough ? ratio(right, scorable) : null,
    right,
    scorable,
    audits: daily.length,
    latestAt: newest?.at ?? null,
    latestAccuracy: Number.isFinite(latestAccuracy) ? latestAccuracy : null,
    range: enough ? wilsonRange(right, scorable) : null,
    daily,
    misses: { amount: sum("amount"), category: sum("category"), evidence: sum("evidence"), notAFee: sum("notAFee"), name: sum("name") },
  };
}

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
  const [row] = await db`
    SELECT COUNT(*)::int AS live,
           (COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM published_fee_records fp
              WHERE fp.institution_id = live.institution_id
                AND fp.published_at < NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int)
                AND (fp.rolled_back_at IS NULL OR fp.rolled_back_at >= NOW() - make_interval(days => ${GOAL_WINDOW_DAYS}::int))
           )))::int AS added
      FROM (SELECT DISTINCT institution_id FROM published_fee_catalog) live
  `;
  return { query: GOAL_QUERIES.liveInstitutions, live: Number(row?.live ?? 0), addedThisWeek: Number(row?.added ?? 0) };
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
       WHERE status = 'completed'
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
  // The latest paid sample that wrote at least one memo (#1079); a capped or paused run measures nothing.
  // Its own savepoint: a failed paid read leaves the free rates standing.
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
     LIMIT 1
  `).catch((error) => {
    console.error("Goal scorecard: the paid answer eval could not be read", error);
    return [];
  });
  const paid = paidRows[0] ? parsed(paidRows[0]) : null;
  return {
    query: GOAL_QUERIES.answerQuality,
    ...answerQualityFrom(free.at, free.detail, paid?.detail ? { at: paid.at, detail: paid.detail } : null),
  };
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
  };
}

const pct = (value: number | null | undefined) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const count = (value: number) => value.toLocaleString("en-US");

/** One clause for the step summary: the three numbers the goal turns on. */
export function goalHeadline(goal: GoalScorecard): string {
  const c = goal.coverageCells;
  return [
    c ? `${c.readyCells} of ${c.totalCells} groups covered` : "coverage n/a",
    `accuracy ${pct(goal.accuracy?.accuracy)} (7 days)`,
    `wrong after publish ${pct(goal.wrongAfterPublish?.rate)}`,
  ].join(", ");
}

/** Plain lines for the morning brief: the same numbers as the page, unknown said as unknown. */
export function goalBriefLines(goal: GoalScorecard): string[] {
  const lines: string[] = [];
  const c = goal.coverageCells;
  lines.push(c
    ? `Coverage: ${c.readyCells} of ${c.totalCells} state and size groups under $10B meet the target; ${count(c.institutionsShort)} more covered institutions would close the gap.`
    : "Coverage: could not be read today.");
  const gaps = c?.byState?.filter((state) => state.institutionsShort > 0).slice(0, 5) ?? [];
  if (gaps.length > 0) {
    lines.push(`Largest state gaps (institutions short now, 7 days ago): ${gaps.map((state) => `${state.state} ${count(state.institutionsShort)} (${count(state.institutionsShortWeekAgo)})`).join(", ")}.`);
  }
  const live = goal.liveInstitutions;
  lines.push(live
    ? `Institutions with live fees: ${count(live.live)}, ${count(live.addedThisWeek)} added in the last 7 days.`
    : "Institutions with live fees: could not be read today.");
  const a = goal.accuracy;
  lines.push(!a ? "Accuracy: could not be read today."
    : a.accuracy == null
      ? `Accuracy: not enough audited fees in the last 7 days (${count(a.scorable)} scorable, ${a.audits} audits).`
      : `Accuracy: ${pct(a.accuracy)} over the last 7 days${a.range ? ` (95% range ${pct(a.range.low)}–${pct(a.range.high)})` : ""}: ${count(a.right)} of ${count(a.scorable)} fees right, ${a.audits} Deming audits; target 95%.`);
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
    const parts = measured.map((p) => `${p.label}: form ${pct(p.formRate)} (${p.formPassed} of ${p.answers}), figures tie out ${p.checked == null ? "not checked" : `${pct(p.correctRate)} (${p.correct} of ${p.checked})`}`);
    const unmeasured = q.paths.filter((p) => !p.measured).map((p) => p.label.replace(/ \(paid\)$/, "").toLowerCase());
    const paidAt = q.paidAt ? `; paid sample of ${q.paidAt.slice(0, 16).replace("T", " ")} UTC` : "";
    const rest = unmeasured.length === PAID_ANSWER_PATHS.length
      ? " Paid paths not measured yet."
      : unmeasured.length > 0 ? ` Not measured yet: ${unmeasured.join(", ")}.` : "";
    lines.push(`Hamilton answers (eval of ${q.at.slice(0, 16).replace("T", " ")} UTC${q.timedOut ? ", stopped at its time budget" : ""}${paidAt}): ${parts.join("; ")}.${rest}`);
  }
  return lines;
}
