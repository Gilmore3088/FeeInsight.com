import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { productKeySql } from "@/lib/fee-product";
type SqlTag = typeof sql;

/** A selected published state plus the product owned by its selected raw lineage. */
export interface PublishedIdentity {
  fee_published_id: number | string;
  published_state: string;
  identity_raw_id: number | string | null;
  identity_product: string;
}
/** Callers use fp/fv/fr aliases. Keep the snapshot in PostgreSQL to preserve timestamp precision. */
export const PUBLISHED_IDENTITY_COLUMNS = `to_jsonb(fp)::text AS published_state,
  fr.fee_raw_id AS identity_raw_id, ${productKeySql("fr.product_name")} AS identity_product`;

/**
 * Called inside the caller's transaction/savepoint. Lock published rows first, then verified
 * lineage, then raw rows, each in stable ID order. Read the current snapshot AFTER waits finish;
 * a product correction in raw data must not authorize an old planned collapse or refresh.
 * This protects the selected rows; it does not claim serializable phantom-insertion isolation.
 */
export async function unchangedPublishedIdentities(db: SqlTag, selected: readonly PublishedIdentity[], additionalVerifiedIds: readonly number[] = [], allowClosed = false): Promise<Set<number>> {
  if (selected.length === 0 && additionalVerifiedIds.length === 0) return new Set();
  const ids = [...new Set(selected.map((r) => Number(r.fee_published_id)))].sort((a, b) => a - b);
  const published = await db<{ lineage_ref: number | string | null }[]>`
    SELECT fp.lineage_ref FROM published_fee_records fp WHERE fp.fee_published_id = ANY(${ids}::bigint[])
    ORDER BY fp.fee_published_id FOR UPDATE OF fp`;
  const verifiedIds = [...new Set([...published.map((r) => r.lineage_ref).filter((id) => id != null).map(Number), ...additionalVerifiedIds])].sort((a, b) => a - b);
  const verified = verifiedIds.length === 0 ? [] : await db<{ fee_raw_id: number | string | null }[]>`
    SELECT fv.fee_raw_id FROM verified_fee_observations fv WHERE fv.fee_verified_id = ANY(${verifiedIds}::bigint[])
    ORDER BY fv.fee_verified_id FOR UPDATE OF fv`;
  const rawIds = [...new Set(verified.map((r) => r.fee_raw_id).filter((id) => id != null).map(Number))].sort((a, b) => a - b);
  if (rawIds.length) await db`SELECT fr.fee_raw_id FROM raw_fee_observations fr WHERE fr.fee_raw_id = ANY(${rawIds}::bigint[])
    ORDER BY fr.fee_raw_id FOR UPDATE OF fr`;
  const current = await db.unsafe<PublishedIdentity[]>(`SELECT fp.fee_published_id, ${PUBLISHED_IDENTITY_COLUMNS}
    FROM published_fee_records fp
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    WHERE fp.fee_published_id = ANY($1::bigint[]) AND ${allowClosed ? "TRUE" : "fp.rolled_back_at IS NULL"} AND fp.quarantined_at IS NULL`, [ids]);
  const before = new Map(selected.map((r) => [Number(r.fee_published_id), r]));
  return new Set(current.filter((r) => {
    const old = before.get(Number(r.fee_published_id));
    return old != null && old.published_state === r.published_state
      && String(old.identity_raw_id ?? "") === String(r.identity_raw_id ?? "") && old.identity_product === r.identity_product;
  }).map((r) => Number(r.fee_published_id)));
}

/** These multi-statement lock guards require a transaction even for a direct SQL caller. */
export async function withPublishedIdentityWrite<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  if (typeof (db as unknown as { savepoint?: unknown }).savepoint === "function") return inSavepoint(db, work);
  const begin = (db as unknown as { begin?: (work: (scope: SqlTag) => Promise<T>) => Promise<T> }).begin;
  return typeof begin === "function" ? begin.call(db, work) : work(db);
}

/** A changed selection is a visible guard skip, never a reported mutation. */
export async function recordIdentitySkips(db: SqlTag, runId: number, check: string, count: number): Promise<void> {
  if (!count) return;
  await inSavepoint(db, (scope) => scope`
    INSERT INTO agent_run_events (agent_run_id,event_type,status,message,detail)
    VALUES (${runId},'hamilton.selected_identity_changed','completed',
      ${`Skipped ${count} planned ${check} pair(s) because selected identity or state changed`},
      ${JSON.stringify({check,skipped:count,changed:0})}::jsonb)`);
}
