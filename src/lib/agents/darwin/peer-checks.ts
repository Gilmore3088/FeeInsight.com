import type { sql } from "@/lib/data-store/connection";
import {
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
 * - Second source: when another stored document for the same bank (an older copy of
 *   the schedule, or a sister document) has the same fee at the same amount, the
 *   agreement is recorded as confidence evidence on the verified row.
 */
export const DARWIN_PEER_STRATEGY = { strategy: "verify.peer_range", version: 1 } as const;
export const DARWIN_SECOND_SOURCE_STRATEGY = { strategy: "verify.second_source", version: 1 } as const;

/** Flag on a verified row whose amount another stored document confirms. */
export const SECOND_SOURCE_FLAG = "second_source_agrees";

export interface PeerCheckResult {
  outlier: boolean;
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

/** Pure: the peer check for one amount, or null when there are not enough peers. */
export function peerCheck(
  levels: readonly PeerLevel[],
  canonicalFeeKey: string,
  tier: string,
  amount: number,
): PeerCheckResult | null {
  // An explicit $0 (free) fee is a real price; Knox's zero-fee gate already covers it.
  if (!(amount > 0)) return null;
  const level = peerLevelFor(levels, canonicalFeeKey, tier);
  if (!level) return null;
  const { low, high } = peerRange(level);
  return {
    outlier: isPeerOutlier(amount, level),
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

export function peerOutlierReason(check: PeerCheckResult, amount: number): string {
  const scope = check.levelTier === "all" ? "state" : `${check.levelTier.replace(/_/g, " ")} state`;
  return `$${amount.toFixed(2)} is outside the ${scope} peer range $${check.low.toFixed(2)}-$${check.high.toFixed(2)} ` +
    `(median $${check.median.toFixed(2)}, ${check.peerCount} institutions)`;
}

/** Peer levels per state, loaded once per Darwin run. */
export class PeerLevelCache {
  private readonly levels = new Map<string, Promise<PeerLevel[]>>();

  constructor(private readonly db: SqlTag) {}

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
