import { sql } from "@/lib/data-store/connection";
import { statsRowFilter } from "@/lib/data-store/fee-stats";
import { isSuccessOutcome, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { inSavepoint } from "@/lib/agents/savepoint";
import { assetSizeTier } from "@/lib/regulatory/fdic";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";
import { STATE_NAMES } from "@/lib/us-states";

import { stateExpertFor } from "./roster";

type SqlTag = typeof sql;

/**
 * A state expert's memory: what the pipeline knows about one state, refreshed by the
 * deterministic `state-expert` lane step from data already in Postgres. No provider
 * calls. Darwin's peer check, Hamilton's report hook and the Magellan/Rosetta strategy
 * hints all read it.
 */

/** A peer level needs this many institutions before anyone acts on it. */
export const PEER_MIN_INSTITUTIONS = 8;
/** Version of the sourced consumer-only price population in persisted peer levels. */
export const PEER_AUDIENCE_POLICY_VERSION = 1;
/** A fee below p25 / this, or above p75 * this, is far outside its peers. */
export const PEER_RANGE_FACTOR = 3;
/** Tier label for the state-wide level of a fee (all asset sizes together). */
export const ALL_TIERS = "all";
/** Attempts older than this do not count toward a state's strategy ranking. */
export const STRATEGY_LOOKBACK_DAYS = 180;
/** A strategy with at least this many attempts and no success goes on the avoid list. */
export const AVOID_MIN_ATTEMPTS = 5;

export interface PeerLevel {
  canonicalFeeKey: string;
  /** An asset-size tier (`community_small` … `super_regional`, `unknown`) or `all`. */
  tier: string;
  p25: number;
  median: number;
  p75: number;
  /** Institutions behind the level (each institution counts once). */
  count: number;
  /** Absent on legacy mixed-audience state_memory rows; those levels must not be reused. */
  audiencePolicyVersion?: number;
}

/** Fail closed on persisted pre-audience peer levels after the schema rollout. */
export function currentAudiencePeerLevels(levels: readonly PeerLevel[]): boolean {
  return levels.length > 0 && levels.every((level) => level.audiencePolicyVersion === PEER_AUDIENCE_POLICY_VERSION);
}

export interface StrategyRank {
  stage: string;
  strategy: string;
  attempts: number;
  successes: number;
  successRate: number;
  meanYield: number;
  meanCostMicrousd: number;
}

export interface StateStrategies {
  finder: StrategyRank[];
  reader: StrategyRank[];
}

export interface StatePlatform {
  platform: string;
  institutions: number;
}

export interface StateRegulatorMemory {
  agency: string | null;
  website: string | null;
  creditUnionAgency: string | null;
  creditUnionWebsite: string | null;
  source: "state_regulators" | "roster";
}

export interface StateMemory {
  stateCode: string;
  stateName: string | null;
  expertName: string;
  expertBio: string;
  regulator: StateRegulatorMemory;
  platforms: StatePlatform[];
  strategies: StateStrategies;
  peerLevels: PeerLevel[];
  institutionCount: number;
  publishedFeeCount: number;
  refreshedAt: string | null;
}

/**
 * The asset-size tier in SQL, matching `assetSizeTier` (asset_size in thousands). A
 * stored `asset_size_tier` wins; institutions with no asset size are `unknown`.
 */
export function assetTierSql(alias: string): string {
  return `COALESCE(NULLIF(btrim(${alias}.asset_size_tier), ''), CASE
      WHEN ${alias}.asset_size IS NULL THEN 'unknown'
      WHEN ${alias}.asset_size < 300000 THEN 'community_small'
      WHEN ${alias}.asset_size < 1000000 THEN 'community_mid'
      WHEN ${alias}.asset_size < 10000000 THEN 'community_large'
      WHEN ${alias}.asset_size < 50000000 THEN 'regional'
      WHEN ${alias}.asset_size < 250000000 THEN 'large_regional'
      ELSE 'super_regional'
    END)`;
}

/** The same tier in TypeScript, for a row already in hand. */
export function institutionTier(storedTier: string | null | undefined, assetSize: unknown): string {
  const stored = storedTier?.trim();
  if (stored) return stored;
  if (assetSize == null || assetSize === "") return "unknown";
  return assetSizeTier(Number(assetSize)) ?? "unknown";
}

function round2(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function emptyStrategies(): StateStrategies {
  return { finder: [], reader: [] };
}

/** Swallows a failed optional read (a missing table or column) without aborting the step's transaction. */
async function optionalRead<T>(db: SqlTag, fallback: T, read: (scope: SqlTag) => Promise<T>): Promise<T> {
  try {
    return await inSavepoint(db, read);
  } catch (error) {
    console.error("state memory read skipped:", error instanceof Error ? error.message : error);
    return fallback;
  }
}

/** p25/median/p75 per canonical fee for each asset-size tier and for the whole state. */
export async function computeStatePeerLevels(db: SqlTag, stateCode: string): Promise<PeerLevel[]> {
  const rows = await db.unsafe<Array<{
    canonical_fee_key: string;
    tier: string;
    p25: string | number;
    median: string | number;
    p75: string | number;
    institutions: string | number;
  }>>(
    `
      WITH per_institution AS (
        SELECT c.institution_id,
               c.canonical_fee_key,
               ${assetTierSql("inst")} AS tier,
               CASE WHEN c.canonical_fee_key = 'overdraft' THEN MAX(c.amount)
                    ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY c.amount) END AS amount
          FROM published_fee_catalog c
          JOIN institution_sources inst ON inst.id = c.institution_id
         WHERE upper(btrim(inst.state_code)) = $1
           AND COALESCE(inst.status, 'active') = 'active'
           AND c.amount IS NOT NULL
           AND c.amount >= 0
           AND ${statsRowFilter("c")}
         GROUP BY 1, 2, 3
      )
      SELECT canonical_fee_key,
             CASE WHEN GROUPING(tier) = 1 THEN '${ALL_TIERS}' ELSE tier END AS tier,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) AS p75,
             COUNT(*) AS institutions
        FROM per_institution
       GROUP BY GROUPING SETS ((canonical_fee_key, tier), (canonical_fee_key))
       ORDER BY canonical_fee_key, tier
    `,
    [stateCode],
  );
  return rows.map((row) => ({
    canonicalFeeKey: String(row.canonical_fee_key),
    tier: String(row.tier),
    p25: round2(row.p25),
    median: round2(row.median),
    p75: round2(row.p75),
    count: Number(row.institutions ?? 0),
    audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION,
  }));
}

/**
 * The level to judge a fee against: its asset-size tier when that tier has enough
 * peers, else the state-wide level when that does, else null (no peer check).
 */
export function peerLevelFor(levels: readonly PeerLevel[], canonicalFeeKey: string, tier: string): PeerLevel | null {
  const forKey = levels.filter((level) => level.canonicalFeeKey === canonicalFeeKey);
  const tiered = forKey.find((level) => level.tier === tier && level.count >= PEER_MIN_INSTITUTIONS);
  if (tiered) return tiered;
  return forKey.find((level) => level.tier === ALL_TIERS && level.count >= PEER_MIN_INSTITUTIONS) ?? null;
}

/** The range a fee may sit in before it counts as far outside its peers. */
export function peerRange(level: PeerLevel): { low: number; high: number } {
  return {
    low: round2(level.p25 / PEER_RANGE_FACTOR),
    high: round2(level.p75 * PEER_RANGE_FACTOR),
  };
}

export function isPeerOutlier(amount: number, level: PeerLevel): boolean {
  const { low, high } = peerRange(level);
  return amount < low || amount > high;
}

/** Pure: per-strategy totals from (stage, strategy, outcome) counts, best first. */
export function rankStrategies(rows: ReadonlyArray<{
  stage: string;
  strategy: string;
  outcome: string;
  attempts: number;
  yield_sum: number;
  cost_sum: number;
}>): StateStrategies {
  const totals = new Map<string, { stage: string; strategy: string; attempts: number; successes: number; yieldSum: number; costSum: number }>();
  for (const row of rows) {
    const key = `${row.stage}|${row.strategy}`;
    const entry = totals.get(key) ?? { stage: row.stage, strategy: row.strategy, attempts: 0, successes: 0, yieldSum: 0, costSum: 0 };
    const attempts = Number(row.attempts) || 0;
    entry.attempts += attempts;
    if (isSuccessOutcome(row.outcome as AttemptOutcome)) entry.successes += attempts;
    entry.yieldSum += Number(row.yield_sum) || 0;
    entry.costSum += Number(row.cost_sum) || 0;
    totals.set(key, entry);
  }
  const ranks: StrategyRank[] = Array.from(totals.values()).map((entry) => ({
    stage: entry.stage,
    strategy: entry.strategy,
    attempts: entry.attempts,
    successes: entry.successes,
    successRate: entry.attempts === 0 ? 0 : Math.round((entry.successes / entry.attempts) * 1000) / 1000,
    meanYield: entry.attempts === 0 ? 0 : Math.round((entry.yieldSum / entry.attempts) * 100) / 100,
    meanCostMicrousd: entry.attempts === 0 ? 0 : Math.round(entry.costSum / entry.attempts),
  }));
  // Most reliable first, then cheapest, then highest yield, then most evidence.
  const order = (a: StrategyRank, b: StrategyRank) =>
    b.successRate - a.successRate ||
    a.meanCostMicrousd - b.meanCostMicrousd ||
    b.meanYield - a.meanYield ||
    b.attempts - a.attempts ||
    a.strategy.localeCompare(b.strategy);
  return {
    finder: ranks.filter((rank) => rank.stage === "discover").sort(order),
    reader: ranks.filter((rank) => rank.stage === "read").sort(order),
  };
}

async function loadStrategies(db: SqlTag, stateCode: string): Promise<StateStrategies> {
  return optionalRead(db, emptyStrategies(), async (scope) => {
    const rows = await scope<Array<{
      stage: string;
      strategy: string;
      outcome: string;
      attempts: string | number;
      yield_sum: string | number;
      cost_sum: string | number;
    }>>`
      SELECT pa.stage, pa.strategy, pa.outcome,
             COUNT(*) AS attempts,
             COALESCE(SUM(pa.yield_count), 0) AS yield_sum,
             COALESCE(SUM(pa.cost_microusd), 0) AS cost_sum
        FROM pipeline_attempts pa
        JOIN institution_sources inst ON inst.id = pa.institution_id
       WHERE upper(btrim(inst.state_code)) = ${stateCode}
         AND pa.stage IN ('discover', 'read')
         AND pa.created_at > NOW() - ${STRATEGY_LOOKBACK_DAYS} * INTERVAL '1 day'
       GROUP BY 1, 2, 3
    `;
    return rankStrategies(rows.map((row) => ({
      stage: String(row.stage),
      strategy: String(row.strategy),
      outcome: String(row.outcome),
      attempts: Number(row.attempts),
      yield_sum: Number(row.yield_sum),
      cost_sum: Number(row.cost_sum),
    })));
  });
}

async function loadPlatforms(db: SqlTag, stateCode: string): Promise<StatePlatform[]> {
  const read = (withProfiles: boolean) => async (scope: SqlTag) => {
    const platform = withProfiles
      ? "COALESCE(NULLIF(btrim(profile.platform), ''), NULLIF(btrim(inst.cms_platform), ''))"
      : "NULLIF(btrim(inst.cms_platform), '')";
    const join = withProfiles
      ? "LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id"
      : "";
    const rows = await scope.unsafe<Array<{ platform: string; institutions: string | number }>>(
      `
        SELECT lower(${platform}) AS platform, COUNT(*) AS institutions
          FROM institution_sources inst
          ${join}
         WHERE upper(btrim(inst.state_code)) = $1
           AND COALESCE(inst.status, 'active') = 'active'
           AND ${platform} IS NOT NULL
         GROUP BY 1
         ORDER BY 2 DESC, 1 ASC
         LIMIT 10
      `,
      [stateCode],
    );
    return rows.map((row) => ({ platform: String(row.platform), institutions: Number(row.institutions) }));
  };
  const withProfiles = await optionalRead<StatePlatform[] | null>(db, null, read(true));
  return withProfiles ?? optionalRead(db, [], read(false));
}

async function loadRegulator(db: SqlTag, stateCode: string): Promise<StateRegulatorMemory> {
  const [row] = await optionalRead(db, [] as Array<Record<string, string | null>>, (scope) => scope<Array<Record<string, string | null>>>`
    SELECT agency_name, website_url, credit_union_agency_name, credit_union_website_url
      FROM state_regulators
     WHERE state_code = ${stateCode}
  `);
  if (row?.agency_name) {
    return {
      agency: row.agency_name,
      website: row.website_url ?? null,
      creditUnionAgency: row.credit_union_agency_name ?? null,
      creditUnionWebsite: row.credit_union_website_url ?? null,
      source: "state_regulators",
    };
  }
  // The registry step has not stored it yet: use the reviewed constant it upserts from.
  const known = STATE_REGULATORS.find((entry) => entry.stateCode === stateCode);
  return {
    agency: known?.agency ?? null,
    website: known?.website ?? null,
    creditUnionAgency: known?.creditUnionAgency ?? null,
    creditUnionWebsite: known?.creditUnionWebsite ?? null,
    source: "roster",
  };
}

async function loadCounts(db: SqlTag, stateCode: string): Promise<{ institutions: number; publishedFees: number }> {
  const [row] = await optionalRead(db, [] as Array<{ institutions: string | number; published_fees: string | number }>, (scope) => scope<Array<{ institutions: string | number; published_fees: string | number }>>`
    SELECT
      (SELECT COUNT(*) FROM institution_sources inst
        WHERE upper(btrim(inst.state_code)) = ${stateCode}
          AND COALESCE(inst.status, 'active') = 'active') AS institutions,
      (SELECT COUNT(*) FROM published_fee_catalog c
         JOIN institution_sources inst ON inst.id = c.institution_id
        WHERE upper(btrim(inst.state_code)) = ${stateCode}) AS published_fees
  `);
  return { institutions: Number(row?.institutions ?? 0), publishedFees: Number(row?.published_fees ?? 0) };
}

const schemaReady = new WeakMap<object, boolean>();

/** True once the state_memory migration is applied. A catalog query that cannot fail; only a yes is cached. */
export async function stateMemorySchemaReady(db: SqlTag): Promise<boolean> {
  if (schemaReady.get(db)) return true;
  const [row] = await db<Array<{ ready: boolean }>>`
    SELECT to_regclass('public.state_memory') IS NOT NULL AS ready
  `;
  const ready = row?.ready === true;
  if (ready) schemaReady.set(db, true);
  return ready;
}

/** Builds a state's memory from current data. Read-only. */
export async function buildStateMemory(db: SqlTag, stateCode: string): Promise<StateMemory | null> {
  const expert = stateExpertFor(stateCode);
  if (!expert) return null;
  const [regulator, platforms, strategies, peerLevels, counts] = [
    await loadRegulator(db, expert.stateCode),
    await loadPlatforms(db, expert.stateCode),
    await loadStrategies(db, expert.stateCode),
    await optionalRead(db, [] as PeerLevel[], (scope) => computeStatePeerLevels(scope, expert.stateCode)),
    await loadCounts(db, expert.stateCode),
  ];
  return {
    stateCode: expert.stateCode,
    stateName: STATE_NAMES[expert.stateCode] ?? null,
    expertName: expert.name,
    expertBio: expert.bio,
    regulator,
    platforms,
    strategies,
    peerLevels,
    institutionCount: counts.institutions,
    publishedFeeCount: counts.publishedFees,
    refreshedAt: new Date().toISOString(),
  };
}

export interface RefreshStateMemoryResult {
  memory: StateMemory | null;
  /** False when the state_memory table is not there yet or the run is a dry run. */
  stored: boolean;
}

/** Rebuilds a state's memory and stores it (unless dry run or the table is missing). */
export async function refreshStateMemory(
  db: SqlTag,
  stateCode: string,
  options: { runId?: number | null; dryRun?: boolean } = {},
): Promise<RefreshStateMemoryResult> {
  const memory = await buildStateMemory(db, stateCode);
  if (!memory || options.dryRun || !(await stateMemorySchemaReady(db))) return { memory, stored: false };
  await db`
    INSERT INTO state_memory (
      state_code, expert_name, expert_bio, regulator, platforms, strategies, peer_levels,
      institution_count, published_fee_count, last_agent_run_id, refreshed_at, updated_at
    )
    VALUES (
      ${memory.stateCode}, ${memory.expertName}, ${memory.expertBio},
      ${JSON.stringify(memory.regulator)}::jsonb, ${JSON.stringify(memory.platforms)}::jsonb,
      ${JSON.stringify(memory.strategies)}::jsonb, ${JSON.stringify(memory.peerLevels)}::jsonb,
      ${memory.institutionCount}, ${memory.publishedFeeCount}, ${options.runId ?? null}, NOW(), NOW()
    )
    ON CONFLICT (state_code) DO UPDATE SET
      expert_name = EXCLUDED.expert_name,
      expert_bio = EXCLUDED.expert_bio,
      regulator = EXCLUDED.regulator,
      platforms = EXCLUDED.platforms,
      strategies = EXCLUDED.strategies,
      peer_levels = EXCLUDED.peer_levels,
      institution_count = EXCLUDED.institution_count,
      published_fee_count = EXCLUDED.published_fee_count,
      last_agent_run_id = EXCLUDED.last_agent_run_id,
      refreshed_at = EXCLUDED.refreshed_at,
      updated_at = EXCLUDED.updated_at
  `;
  return { memory, stored: true };
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** The stored memory for a state, or null when none is stored (or the table is missing). */
export async function loadStateMemory(db: SqlTag, stateCode: string): Promise<StateMemory | null> {
  const code = stateCode.trim().toUpperCase();
  if (!(await stateMemorySchemaReady(db))) return null;
  const [row] = await db<Array<Record<string, unknown>>>`
    SELECT state_code, expert_name, expert_bio, regulator, platforms, strategies, peer_levels,
           institution_count, published_fee_count, refreshed_at
      FROM state_memory
     WHERE state_code = ${code}
  `;
  if (!row) return null;
  const strategies = jsonValue<Partial<StateStrategies>>(row.strategies, {});
  const peerLevels = jsonValue<PeerLevel[]>(row.peer_levels, []);
  // An old mixed-audience baseline must never be treated as consumer evidence.
  const safePeerLevels = Array.isArray(peerLevels) && currentAudiencePeerLevels(peerLevels) ? peerLevels : [];
  return {
    stateCode: String(row.state_code),
    stateName: STATE_NAMES[String(row.state_code)] ?? null,
    expertName: String(row.expert_name),
    expertBio: String(row.expert_bio),
    regulator: jsonValue<StateRegulatorMemory>(row.regulator, {
      agency: null,
      website: null,
      creditUnionAgency: null,
      creditUnionWebsite: null,
      source: "roster",
    }),
    platforms: jsonValue<StatePlatform[]>(row.platforms, []),
    strategies: { finder: strategies.finder ?? [], reader: strategies.reader ?? [] },
    peerLevels: safePeerLevels,
    institutionCount: Number(row.institution_count ?? 0),
    publishedFeeCount: Number(row.published_fee_count ?? 0),
    refreshedAt: row.refreshed_at instanceof Date ? row.refreshed_at.toISOString() : row.refreshed_at ? String(row.refreshed_at) : null,
  };
}

/**
 * Peer levels for Darwin: the state expert's stored levels when it has any, else the
 * levels computed live from published_fee_catalog (before the first state-expert step
 * or the migration).
 */
export async function loadStatePeerLevels(db: SqlTag, stateCode: string): Promise<PeerLevel[]> {
  const stored = await loadStateMemory(db, stateCode).catch(() => null);
  if (stored && stored.peerLevels.length > 0) return stored.peerLevels;
  return computeStatePeerLevels(db, stateCode);
}

export interface StateExpertHints {
  stateCode: string;
  expertName: string | null;
  /** Magellan finder strategies, best first. Only strategies with evidence in this state. */
  finderOrder: string[];
  /** Rosetta reader strategies, best first. Only strategies with evidence in this state. */
  readerOrder: string[];
  /** Strategies tried at least AVOID_MIN_ATTEMPTS times in this state without one success. */
  avoid: string[];
  /** Most common website platforms among the state's banks. */
  platforms: string[];
  source: "memory" | "none";
}

/** Pure: hints from a memory (or none). */
export function hintsFromMemory(stateCode: string, memory: StateMemory | null): StateExpertHints {
  const code = stateCode.trim().toUpperCase();
  const expert = stateExpertFor(code);
  if (!memory) {
    return { stateCode: code, expertName: expert?.name ?? null, finderOrder: [], readerOrder: [], avoid: [], platforms: [], source: "none" };
  }
  const useful = (ranks: StrategyRank[]) => ranks.filter((rank) => rank.successes > 0).map((rank) => rank.strategy);
  const avoid = [...memory.strategies.finder, ...memory.strategies.reader]
    .filter((rank) => rank.successes === 0 && rank.attempts >= AVOID_MIN_ATTEMPTS)
    .map((rank) => rank.strategy);
  return {
    stateCode: code,
    expertName: memory.expertName,
    finderOrder: useful(memory.strategies.finder),
    readerOrder: useful(memory.strategies.reader),
    avoid,
    platforms: memory.platforms.map((entry) => entry.platform),
    source: "memory",
  };
}

/**
 * The state expert's advice for the Magellan (finder) and Rosetta (reader) teams: which
 * of their strategies have worked best in this state. Read-only and free. Callers
 * reorder their own strategy list with `orderByHints`; with no memory the hints are
 * empty and the caller keeps its default order.
 */
export async function stateExpertHints(stateCode: string, db: SqlTag = sql): Promise<StateExpertHints> {
  const memory = await loadStateMemory(db, stateCode).catch(() => null);
  return hintsFromMemory(stateCode, memory);
}

/**
 * Pure: `available` reordered so hinted strategies come first in hint order, avoided ones
 * last, and the rest keep their original order.
 */
export function orderByHints(available: readonly string[], preferred: readonly string[], avoid: readonly string[] = []): string[] {
  const rank = (strategy: string) => {
    if (avoid.includes(strategy)) return Number.MAX_SAFE_INTEGER;
    const index = preferred.indexOf(strategy);
    return index === -1 ? preferred.length : index;
  };
  return available
    .map((strategy, index) => ({ strategy, index }))
    .sort((a, b) => rank(a.strategy) - rank(b.strategy) || a.index - b.index)
    .map((entry) => entry.strategy);
}
