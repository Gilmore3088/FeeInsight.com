import { sql } from "./connection";

// The Knox decisions queue was retired (James, Oct 9). Its records stay in
// agent_messages and knox_overrides; only these counts are still read (Hamilton's
// internal research tool reports them as history).

export interface KnoxReviewCounts {
  pending: number;
  confirmed: number;
  overridden: number;
  total: number;
}


// 30-second per-instance cache; concurrent cold callers share one in-flight query.
const CACHE_TTL_MS = 30_000;
let _knoxCountsCache: { value: KnoxReviewCounts; expiresAt: number } | null = null;
let _inFlight: Promise<KnoxReviewCounts> | null = null;

export function clearKnoxReviewCountsCache(): void {
  _knoxCountsCache = null;
}

/**
 * Count Knox rejection messages grouped by human-review status.
 * - pending   : no knox_overrides row for this rejection_msg_id
 * - confirmed : knox_overrides.decision = 'confirm'
 * - overridden: knox_overrides.decision = 'override'
 *
 * Cached for 30s per instance (best-effort cross-instance invalidation).
 * Concurrent cold-cache callers share a single in-flight promise.
 */
export async function getKnoxReviewCounts(): Promise<KnoxReviewCounts> {
  const now = Date.now();
  if (_knoxCountsCache && _knoxCountsCache.expiresAt > now) {
    return _knoxCountsCache.value;
  }
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const rows = await sql<{ bucket: string; cnt: string }[]>`
        SELECT
          CASE
            WHEN ko.decision IS NULL THEN 'pending'
            WHEN ko.decision = 'confirm' THEN 'confirmed'
            WHEN ko.decision = 'override' THEN 'overridden'
            ELSE 'other'
          END AS bucket,
          COUNT(*) AS cnt
        FROM agent_messages am
        LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
        WHERE am.sender_agent = 'knox' AND am.intent = 'reject'
        GROUP BY 1
      `;
      const counts: KnoxReviewCounts = {
        pending: 0,
        confirmed: 0,
        overridden: 0,
        total: 0,
      };
      for (const r of rows) {
        const n = Number(r.cnt);
        if (r.bucket === "pending") counts.pending = n;
        else if (r.bucket === "confirmed") counts.confirmed = n;
        else if (r.bucket === "overridden") counts.overridden = n;
        counts.total += n;
      }
      _knoxCountsCache = { value: counts, expiresAt: Date.now() + CACHE_TTL_MS };
      return counts;
    } finally {
      _inFlight = null;
    }
  })();
  try {
    return await _inFlight;
  } catch (e) {
    console.error("getKnoxReviewCounts failed:", e);
    return { pending: 0, confirmed: 0, overridden: 0, total: 0 };
  }
}

// Parameterized filter fragments (MINOR-3). Returning a postgres.js tagged
// fragment instead of a raw string removes the `sql.unsafe()` footgun — a
