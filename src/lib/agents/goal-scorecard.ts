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
} as const;

export interface CoverageCells {
  query: string;
  readyCells: number;
  totalCells: number;
  /** Covered institutions still needed to bring every group to its target. */
  institutionsShort: number;
  bySize: Array<{ size: SizeGroupKey; label: string; readyCells: number; totalCells: number; institutionsShort: number }>;
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

/** Pure: covered/total per state × size group into ready cells and the gap. */
export function summarizeCoverageCells(rows: Array<{ size_group: string; total: number; covered: number }>): Omit<CoverageCells, "query"> {
  const bySize = SIZE_GROUPS.map((group) => {
    const cells = rows.filter((row) => row.size_group === group.key && row.total > 0);
    const ready = cells.filter((row) => row.covered >= coverageTarget(row.total)).length;
    const short = cells.reduce((sum, row) => sum + Math.max(0, coverageTarget(row.total) - row.covered), 0);
    return { size: group.key, label: group.label, readyCells: ready, totalCells: cells.length, institutionsShort: short };
  });
  return {
    readyCells: bySize.reduce((sum, row) => sum + row.readyCells, 0),
    totalCells: bySize.reduce((sum, row) => sum + row.totalCells, 0),
    institutionsShort: bySize.reduce((sum, row) => sum + row.institutionsShort, 0),
    bySize,
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
  const rows = await db<Array<{ size_group: string; total: number | string; covered: number | string }>>`
    WITH live AS (SELECT DISTINCT institution_id FROM published_fee_catalog),
    inst AS (
      SELECT i.state_code,
             CASE WHEN i.asset_size < ${SIZE_GROUPS[0].maxThousands} THEN ${SIZE_GROUPS[0].key}
                  WHEN i.asset_size < ${SIZE_GROUPS[1].maxThousands} THEN ${SIZE_GROUPS[1].key}
                  ELSE ${SIZE_GROUPS[2].key} END AS size_group,
             (live.institution_id IS NOT NULL) AS covered
        FROM institution_sources i
        LEFT JOIN live ON live.institution_id = i.id
       WHERE COALESCE(i.status, 'active') = 'active'
         AND NULLIF(btrim(i.state_code), '') IS NOT NULL
         AND i.asset_size IS NOT NULL
         AND i.asset_size < ${SIZE_GROUPS[2].maxThousands}
    )
    SELECT state_code, size_group, COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE covered))::int AS covered
      FROM inst
     GROUP BY 1, 2
  `;
  return {
    query: GOAL_QUERIES.coverageCells,
    ...summarizeCoverageCells(rows.map((row) => ({ size_group: String(row.size_group), total: Number(row.total), covered: Number(row.covered) }))),
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
  return lines;
}
