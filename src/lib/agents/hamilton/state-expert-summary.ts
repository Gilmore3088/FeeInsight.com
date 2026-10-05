import { sql } from "@/lib/data-store/connection";
import {
  ALL_TIERS,
  buildStateMemory,
  loadStateMemory,
  PEER_MIN_INSTITUTIONS,
  type PeerLevel,
} from "@/lib/agents/state-expert/memory";
import { DARWIN_PEER_STRATEGY } from "@/lib/agents/darwin/peer-checks";

type SqlTag = typeof sql;

/** How far back Darwin's peer flags count as a state's notable outliers. */
export const STATE_OUTLIER_LOOKBACK_DAYS = 90;
export const STATE_SUMMARY_OUTLIER_LIMIT = 10;

export interface StateExpertOutlier {
  institutionId: number;
  institutionName: string | null;
  canonicalFeeKey: string;
  amount: number;
  peerLow: number;
  peerHigh: number;
  peerMedian: number;
  peerCount: number;
  flaggedAt: string | null;
}

export interface StateExpertSummary {
  stateCode: string;
  stateName: string | null;
  expertName: string;
  expertBio: string;
  regulator: string | null;
  institutionCount: number;
  publishedFeeCount: number;
  /** State-wide levels with enough peers, most-covered categories first. */
  peerLevels: PeerLevel[];
  /** Fees Darwin held for review as far outside their state peers. */
  notableOutliers: StateExpertOutlier[];
  refreshedAt: string | null;
  /** "memory" when read from state_memory; "live" when built from current data. */
  source: "memory" | "live";
}

/**
 * Hamilton report hook: the state expert's summary for a state, for the report engine.
 * Free (Postgres reads only). Null for codes outside the 55 lanes.
 */
export async function stateExpertSummary(stateCode: string, db: SqlTag = sql): Promise<StateExpertSummary | null> {
  const code = stateCode.trim().toUpperCase();
  const stored = await loadStateMemory(db, code).catch(() => null);
  const memory = stored ?? (await buildStateMemory(db, code));
  if (!memory) return null;

  const outlierRows = await db<Array<Record<string, unknown>>>`
    SELECT DISTINCT ON (pa.institution_id, pa.detail->>'canonical_fee_key')
           pa.institution_id,
           inst.institution_name,
           pa.detail->>'canonical_fee_key' AS canonical_fee_key,
           (pa.detail->>'amount')::numeric AS amount,
           (pa.detail->>'peer_low')::numeric AS peer_low,
           (pa.detail->>'peer_high')::numeric AS peer_high,
           (pa.detail->>'peer_median')::numeric AS peer_median,
           (pa.detail->>'peer_count')::int AS peer_count,
           pa.created_at
      FROM pipeline_attempts pa
      JOIN institution_sources inst ON inst.id = pa.institution_id
     WHERE pa.stage = 'verify'
       AND pa.strategy = ${DARWIN_PEER_STRATEGY.strategy}
       AND pa.outcome = 'evidence_mismatch'
       AND upper(btrim(inst.state_code)) = ${code}
       AND pa.created_at > NOW() - ${STATE_OUTLIER_LOOKBACK_DAYS} * INTERVAL '1 day'
     ORDER BY pa.institution_id, pa.detail->>'canonical_fee_key', pa.created_at DESC
  `.catch(() => [] as Array<Record<string, unknown>>);

  const notableOutliers = outlierRows
    .map((row) => ({
      institutionId: Number(row.institution_id),
      institutionName: row.institution_name == null ? null : String(row.institution_name),
      canonicalFeeKey: String(row.canonical_fee_key),
      amount: Number(row.amount),
      peerLow: Number(row.peer_low),
      peerHigh: Number(row.peer_high),
      peerMedian: Number(row.peer_median),
      peerCount: Number(row.peer_count),
      flaggedAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ? String(row.created_at) : null,
    }))
    // Furthest from the peer median first.
    .sort((a, b) => distance(b) - distance(a))
    .slice(0, STATE_SUMMARY_OUTLIER_LIMIT);

  return {
    stateCode: memory.stateCode,
    stateName: memory.stateName,
    expertName: memory.expertName,
    expertBio: memory.expertBio,
    regulator: memory.regulator.agency,
    institutionCount: memory.institutionCount,
    publishedFeeCount: memory.publishedFeeCount,
    peerLevels: memory.peerLevels
      .filter((level) => level.tier === ALL_TIERS && level.count >= PEER_MIN_INSTITUTIONS)
      .sort((a, b) => b.count - a.count || a.canonicalFeeKey.localeCompare(b.canonicalFeeKey)),
    notableOutliers,
    refreshedAt: memory.refreshedAt,
    source: stored ? "memory" : "live",
  };
}

function distance(outlier: StateExpertOutlier): number {
  if (!(outlier.peerMedian > 0)) return 0;
  return Math.abs(Math.log(Math.max(outlier.amount, 0.01) / outlier.peerMedian));
}
