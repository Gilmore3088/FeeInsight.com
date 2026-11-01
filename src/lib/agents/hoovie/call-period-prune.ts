import type { sql } from "@/lib/data-store/connection";
import { callItemFactsRelation } from "@/lib/data-store/call-item-storage";
import { ColdFileWriter, decodeColdFile, type ColdStore } from "./cold-files";
import { CALL_ITEM_COLUMNS } from "./storage-tiers";
import { FFIEC_FILING_METADATA_KEYS } from "@/lib/regulatory/ffiec-call-items";

/** One whole period is atomic: a partial deletion would make historical aggregates incomplete. */
export const MAX_PRUNE_ROWS = 750_000;
export const CALL_PERIOD_PRUNE_LIVE = false;
/** Proposed October 25 scope, inactive until approved. Future periods require another reviewed entry. */
export const CALL_PERIOD_PRUNE_MANIFEST = [
  { source: "ffiec", period: "2023-03-31", archiveRows: 133446, pruneRows: 125076, retainedIdentityRows: 8370 },
  { source: "ffiec", period: "2023-06-30", archiveRows: 133550, pruneRows: 125176, retainedIdentityRows: 8374 },
  { source: "ncua", period: "2023-03-31", archiveRows: 595408, pruneRows: 595408, retainedIdentityRows: 0 },
  { source: "ncua", period: "2023-06-30", archiveRows: 595816, pruneRows: 595816, retainedIdentityRows: 0 },
] as const;
/** A reviewed rollback target, never populated from a customer request. Clear after its receipt. */
export const CALL_PERIOD_RESTORE_TARGET: { source: "ffiec" | "ncua"; period: string } | null = null;
type Db = typeof sql;

export async function archiveRehearsalRecorded(db: Db, args: { source: string; period: string }): Promise<boolean> {
  const [row]=await db<{ready:boolean}[]>`
    SELECT EXISTS(SELECT 1 FROM agent_run_events e JOIN agent_run_steps s ON s.id=e.step_id
      JOIN public_data_cold_files f ON f.table_name='institution_call_report_items'
       AND f.source=${args.source} AND f.period=${args.period}
     WHERE s.step_key='atlas-storage-retention' AND e.event_type='step.finished' AND e.status='completed'
       AND e.detail->'cold_tier'->'rehearsed'->>'source'=f.source
       AND e.detail->'cold_tier'->'rehearsed'->>'period'=f.period
       AND e.detail->'cold_tier'->'rehearsed'->>'sha256'=f.sha256
       AND e.detail->'cold_tier'->'rehearsed'->>'status'='verified') AS ready
  `;
  return row?.ready===true;
}

/** Consumer acceptance must name this exact verified file before removing its hot rows. */
export async function archiveConsumerAcceptanceRecorded(db: Db, args: { source: string; period: string }): Promise<boolean> {
  const [row] = await db<{ ready: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM agent_run_events e JOIN agent_run_steps s ON s.id=e.step_id
      JOIN public_data_cold_files f ON f.table_name='institution_call_report_items'
        AND f.source=${args.source} AND f.period=${args.period}
      WHERE s.step_key='atlas-storage-retention' AND e.event_type='step.finished' AND e.status='completed'
        AND e.detail#>>'{storage_preprune_acceptance,source}'=f.source AND e.detail#>>'{storage_preprune_acceptance,period}'=f.period
        AND e.detail#>>'{storage_preprune_acceptance,sha256}'=f.sha256 AND e.detail#>>'{storage_preprune_acceptance,status}'='verified'
        AND e.detail#>>'{storage_preprune_acceptance,consumersVerified}'='true') ready
  `;
  return row?.ready === true;
}

/**
 * Caller must own a ledger transaction. No external action can invoke this without the live
 * switch. Recheck the actual current rows under a short-wait writer lock, not a stale plan count.
 */
export async function pruneCallPeriod(db: Db, store: ColdStore, args: {
  source: "ffiec" | "ncua"; period: string;
  expected?: { archiveRows: number; pruneRows: number; retainedIdentityRows: number };
  requireRehearsal?: boolean;
  requireConsumerAcceptance?: boolean;
}): Promise<{ deleted: number; status: "pruned" | "already_pruned" }> {
  if (typeof (db as unknown as { savepoint?: unknown }).savepoint !== "function") throw new Error("Pruning requires a run-ledger transaction");
  if (!store.configured) throw new Error("Archive storage is not configured");
  await db`SET LOCAL lock_timeout = '2s'`;
  await db`SET LOCAL statement_timeout = '30s'`;
  // Also excludes legacy writers, manual writers, compaction and simultaneous export/prune.
  await db`LOCK TABLE institution_call_report_items IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
  const [file] = await db<Array<{
    id: string; bucket: string; object_key: string; sha256: string; row_count: string;
    verified_at: string | null; pruned_at: string | null;
  }>>`
    SELECT id,bucket,object_key,sha256,row_count,verified_at,pruned_at
      FROM public_data_cold_files WHERE table_name='institution_call_report_items'
       AND source=${args.source} AND period=${args.period} FOR UPDATE
  `;
  if (!file || !file.verified_at || file.bucket !== store.bucket) throw new Error("A verified archive in the configured bucket is required");
  // Check after locking the index row: a concurrent export cannot swap the rehearsed SHA.
  if(args.requireRehearsal && !await archiveRehearsalRecorded(db,args))throw new Error("This exact archive has no completed restore rehearsal");
  if(args.requireConsumerAcceptance && !await archiveConsumerAcceptanceRecorded(db,args))throw new Error("This exact archive has no completed consumer acceptance");
  if (file.pruned_at) {
    const hot = await db`SELECT 1 FROM institution_call_report_items WHERE source=${args.source}
      AND report_date=${args.period}::date AND NOT (item_key=ANY(${[...FFIEC_FILING_METADATA_KEYS]}::text[])) LIMIT 1`;
    if (hot.length) throw new Error("An archived period has reappeared in Postgres; inspect the writer before pruning again");
    return { deleted: 0, status: "already_pruned" };
  }
  const rows = Number(file.row_count);
  if (args.expected && rows !== args.expected.archiveRows) throw new Error("Archive count differs from the reviewed manifest");
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_PRUNE_ROWS) throw new Error("Archive row count exceeds the atomic prune budget");
  const [coverage] = await db<{ newer: number }[]>`
    WITH RECURSIVE recent AS (
      SELECT max(report_date) AS report_date,1 AS n FROM institution_call_report_items WHERE source=${args.source}
      UNION ALL
      SELECT (SELECT max(i.report_date) FROM institution_call_report_items i
        WHERE i.source=${args.source} AND i.report_date<recent.report_date),recent.n+1
        FROM recent WHERE recent.report_date IS NOT NULL AND recent.n<12
    ) SELECT count(*)::int AS newer FROM recent WHERE report_date>${args.period}::date
  `;
  if (Number(coverage?.newer ?? 0) < 12) throw new Error("Keep at least twelve newer quarters in Postgres");
  decodeColdFile(await store.get(file.object_key), { expected: { sha256: file.sha256, rowCount: rows }, lineFilter: () => false });
  const relation = await callItemFactsRelation(db);
  const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
  const query = db<Array<Record<string, unknown>>>`
    SELECT id::text AS id,institution_id::text AS institution_id,source,report_date::text AS report_date,
           item_code,item_key,item_description,schedule,value::text AS value,unit,period_basis,
           source_url,agent_run_id::text AS agent_run_id,
           to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at
      FROM ${db.unsafe(relation)} WHERE source=${args.source} AND report_date=${args.period}::date ORDER BY id
  `;
  for await (const batch of query.cursor(5000)) writer.push(batch);
  const current = writer.finish();
  if (current.rowCount !== rows || current.sha256 !== file.sha256) throw new Error("Current period differs from the verified archive; export it again");
  const [deleted] = await db<{ n: string }[]>`
    WITH removed AS (DELETE FROM institution_call_report_items WHERE source=${args.source}
      AND report_date=${args.period}::date AND NOT (item_key=ANY(${[...FFIEC_FILING_METADATA_KEYS]}::text[]))
      RETURNING id) SELECT count(*)::text AS n FROM removed
  `;
  const [kept] = await db<{ n: string }[]>`SELECT count(*)::text AS n FROM institution_call_report_items
    WHERE source=${args.source} AND report_date=${args.period}::date`;
  const deletedCount=Number(deleted?.n);
  if (deletedCount + Number(kept?.n) !== rows) throw new Error("Prune count mismatch; roll back this transaction");
  if(args.expected && (deletedCount!==args.expected.pruneRows || Number(kept?.n)!==args.expected.retainedIdentityRows)) {
    throw new Error("Current period differs from the reviewed prune/identity counts; roll back");
  }
  await db`UPDATE public_data_cold_files SET pruned_at=now() WHERE id=${file.id}`;
  // The caller's step.finished event and this index change commit with the deletion.
  return { deleted: deletedCount, status: "pruned" };
}

/** Rollback rehearsal/approved ledger task: restore a complete period, keeping newer POR witnesses. */
async function insertArchiveRows(db: Db, rows: Record<string, unknown>[], rehearsal: boolean): Promise<number> {
  let inserted=0;
  const destination=rehearsal ? "call_report_archive_restore_checks" : "institution_call_report_items";
  for(let at=0;at<rows.length;at+=5000){
    const result=await db`
      INSERT INTO ${db.unsafe(destination)}
        (id,institution_id,source,report_date,item_code,item_key,item_description,schedule,value,unit,period_basis,source_url,agent_run_id,fetched_at)
      SELECT id,institution_id,source,report_date,item_code,item_key,item_description,schedule,value,unit,period_basis,source_url,agent_run_id,fetched_at
        FROM jsonb_to_recordset(${JSON.stringify(rows.slice(at,at+5000))}::text::jsonb) AS r(
          id bigint,institution_id bigint,source text,report_date date,item_code text,item_key text,item_description text,
          schedule text,value numeric,unit text,period_basis text,source_url text,agent_run_id bigint,fetched_at timestamptz)
      RETURNING id
    `;
    inserted+=result.length;
  }
  return inserted;
}

/** Restore a real verified file into a disposable unlogged table, compare every field, then empty it. */
export async function rehearseCallPeriod(db: Db, store: ColdStore, args: { source: "ffiec" | "ncua"; period: string }) {
  if (typeof (db as unknown as { savepoint?: unknown }).savepoint !== "function") throw new Error("Rehearsal requires a run-ledger transaction");
  const manifest=CALL_PERIOD_PRUNE_MANIFEST.find((m)=>m.source===args.source&&m.period===args.period);
  if(!manifest)throw new Error("Rehearsal period is outside the reviewed manifest");
  await db`SET LOCAL lock_timeout='2s'`;
  await db`SET LOCAL statement_timeout='30s'`;
  await db`LOCK TABLE call_report_archive_restore_checks IN ACCESS EXCLUSIVE MODE NOWAIT`;
  const [file]=await db<Array<{bucket:string;object_key:string;sha256:string;row_count:string;verified_at:string|null}>>`
    SELECT bucket,object_key,sha256,row_count,verified_at FROM public_data_cold_files
     WHERE table_name='institution_call_report_items' AND source=${args.source} AND period=${args.period}
  `;
  if(!file?.verified_at||file.bucket!==store.bucket||Number(file.row_count)!==manifest.archiveRows)throw new Error("Verified reviewed archive required");
  const decoded=decodeColdFile(await store.get(file.object_key),{expected:{sha256:file.sha256,rowCount:Number(file.row_count)}});
  if(JSON.stringify(decoded.columns)!==JSON.stringify(CALL_ITEM_COLUMNS)||decoded.rows.some((r)=>r.source!==args.source||r.report_date!==args.period))throw new Error("Archive shape or source/period mismatch");
  await db`TRUNCATE call_report_archive_restore_checks`;
  const inserted=await insertArchiveRows(db,decoded.rows,true);
  const writer=new ColdFileWriter(CALL_ITEM_COLUMNS);
  const query=db<Array<Record<string,unknown>>>`
    SELECT id::text AS id,institution_id::text AS institution_id,source,report_date::text AS report_date,
      item_code,item_key,item_description,schedule,value::text AS value,unit,period_basis,source_url,
      agent_run_id::text AS agent_run_id,to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at
      FROM call_report_archive_restore_checks ORDER BY id
  `;
  for await(const batch of query.cursor(5000))writer.push(batch);
  const restored=writer.finish();
  if(inserted!==manifest.archiveRows||restored.sha256!==file.sha256||restored.rowCount!==inserted)throw new Error("Restored archive differs from its original file");
  await db`TRUNCATE call_report_archive_restore_checks`;
  return {...args,sha256:file.sha256,rowCount:inserted,status:"verified" as const};
}

export async function restoreCallPeriod(db: Db, store: ColdStore, args: {
  source: "ffiec" | "ncua"; period: string;
}): Promise<number> {
  if (typeof (db as unknown as { savepoint?: unknown }).savepoint !== "function") throw new Error("Restore requires a run-ledger transaction");
  await db`SET LOCAL lock_timeout='2s'`;
  await db`SET LOCAL statement_timeout='30s'`;
  await db`LOCK TABLE institution_call_report_items IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
  const [file]=await db<Array<{id:string;bucket:string;object_key:string;sha256:string;row_count:string;pruned_at:string|null;verified_at:string|null}>>`
    SELECT id,bucket,object_key,sha256,row_count,pruned_at,verified_at FROM public_data_cold_files
     WHERE table_name='institution_call_report_items' AND source=${args.source} AND period=${args.period} FOR UPDATE
  `;
  if(!file?.verified_at||file.bucket!==store.bucket)throw new Error("Verified archive required for restore");
  if(!file.pruned_at)return 0;
  if(Number(file.row_count)>MAX_PRUNE_ROWS)throw new Error("Restore exceeds row budget");
  const decoded=decodeColdFile(await store.get(file.object_key),{expected:{sha256:file.sha256,rowCount:Number(file.row_count)}});
  if(JSON.stringify(decoded.columns)!==JSON.stringify(CALL_ITEM_COLUMNS))throw new Error("Unsupported archive columns");
  if(decoded.rows.some((row)=>row.source!==args.source||row.report_date!==args.period))throw new Error("Archive source/period mismatch");
  const rows=decoded.rows.filter((row)=>!FFIEC_FILING_METADATA_KEYS.has(String(row.item_key)));
  const inserted=await insertArchiveRows(db,rows,false);
  if(inserted!==rows.length)throw new Error("Restore count mismatch; roll back this transaction");
  await db`UPDATE public_data_cold_files SET pruned_at=NULL WHERE id=${file.id}`;
  return inserted;
}
