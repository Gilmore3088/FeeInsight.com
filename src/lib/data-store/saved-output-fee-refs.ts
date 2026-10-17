/**
 * The published fee rows each saved Hamilton output used (H03-T09, #978), in
 * `hamilton_saved_output_fee_refs` (migration 20270110000054). Written once when an output is
 * saved (and again only when a repeat of the same request replaces that row's answer within
 * the duplicate window); never written for an older output, which keeps the institution match.
 *
 * Recording is best effort: a missing table or a failed write is logged and the save itself
 * still succeeds, since an output with no record falls back to the institution match.
 */

import type { sql as Sql } from "./connection";
import { MAX_SAVED_FEE_REFS, type SavedFeeRef } from "@/lib/saved-output-corrections";

type SqlTag = typeof Sql;
export type SavedOutputKind = "analysis" | "report" | "briefing";

const READY_RECHECK_MS = 60_000;
let readyAt: number | null = null;
let readyCheckedAt = 0;

/** True once the migration has added the table. Cached once true; rechecked each minute until then. */
export async function feeRefsReady(db: SqlTag): Promise<boolean> {
  if (readyAt != null) return true;
  if (readyCheckedAt > 0 && Date.now() - readyCheckedAt < READY_RECHECK_MS) return false;
  readyCheckedAt = Date.now();
  const [row] = await db<{ ready: boolean }[]>`
    SELECT to_regclass('public.hamilton_saved_output_fee_refs') IS NOT NULL AS ready
  `;
  if (row?.ready === true) readyAt = Date.now();
  return row?.ready === true;
}

/** Test hook: forget the cached readiness. */
export function resetFeeRefsReadyCache(): void {
  readyAt = null;
  readyCheckedAt = 0;
}

/**
 * Records the fee rows a saved output used. Does nothing (false) when there are none, so the
 * output keeps the institution match rather than claiming it used no fees.
 */
export async function recordSavedOutputFeeRefs(
  db: SqlTag,
  kind: SavedOutputKind,
  outputId: string | null | undefined,
  refs: SavedFeeRef[],
): Promise<boolean> {
  if (!outputId || refs.length === 0) return false;
  const kept = refs.slice(0, MAX_SAVED_FEE_REFS);
  const ids = kept.map((ref) => ref.feePublishedId);
  const sources = kept
    .filter((ref) => ref.sourceDocumentId != null)
    .map((ref) => ({ fee: ref.feePublishedId, doc: ref.sourceDocumentId, hash: ref.sourceContentHash, inst: ref.institutionId }));
  try {
    if (!(await feeRefsReady(db))) return false;
    await db`
      INSERT INTO hamilton_saved_output_fee_refs (output_kind, output_id, fee_published_ids, source_versions)
      VALUES (${kind}, ${outputId}, ${ids}::bigint[], ${JSON.stringify(sources)}::jsonb)
      ON CONFLICT (output_kind, output_id) DO UPDATE
        SET fee_published_ids = EXCLUDED.fee_published_ids,
            source_versions = EXCLUDED.source_versions,
            recorded_at = NOW()
    `;
    return true;
  } catch (error) {
    console.error("[saved-output-fee-refs] the fee rows a saved output used could not be recorded", { kind, outputId, error });
    return false;
  }
}

/** The fee rows a saved output recorded, or null when it recorded none (or the table is absent). */
export async function readSavedOutputFeeRefs(db: SqlTag, kind: SavedOutputKind, outputId: string): Promise<SavedFeeRef[] | null> {
  try {
    if (!(await feeRefsReady(db))) return null;
    const [row] = await db<{ fee_published_ids: (number | string)[]; source_versions: unknown }[]>`
      SELECT fee_published_ids, source_versions FROM hamilton_saved_output_fee_refs
       WHERE output_kind = ${kind} AND output_id = ${outputId}
    `;
    if (!row) return null;
    const raw = typeof row.source_versions === "string" ? JSON.parse(row.source_versions) : row.source_versions;
    const byFee = new Map<number, { doc?: unknown; hash?: unknown; inst?: unknown }>();
    if (Array.isArray(raw)) for (const v of raw) if (v && typeof v === "object") byFee.set(Number((v as { fee: unknown }).fee), v);
    return row.fee_published_ids.map((value) => {
      const id = Number(value);
      const source = byFee.get(id);
      return {
        feePublishedId: id,
        institutionId: source?.inst == null ? null : Number(source.inst),
        sourceDocumentId: source?.doc == null ? null : Number(source.doc),
        sourceContentHash: typeof source?.hash === "string" ? source.hash : null,
      };
    });
  } catch (error) {
    console.error("[saved-output-fee-refs] a saved output's fee rows could not be read", { kind, outputId, error });
    return null;
  }
}
