import { sql } from "@/lib/data-store/connection";
import { confirmFeeChange, type RecordedChangeRow } from "@/lib/report-assemblers/monthly-pulse";

/**
 * Hamilton's fee-movement signals fire whenever a newer read of a fee carries a new
 * amount. While fees are still loading most of those are not price changes: the same
 * document read twice, a recategorized line, or a copy of another page. On prod, none of
 * the 546 movements signalled from Sep 30 to Oct 7, 2026 passed the test below.
 *
 * A movement counts as a price change only when the old and new rows trace to two
 * different documents, the new one newer, and `confirmFeeChange` (the rule Hamilton and the
 * Monthly Pulse use) bears it out: the same schedule (same page, or a newer dated edition
 * for the same audience), same fee name, the old copy states the old price, the new copy
 * states the new price and no longer the old one.
 * Alerts and the digest report only those; the rest are marked `confirmed: false`.
 */

interface MovementPair {
  previous_fee_published_id?: unknown;
  new_fee_published_id?: unknown;
  confirmed?: unknown;
}

function pairKey(previousId: unknown, newId: unknown): string | null {
  const previous = Number(previousId);
  const next = Number(newId);
  if (!Number.isInteger(previous) || !Number.isInteger(next) || previous <= 0 || next <= 0) return null;
  return `${previous}:${next}`;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function movementsOf(sourceJson: unknown): MovementPair[] {
  const json = parseJson(sourceJson);
  return (Array.isArray(json.movements) ? json.movements : []) as MovementPair[];
}

/** False for a movement the check marked as not a price change; true otherwise. */
export function isConfirmedMovement(movement: { confirmed?: unknown }): boolean {
  return movement.confirmed !== false;
}

/**
 * Pure: a copy of each row whose movement-signal JSON marks every movement
 * `confirmed: true` or `false` by the set of confirmed previous:new pairs.
 */
export function markConfirmedMovements<T extends { signal_type?: string; source_json: unknown }>(
  rows: T[],
  confirmed: Set<string>,
): T[] {
  return rows.map((row) => {
    if (row.signal_type !== undefined && row.signal_type !== "hamilton_fee_movement_detected") return row;
    const json = parseJson(row.source_json);
    if (!Array.isArray(json.movements)) return row;
    const movements = (json.movements as MovementPair[]).map((movement) => {
      const key = pairKey(movement.previous_fee_published_id, movement.new_fee_published_id);
      return { ...movement, confirmed: key !== null && confirmed.has(key) };
    });
    return { ...row, source_json: { ...json, movements } };
  });
}

interface MovementCheckRow extends RecordedChangeRow {
  previous_id: number | string;
  new_id: number | string;
}

/**
 * previous:new published-fee pairs among these movements that are price changes. The query
 * keeps pairs read from two different documents, the new one newer; the rule itself is
 * `confirmFeeChange`, the one Hamilton and the Monthly Pulse use.
 */
export async function loadConfirmedMovementPairs(
  rows: Array<{ signal_type?: string; source_json: unknown }>,
): Promise<Set<string>> {
  const previousIds: number[] = [];
  const newIds: number[] = [];
  for (const row of rows) {
    if (row.signal_type !== undefined && row.signal_type !== "hamilton_fee_movement_detected") continue;
    for (const movement of movementsOf(row.source_json)) {
      const key = pairKey(movement.previous_fee_published_id, movement.new_fee_published_id);
      if (!key) continue;
      previousIds.push(Number(movement.previous_fee_published_id));
      newIds.push(Number(movement.new_fee_published_id));
    }
  }
  if (previousIds.length === 0) return new Set();
  const candidates = await sql<MovementCheckRow[]>`
    WITH pairs AS (
      SELECT DISTINCT * FROM unnest(${previousIds}::bigint[], ${newIds}::bigint[]) AS p(previous_id, new_id)
    )
    SELECT p.previous_id, p.new_id,
           ct.institution_name, ct.state_code, ct.charter_type,
           pn.canonical_fee_key AS fee_key, pn.fee_name, po.fee_name AS old_fee_name,
           po.amount AS old_amount, pn.amount AS new_amount, dnew.crawled_at AS changed_at,
           dnew.document_url AS source_url, dold.document_url AS old_source_url,
           (SELECT t.normalized_text FROM agent_source_texts t
             WHERE t.source_document_id = dnew.id AND t.status = 'completed'
             ORDER BY t.id DESC LIMIT 1) AS new_document_text,
           (SELECT t.normalized_text FROM agent_source_texts t
             WHERE t.source_document_id = dold.id AND t.status = 'completed'
             ORDER BY t.id DESC LIMIT 1) AS old_document_text
    FROM pairs p
    JOIN published_fee_records po ON po.fee_published_id = p.previous_id
    JOIN published_fee_records pn ON pn.fee_published_id = p.new_id
    JOIN institution_sources ct ON ct.id = pn.institution_id
    JOIN verified_fee_observations vo ON vo.fee_verified_id = po.lineage_ref
    JOIN verified_fee_observations vn ON vn.fee_verified_id = pn.lineage_ref
    JOIN raw_fee_observations ro ON ro.fee_raw_id = vo.fee_raw_id
    JOIN raw_fee_observations rn ON rn.fee_raw_id = vn.fee_raw_id
    JOIN source_documents dold ON dold.id = ro.source_document_id
    JOIN source_documents dnew ON dnew.id = rn.source_document_id
    WHERE dold.id <> dnew.id
      AND dnew.crawled_at > dold.crawled_at
  `;
  return new Set(
    candidates
      .filter((row) => confirmFeeChange(row) !== null)
      .map((row) => `${Number(row.previous_id)}:${Number(row.new_id)}`),
  );
}

/** Loads the check and marks the rows. A failed check confirms nothing. */
export async function withConfirmedMovements<T extends { signal_type?: string; source_json: unknown }>(
  rows: T[],
): Promise<T[]> {
  const confirmed = await loadConfirmedMovementPairs(rows).catch((error: unknown) => {
    console.error("[fee-movement-check] failed", error instanceof Error ? error.message : String(error));
    return new Set<string>();
  });
  return markConfirmedMovements(rows, confirmed);
}
