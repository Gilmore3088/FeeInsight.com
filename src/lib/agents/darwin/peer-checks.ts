import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import {
  ALL_TIERS,
  assetTierSql,
  isPeerOutlier,
  loadStatePeerLevels,
  peerLevelFor,
  peerRange,
  type PeerLevel,
} from "@/lib/agents/state-expert/memory";

type SqlTag = typeof sql;

/**
 * Darwin pass 2: free checks that use evidence beyond the row itself. Each is its own
 * strategy in the attempt log, separate from `verify.rules`.
 *
 * - Peer check: a fee far outside its state's peer range for that fee and asset-size
 *   tier (below p25 / 3 or above p75 * 3, with at least 8 peer institutions) goes to
 *   human review instead of being verified. It is a flag, not a rejection: the row
 *   stays in the review path with the peer range as the reason.
 *   When the state has too few peers for the fee, the check falls back to the bank's
 *   Federal Reserve district, then to the nation, so every fee gets a comparison (the
 *   2026-10-06 audit found the state-only check ran on 45% of approvals). A fallback
 *   comparison is evidence, not a hold: the audit found half of the state-level holds
 *   were real prices, every fee reaching this check is already stated in the bank's own
 *   schedule, and held fees have no way out yet. It is recorded on the attempt for the
 *   Claude review and for measuring whether it should hold.
 * - Second source: when another stored document for the same bank (an older copy of
 *   the schedule, or a sister document) has the same fee at the same amount, the
 *   agreement is recorded as confidence evidence on the verified row.
 */
// v2: district and national fallback, with the scope recorded.
export const DARWIN_PEER_STRATEGY = { strategy: "verify.peer_range", version: 2 } as const;
export const DARWIN_SECOND_SOURCE_STRATEGY = { strategy: "verify.second_source", version: 1 } as const;

/** Flag on a verified row whose amount another stored document confirms. */
export const SECOND_SOURCE_FLAG = "second_source_agrees";

/** Where the peer level came from: the bank's state, its Fed district, or the nation. */
export type PeerScope = "state" | "district" | "national";

export interface PeerCheckResult {
  outlier: boolean;
  scope: PeerScope;
  tier: string;
  /** The tier the level came from: the row's own tier or `all` (state-wide). */
  levelTier: string;
  low: number;
  high: number;
  p25: number;
  median: number;
  p75: number;
  peerCount: number;
}

/** Peer levels beyond one state: per Fed district and national. */
export interface WiderPeerLevels {
  district: ReadonlyMap<number, readonly PeerLevel[]>;
  national: readonly PeerLevel[];
}

export const NO_WIDER_PEER_LEVELS: WiderPeerLevels = { district: new Map(), national: [] };

/** The Fed district of a state, or null for a state code outside the map. */
export function districtOfState(stateCode: string | null | undefined): number | null {
  const code = stateCode?.trim().toUpperCase();
  return code ? STATE_TO_DISTRICT[code] ?? null : null;
}

/** Pure: the peer check for one amount, or null when there are not enough peers anywhere. */
export function peerCheck(
  levels: readonly PeerLevel[],
  canonicalFeeKey: string,
  tier: string,
  amount: number,
  wider: WiderPeerLevels = NO_WIDER_PEER_LEVELS,
  district: number | null = null,
): PeerCheckResult | null {
  // An explicit $0 (free) fee is a real price; Knox's zero-fee gate already covers it.
  if (!(amount > 0)) return null;
  let scope: PeerScope = "state";
  let level = peerLevelFor(levels, canonicalFeeKey, tier);
  if (!level && district != null) {
    level = peerLevelFor(wider.district.get(district) ?? [], canonicalFeeKey, tier);
    scope = "district";
  }
  if (!level) {
    level = peerLevelFor(wider.national, canonicalFeeKey, tier);
    scope = "national";
  }
  if (!level) return null;
  const { low, high } = peerRange(level);
  return {
    outlier: isPeerOutlier(amount, level),
    scope,
    tier,
    levelTier: level.tier,
    low,
    high,
    p25: level.p25,
    median: level.median,
    p75: level.p75,
    peerCount: level.count,
  };
}

/** Only a state-level outlier is held; a district or national one is recorded evidence. */
export function holdsForPeerReview(check: PeerCheckResult | null): boolean {
  return Boolean(check?.outlier && check.scope === "state");
}

export function peerOutlierReason(check: PeerCheckResult, amount: number): string {
  const area = check.scope === "national" ? "national" : check.scope;
  const scope = check.levelTier === "all" ? area : `${check.levelTier.replace(/_/g, " ")} ${area}`;
  return `$${amount.toFixed(2)} is outside the ${scope} peer range $${check.low.toFixed(2)}-$${check.high.toFixed(2)} ` +
    `(median $${check.median.toFixed(2)}, ${check.peerCount} institutions)`;
}

/**
 * p25/median/p75 per fee for each Fed district and for the nation, by asset-size tier and
 * across tiers, from the live catalog. One vote per bank, as in the state levels.
 */
export async function computeWiderPeerLevels(db: SqlTag): Promise<WiderPeerLevels> {
  const districtValues = Object.entries(STATE_TO_DISTRICT)
    .map(([state, district]) => `('${state.replace(/[^A-Z]/g, "")}', ${Number(district)})`)
    .join(", ");
  const rows = await db.unsafe<Array<{
    district: number | string | null;
    canonical_fee_key: string;
    tier: string;
    p25: string | number;
    median: string | number;
    p75: string | number;
    institutions: string | number;
  }>>(
    `
      WITH districts(state_code, district) AS (VALUES ${districtValues}),
      per_institution AS (
        SELECT c.institution_id,
               c.canonical_fee_key,
               d.district,
               ${assetTierSql("inst")} AS tier,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY c.amount) AS amount
          FROM published_fee_catalog c
          JOIN institution_sources inst ON inst.id = c.institution_id
          LEFT JOIN districts d ON d.state_code = upper(btrim(inst.state_code))
         WHERE COALESCE(inst.status, 'active') = 'active'
           AND c.amount IS NOT NULL
           AND c.amount >= 0
         GROUP BY 1, 2, 3, 4
      )
      SELECT CASE WHEN GROUPING(district) = 1 THEN NULL ELSE district END AS district,
             canonical_fee_key,
             CASE WHEN GROUPING(tier) = 1 THEN '${ALL_TIERS}' ELSE tier END AS tier,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) AS p75,
             COUNT(*) AS institutions
        FROM per_institution
       WHERE district IS NOT NULL
       GROUP BY GROUPING SETS ((district, canonical_fee_key, tier), (district, canonical_fee_key),
                               (canonical_fee_key, tier), (canonical_fee_key))
    `,
  );
  const district = new Map<number, PeerLevel[]>();
  const national: PeerLevel[] = [];
  const round2 = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
  for (const row of rows ?? []) {
    const level: PeerLevel = {
      canonicalFeeKey: String(row.canonical_fee_key),
      tier: String(row.tier),
      p25: round2(row.p25),
      median: round2(row.median),
      p75: round2(row.p75),
      count: Number(row.institutions ?? 0),
    };
    if (row.district == null) {
      national.push(level);
    } else {
      const key = Number(row.district);
      const list = district.get(key) ?? [];
      list.push(level);
      district.set(key, list);
    }
  }
  return { district, national };
}

/** District and national levels are recomputed at most this often per server instance. */
const WIDER_PEER_LEVELS_TTL_MS = 60 * 60 * 1000;
let widerCache: { at: number; levels: WiderPeerLevels } | null = null;

/** Test hook: forget the cached district and national levels. */
export function resetWiderPeerLevelCache(): void {
  widerCache = null;
}

/**
 * District and national levels, cached for an hour. A failed read returns the last good
 * levels, or none (the check then runs where the state has peers, as before).
 */
export async function loadWiderPeerLevels(db: SqlTag, now = Date.now()): Promise<WiderPeerLevels> {
  if (widerCache && now - widerCache.at < WIDER_PEER_LEVELS_TTL_MS) return widerCache.levels;
  try {
    const levels = await inSavepoint(db, (scope) => computeWiderPeerLevels(scope));
    widerCache = { at: now, levels };
    return levels;
  } catch (error) {
    console.error("loadWiderPeerLevels failed:", error instanceof Error ? error.message : error);
    return widerCache?.levels ?? NO_WIDER_PEER_LEVELS;
  }
}

/** Peer levels per state, loaded once per Darwin run, plus district and national levels. */
export class PeerLevelCache {
  private readonly levels = new Map<string, Promise<PeerLevel[]>>();
  private wider: Promise<WiderPeerLevels> | null = null;

  constructor(private readonly db: SqlTag) {}

  widerLevels(): Promise<WiderPeerLevels> {
    if (!this.wider) this.wider = loadWiderPeerLevels(this.db);
    return this.wider;
  }

  forState(stateCode: string | null | undefined): Promise<PeerLevel[]> {
    const code = stateCode?.trim().toUpperCase();
    if (!code) return Promise.resolve([]);
    let pending = this.levels.get(code);
    if (!pending) {
      pending = loadStatePeerLevels(this.db, code).then((levels) => (Array.isArray(levels) ? levels : []));
      this.levels.set(code, pending);
    }
    return pending;
  }
}

export interface SourceCopy {
  feeRawId: number;
  institutionId: number;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  amount: number;
}

export interface SecondSourceResult {
  verdict: "agrees" | "disagrees";
  /** Other documents with the same amount. */
  agreeingDocumentIds: number[];
  /** Other documents with a different amount, and the amounts they show. */
  disagreeing: Array<{ sourceDocumentId: number; amount: number }>;
}

/**
 * Pure: compare a row with the same fee in the bank's other stored documents. Null when
 * no other document has this fee (nothing to compare).
 */
export function secondSourceCheck(
  row: { feeRawId: number; institutionId: number; sourceDocumentId: number | null; canonicalFeeKey: string; amount: number },
  copies: readonly SourceCopy[],
): SecondSourceResult | null {
  if (row.sourceDocumentId == null) return null;
  const others = copies.filter((copy) =>
    copy.institutionId === row.institutionId &&
    copy.canonicalFeeKey === row.canonicalFeeKey &&
    copy.sourceDocumentId !== row.sourceDocumentId &&
    copy.feeRawId !== row.feeRawId,
  );
  if (others.length === 0) return null;
  const agreeing = new Set<number>();
  const disagreeing = new Map<number, number>();
  for (const copy of others) {
    if (Math.round(copy.amount * 100) === Math.round(row.amount * 100)) agreeing.add(copy.sourceDocumentId);
    else if (!disagreeing.has(copy.sourceDocumentId)) disagreeing.set(copy.sourceDocumentId, copy.amount);
  }
  for (const documentId of agreeing) disagreeing.delete(documentId);
  return {
    verdict: agreeing.size > 0 ? "agrees" : "disagrees",
    agreeingDocumentIds: Array.from(agreeing).sort((a, b) => a - b),
    disagreeing: Array.from(disagreeing, ([sourceDocumentId, amount]) => ({ sourceDocumentId, amount })),
  };
}

/**
 * Every Knox row in another stored document for the batch's institutions and fee
 * categories, in one query. `hintOf` reads a row's canonical hint the way Darwin does.
 */
export async function loadSourceCopies(
  db: SqlTag,
  institutionIds: number[],
  canonicalFeeKeys: string[],
  hintOf: (row: { outlier_flags: unknown; conditions: string | null }) => string | null,
): Promise<SourceCopy[]> {
  if (institutionIds.length === 0 || canonicalFeeKeys.length === 0) return [];
  const hintFlags = canonicalFeeKeys.map((key) => `canonical_hint:${key}`);
  const rows = await db<Array<{
    fee_raw_id: number | string;
    institution_id: number | string;
    source_document_id: number | string;
    amount: number | string;
    outlier_flags: unknown;
    conditions: string | null;
  }>>`
    SELECT fr.fee_raw_id, fr.institution_id, fr.source_document_id, fr.amount, fr.outlier_flags, fr.conditions
      FROM raw_fee_observations fr
     WHERE fr.source = 'knox'
       AND fr.institution_id = ANY(${institutionIds}::int[])
       AND fr.source_document_id IS NOT NULL
       AND fr.amount IS NOT NULL
       AND fr.outlier_flags ?| ${hintFlags}::text[]
  `;
  const copies: SourceCopy[] = [];
  for (const row of rows ?? []) {
    const canonicalFeeKey = hintOf(row);
    if (!canonicalFeeKey) continue;
    copies.push({
      feeRawId: Number(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      canonicalFeeKey,
      amount: Number(row.amount),
    });
  }
  return copies;
}
