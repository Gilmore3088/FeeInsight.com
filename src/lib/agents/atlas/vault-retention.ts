import type { S3Client } from "@aws-sdk/client-s3";
import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { deleteVaultObject, isVaultKey } from "@/lib/agents/document-vault";

type SqlTag = typeof sql;

/**
 * Atlas's document vault watch and retention (#1041).
 *
 * Why: on Oct 12, 2026 the R2 vault (`document-vault.ts`) held 16,760 files and 3.2 GB, 2.7 GB
 * of it added in the previous 7 days, and nothing was ever deleted. Cost is cents a month (R2's
 * first 10 GB are free), so this is hygiene, not an emergency.
 *
 * Runs inside Atlas's daily storage step (`atlas-storage-retention`), after the database watch,
 * on the step's own transaction. Two parts:
 *
 * 1. Size and growth (read-only, always on). The vault is content-addressed, so one object is one
 *    distinct `source_documents.document_r2_key`; its size is the `byte_size` recorded when it was
 *    stored. Every run records the object count and size, the HTML/PDF/other split, and what was
 *    first stored in the last 7 days. A size above `VAULT_ALERT_MB` or a week's growth above
 *    `VAULT_WEEKLY_GROWTH_ALERT_MB` becomes a warning in the step result, which the morning brief
 *    emails (`daily-brief.ts`). These are measured from the database, not by listing the bucket;
 *    objects stored with no recorded size are counted and named.
 *
 * 2. Retention for rejected documents (off). A vault object is eligible when every
 *    `source_documents` row holding it (by key or by content hash) was rejected by Rosetta as not a
 *    fee schedule (`agent_source_texts.status = 'wrong_document'`, on the row or the row it
 *    duplicates) more than `VAULT_REJECTED_DAYS` days ago, has no other text, extracted no fees,
 *    was not fetched or re-checked in that window, and the object is not fee lineage: no row in any
 *    `FEE_LINEAGE_REFS` table (the raw, verified and published fee tiers, corrections, archives,
 *    snapshots, eval cases, feedback, pipeline attempts, witnesses, profile pointers, answer-key
 *    documents) and no live-fee audit capture or answer-key eligibility check points at the
 *    document or its key. Every run counts the eligible objects and their bytes.
 *    Deleting bytes is a production-data change: it runs only while `VAULT_RETENTION_LIVE` is true,
 *    which a PR sets after James's yes, at most `VAULT_DELETE_BATCH` objects a run. Each object's
 *    `document_r2_key` is re-checked and cleared on its rows in a committed transaction before the
 *    object is deleted (`retireVaultObject`), so nothing points at a missing file; the row, its
 *    hash and its text stay.
 *
 * Out of scope (#1041's third idea): storing cleaned text and a hash instead of large raw HTML.
 */

/** Turns on by PR, only after James's yes. While false, nothing is deleted from R2 or the database. */
export const VAULT_RETENTION_LIVE = false;

/** A rejected document's bytes are kept at least this long after it was last fetched and judged. */
export const VAULT_REJECTED_DAYS = 30;
/** Most objects one run deletes while retention is on. */
export const VAULT_DELETE_BATCH = 500;
/**
 * Warn above this many MB stored. The default is R2's free 10 GB; James sets the real threshold
 * by PR (#1041).
 */
export const VAULT_ALERT_MB = 10_240;
/** Warn when more than this many MB were first stored in the last `VAULT_GROWTH_DAYS` days. */
export const VAULT_WEEKLY_GROWTH_ALERT_MB = 5_120;
export const VAULT_GROWTH_DAYS = 7;
export const VAULT_STATEMENT_TIMEOUT = "15s";

/** `source_documents.document_r2_key` values that are vault keys (`isVaultKey`). */
const VAULT_KEY_PATTERN = "^[0-9a-f]{2}/[0-9a-f]{64}$";

export interface LineageRef {
  table: string;
  column: string;
  /**
   * `document`: the column holds a `source_documents.id`; `key`: it holds a vault key; `hash`: it
   * holds a sha256 of the bytes, whose vault key is `documentKey(hash)`; `url`: it holds a document
   * URL that, with the same table's `institution_id`, names that bank's `source_documents` rows.
   */
  holds: "document" | "key" | "hash" | "url";
  /** A required reference that is missing stops the retention count: it fails closed. */
  required?: boolean;
}

/**
 * Every place a fee, past or present, or its evidence points at a stored document. An object any
 * of these reaches is never eligible. Optional tables absent from a database are skipped; a
 * missing fee tier stops the count instead. Hand-confirmed answer-key documents are kept too, by
 * their bytes and by bank and URL: accuracy is scored against them (`answer-key.ts`).
 */
export const FEE_LINEAGE_REFS: readonly LineageRef[] = [
  { table: "raw_fee_observations", column: "source_document_id", holds: "document", required: true },
  { table: "raw_fee_observations", column: "document_r2_key", holds: "key", required: true },
  { table: "verified_fee_observations", column: "document_r2_key", holds: "key", required: true },
  { table: "published_fee_records", column: "document_r2_key", holds: "key", required: true },
  { table: "published_fee_corrections", column: "source_document_id", holds: "document" },
  { table: "published_fee_correction_conflicts", column: "source_document_id", holds: "document" },
  { table: "historical_fee_observation_archive", column: "source_document_id", holds: "document" },
  { table: "institution_fee_snapshot_records", column: "source_document_id", holds: "document" },
  { table: "community_fee_submissions", column: "source_document_id", holds: "document" },
  { table: "backup_published_fee_catalog_20260815", column: "source_document_id", holds: "document" },
  { table: "backup_published_fee_catalog_20260815", column: "document_r2_key", holds: "key" },
  { table: "eval_cases", column: "source_document_id", holds: "document" },
  { table: "pipeline_feedback", column: "source_document_id", holds: "document" },
  { table: "pipeline_attempts", column: "source_document_id", holds: "document" },
  { table: "institution_payment_features", column: "source_document_id", holds: "document" },
  { table: "agent_source_text_witnesses", column: "source_document_id", holds: "document" },
  { table: "institution_source_profiles", column: "last_successful_source_document_id", holds: "document" },
  { table: "institution_additional_sources", column: "last_source_document_id", holds: "document" },
  { table: "answer_key_institutions", column: "content_hash", holds: "hash" },
  { table: "answer_key_institutions", column: "document_url", holds: "url" },
];

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface VaultSize {
  objects: number;
  mb: number;
  /** Objects whose rows recorded no byte size: counted, not in `mb`. */
  unsizedObjects: number;
  htmlMb: number;
  pdfMb: number;
  otherMb: number;
  /** Objects first stored in the last `VAULT_GROWTH_DAYS` days, and their size. */
  weekObjects: number;
  weekMb: number;
}

export interface VaultRetention {
  live: boolean;
  days: number;
  /** Objects the rule would delete; null when the count failed or was refused. */
  eligibleObjects: number | null;
  eligibleMb: number | null;
  /** Eligible objects whose size was not recorded (not in `eligibleMb`). */
  eligibleUnsized: number | null;
  deleted: number;
  deletedMb: number;
  /** Candidates the re-check just before deletion kept (re-fetched, cited or judged meanwhile). */
  kept: number;
  failed: number;
  /** Lineage tables found in this database (the count used each one). */
  lineageRefs: string[];
  /** Deleted keys of this run, so a deletion stays traceable on the ledger. */
  deletedKeys: string[];
  error?: string;
  note?: string;
}

export interface VaultResult {
  dryRun: boolean;
  size: VaultSize | null;
  sizeError?: string;
  alerts: string[];
  retention: VaultRetention;
}

const mb = (bytes: unknown) => Math.round((Number(bytes ?? 0) / 1_048_576) * 10) / 10;
const count = (value: unknown) => Number(value ?? 0);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
const refName = (ref: LineageRef) => `${ref.table}.${ref.column}`;

async function withTimeout<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  return inSavepoint(db, async (scope) => {
    const [prior] = await scope<{ value: string | null }[]>`
      SELECT current_setting('statement_timeout') AS value, set_config('statement_timeout', ${VAULT_STATEMENT_TIMEOUT}, true) AS applied
    `;
    // On failure the savepoint rolls back, which also undoes the timeout; restore only on success.
    const value = await work(scope);
    if (prior?.value != null) await scope`SELECT set_config('statement_timeout', ${prior.value}, true)`;
    return value;
  });
}

async function measureVault(db: SqlTag): Promise<VaultSize> {
  const [row] = await db<Record<string, string | null>[]>`
    WITH objects AS (
      SELECT document_r2_key AS key,
             max(byte_size) AS bytes,
             min(crawled_at) AS first_at,
             CASE WHEN bool_or(content_type ILIKE '%pdf%') THEN 'pdf'
                  WHEN bool_or(content_type ILIKE '%html%') THEN 'html'
                  ELSE 'other' END AS kind
        FROM source_documents
       WHERE document_r2_key ~ ${VAULT_KEY_PATTERN}
       GROUP BY document_r2_key
    )
    SELECT count(*)::bigint AS objects,
           COALESCE(sum(bytes), 0)::bigint AS bytes,
           count(*) FILTER (WHERE bytes IS NULL)::bigint AS unsized,
           COALESCE(sum(bytes) FILTER (WHERE kind = 'html'), 0)::bigint AS html_bytes,
           COALESCE(sum(bytes) FILTER (WHERE kind = 'pdf'), 0)::bigint AS pdf_bytes,
           COALESCE(sum(bytes) FILTER (WHERE kind = 'other'), 0)::bigint AS other_bytes,
           count(*) FILTER (WHERE first_at >= NOW() - make_interval(days => ${VAULT_GROWTH_DAYS}::int))::bigint AS week_objects,
           COALESCE(sum(bytes) FILTER (WHERE first_at >= NOW() - make_interval(days => ${VAULT_GROWTH_DAYS}::int)), 0)::bigint AS week_bytes
      FROM objects
  `;
  return {
    objects: count(row?.objects),
    mb: mb(row?.bytes),
    unsizedObjects: count(row?.unsized),
    htmlMb: mb(row?.html_bytes),
    pdfMb: mb(row?.pdf_bytes),
    otherMb: mb(row?.other_bytes),
    weekObjects: count(row?.week_objects),
    weekMb: mb(row?.week_bytes),
  };
}

/** The lineage references whose table and column exist here (temporary tables included). */
async function presentLineageRefs(db: SqlTag): Promise<LineageRef[]> {
  const tables = FEE_LINEAGE_REFS.map((ref) => ref.table);
  const columns = FEE_LINEAGE_REFS.map((ref) => ref.column);
  const rows = await db<{ tbl: string; col: string }[]>`
    SELECT r.tbl, r.col
      FROM unnest(${tables}::text[], ${columns}::text[]) AS r(tbl, col)
     WHERE EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = to_regclass(r.tbl) AND a.attname = r.col AND NOT a.attisdropped
     )
  `;
  const found = new Set(rows.map((row) => `${row.tbl}.${row.col}`));
  return FEE_LINEAGE_REFS.filter((ref) => found.has(refName(ref)));
}

/**
 * Pure: the SQL for the vault objects the retention rule may delete, given the lineage references
 * present. `$1` is `VAULT_REJECTED_DAYS`; with `list`, `$2` caps the keys returned; with `verify`,
 * `$2` is the one key re-checked just before it is retired. Identifiers come only from
 * `FEE_LINEAGE_REFS` and are checked.
 *
 * Each protected set is built once (MATERIALIZED, narrowed to the holders and keys in question)
 * and anti-joined, never re-evaluated per holder, so the daily count stays inside
 * `VAULT_STATEMENT_TIMEOUT`.
 */
export function rejectedVaultSql(refs: readonly LineageRef[], mode: "count" | "list" | "verify"): string {
  checkRefs(refs);
  const missing = FEE_LINEAGE_REFS.filter((ref) => ref.required && !refs.some((r) => refName(r) === refName(ref)));
  if (missing.length > 0) throw new Error(`Fee lineage not found: ${missing.map(refName).join(", ")}`);
  const docRefs = refs.filter((ref) => ref.holds === "document")
    .map((ref) => `SELECT ${ref.column}::bigint AS id FROM ${ref.table} WHERE ${ref.column} IS NOT NULL`);
  // A hand-confirmed answer-key document, named by bank and URL (`answer_key_institutions`).
  docRefs.push(...refs.filter((ref) => ref.holds === "url")
    .map((ref) => `SELECT sd.id::bigint AS id FROM ${ref.table} ak
          JOIN source_documents sd ON sd.institution_id = ak.institution_id AND sd.document_url = btrim(ak.${ref.column})`));
  // A live-fee audit capture names its stored document in its event detail (`live-source-capture.ts`).
  docRefs.push(`SELECT (detail->>'sourceDocumentId')::bigint AS id FROM agent_run_events
         WHERE event_type LIKE 'live_fee_audit.%' AND detail->>'sourceDocumentId' ~ '^[0-9]{1,18}$'`);
  // An answer-key eligibility check names every page it read (`answer-key-eligibility.ts`).
  docRefs.push(`SELECT (o->>'sourceDocumentId')::bigint AS id FROM agent_run_events e
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.detail->'observations') = 'array'
                                                       THEN e.detail->'observations' ELSE '[]'::jsonb END) AS o
         WHERE e.event_type = 'answer_key.eligibility' AND jsonb_typeof(o) = 'object'
           AND o->>'sourceDocumentId' ~ '^[0-9]{1,18}$'`);
  const keyRefs = refs.filter((ref) => ref.holds === "key")
    .map((ref) => `SELECT ${ref.column} AS key FROM ${ref.table} WHERE ${ref.column} IS NOT NULL`);
  // An answer-key content hash is the sha256 of the bytes, so its vault key is `documentKey(hash)`.
  keyRefs.push(...refs.filter((ref) => ref.holds === "hash")
    .map((ref) => `SELECT substr(h, 1, 2) || '/' || h AS key
          FROM (SELECT lower(btrim(${ref.column})) AS h FROM ${ref.table} WHERE ${ref.column} IS NOT NULL) hashes
         WHERE h ~ '^[0-9a-f]{64}$'`));
  const window = "NOW() - make_interval(days => $1::int)";
  const tail = mode === "count"
    ? `SELECT count(*)::bigint AS objects, COALESCE(sum(bytes), 0)::bigint AS bytes, count(*) FILTER (WHERE bytes IS NULL)::bigint AS unsized FROM eligible`
    : mode === "list"
      ? `SELECT key, bytes FROM eligible ORDER BY key LIMIT $2::int`
      : `SELECT key, bytes FROM eligible`;
  const onlyKey = mode === "verify" ? "\n         AND sd.document_r2_key = $2::text" : "";
  return `
    WITH rejected AS MATERIALIZED (
      SELECT DISTINCT sd.document_r2_key AS key
        FROM agent_source_texts t
        JOIN source_documents sd ON sd.id = t.source_document_id
       WHERE t.status = 'wrong_document'
         AND t.updated_at < ${window}
         AND sd.document_r2_key ~ '${VAULT_KEY_PATTERN}'${onlyKey}
    ),
    holders AS MATERIALIZED (
      SELECT r.key, sd.id, sd.duplicate_of_id, sd.fees_extracted, sd.byte_size, sd.crawled_at, sd.last_checked_at
        FROM rejected r JOIN source_documents sd ON sd.document_r2_key = r.key
      UNION
      SELECT r.key, sd.id, sd.duplicate_of_id, sd.fees_extracted, sd.byte_size, sd.crawled_at, sd.last_checked_at
        FROM rejected r JOIN source_documents sd ON sd.content_hash = split_part(r.key, '/', 2)
    ),
    holder_ids AS MATERIALIZED (
      SELECT id FROM holders
      UNION
      SELECT duplicate_of_id FROM holders WHERE duplicate_of_id IS NOT NULL
    ),
    protected_ids AS MATERIALIZED (
      SELECT DISTINCT p.id FROM (
        ${docRefs.join("\n        UNION ALL\n        ")}
      ) p
       WHERE p.id IN (SELECT id FROM holder_ids)
    ),
    protected_keys AS MATERIALIZED (
      SELECT DISTINCT p.key FROM (
        ${keyRefs.join("\n        UNION ALL\n        ")}
      ) p
       WHERE p.key IN (SELECT key FROM rejected)
    ),
    texts AS MATERIALIZED (
      SELECT t.source_document_id AS id,
             bool_or(t.status = 'wrong_document' AND t.updated_at < ${window}) AS old_wrong,
             bool_or(t.status <> 'wrong_document') AS other
        FROM agent_source_texts t
       WHERE t.source_document_id IN (SELECT id FROM holder_ids)
       GROUP BY t.source_document_id
    ),
    judged AS (
      SELECT h.key, h.byte_size,
             (COALESCE(h.fees_extracted, 0) = 0
              AND GREATEST(h.crawled_at, h.last_checked_at) < ${window}
              AND p1.id IS NULL AND p2.id IS NULL
              AND (COALESCE(t1.old_wrong, false) OR COALESCE(t2.old_wrong, false))
              AND NOT COALESCE(t1.other, false) AND NOT COALESCE(t2.other, false)) AS ok
        FROM holders h
        LEFT JOIN protected_ids p1 ON p1.id = h.id
        LEFT JOIN protected_ids p2 ON p2.id = h.duplicate_of_id
        LEFT JOIN texts t1 ON t1.id = h.id
        LEFT JOIN texts t2 ON t2.id = h.duplicate_of_id
    ),
    eligible AS (
      SELECT g.key, g.bytes
        FROM (SELECT key, max(byte_size) AS bytes FROM judged GROUP BY key HAVING bool_and(ok) IS TRUE) g
       WHERE NOT EXISTS (SELECT 1 FROM protected_keys k WHERE k.key = g.key)
    )
    ${tail}
  `;
}

function checkRefs(refs: readonly LineageRef[]): void {
  for (const ref of refs) {
    if (!IDENTIFIER.test(ref.table) || !IDENTIFIER.test(ref.column)) throw new Error(`Unsafe lineage reference ${refName(ref)}`);
  }
}

/**
 * Pure: run after a key was cleared and committed. Any row that holds the key, re-fetched the same
 * bytes inside the window, or cites the key or hash means the bytes were stored or used meanwhile,
 * so the object stays. `$1` is the key, `$2` its hash, `$3` `VAULT_REJECTED_DAYS`.
 */
export function vaultKeyReferencedSql(refs: readonly LineageRef[]): string {
  checkRefs(refs);
  const arms = [
    `SELECT 1 FROM source_documents WHERE document_r2_key = $1::text
          OR (content_hash = $2::text AND GREATEST(crawled_at, last_checked_at) >= NOW() - make_interval(days => $3::int))`,
    ...refs.filter((ref) => ref.holds === "key").map((ref) => `SELECT 1 FROM ${ref.table} WHERE ${ref.column} = $1::text`),
    ...refs.filter((ref) => ref.holds === "hash").map((ref) => `SELECT 1 FROM ${ref.table} WHERE lower(btrim(${ref.column})) = $2::text`),
  ];
  return `SELECT EXISTS (\n      ${arms.join("\n      UNION ALL\n      ")}\n    ) AS referenced`;
}

async function countEligible(db: SqlTag, refs: LineageRef[]): Promise<{ objects: number; mb: number; unsized: number }> {
  const [row] = await db.unsafe<Record<string, string>[]>(rejectedVaultSql(refs, "count"), [VAULT_REJECTED_DAYS]);
  return { objects: count(row?.objects), mb: mb(row?.bytes), unsized: count(row?.unsized) };
}

async function listEligible(db: SqlTag, refs: LineageRef[], limit: number): Promise<Array<{ key: string; bytes: number | null }>> {
  const rows = await db.unsafe<{ key: string; bytes: string | null }[]>(rejectedVaultSql(refs, "list"), [VAULT_REJECTED_DAYS, limit]);
  return rows.map((row) => ({ key: row.key, bytes: row.bytes == null ? null : Number(row.bytes) }));
}

type RetireOutcome = "deleted" | "kept" | "failed";

/**
 * Retires one vault object so that no row is left pointing at a deleted file:
 * 1. In its own transaction, committed before anything is deleted: lock every row holding the
 *    bytes, re-run the whole eligibility check for this key alone, and clear `document_r2_key`
 *    on its rows.
 * 2. After that commit, re-check that nothing stored, re-fetched or cited the same bytes meanwhile
 *    (Magellan's `store()` skips the upload when the object exists, so a new row would share it).
 *    If anything did, the cleared rows get their key back and the object stays.
 * 3. Delete the object. A failed delete gives the rows their key back, so rows and bytes match.
 * 4. A row that stored the same bytes during the delete itself has the key cleared too, so it never
 *    points at a missing file.
 */
async function retireVaultObject(
  commitDb: SqlTag, refs: LineageRef[], client: S3Client, key: string, bucket: string | undefined,
): Promise<RetireOutcome> {
  const hash = key.slice(3);
  const cleared = (await commitDb.begin(async (transaction) => {
    const tx = transaction as unknown as SqlTag;
    await tx`SELECT set_config('statement_timeout', ${VAULT_STATEMENT_TIMEOUT}, true)`;
    await tx`SELECT id FROM source_documents WHERE document_r2_key = ${key} OR content_hash = ${hash} FOR UPDATE`;
    const still = await tx.unsafe<{ key: string }[]>(rejectedVaultSql(refs, "verify"), [VAULT_REJECTED_DAYS, key]);
    if (still.length === 0) return null;
    const rows = await tx<{ id: string | number }[]>`
      UPDATE source_documents SET document_r2_key = NULL WHERE document_r2_key = ${key} RETURNING id
    `;
    return rows.map((row) => Number(row.id));
  })) as number[] | null;
  if (cleared == null) return "kept";

  const restore = () => commitDb`
    UPDATE source_documents SET document_r2_key = ${key}
     WHERE id = ANY(${cleared}::bigint[]) AND document_r2_key IS NULL
  `;
  const [check] = await commitDb.unsafe<{ referenced: boolean }[]>(vaultKeyReferencedSql(refs), [key, hash, VAULT_REJECTED_DAYS]);
  if (check?.referenced !== false) {
    await restore();
    return "kept";
  }
  try {
    await deleteVaultObject(client, key, bucket);
  } catch {
    await restore();
    return "failed";
  }
  try {
    await commitDb`UPDATE source_documents SET document_r2_key = NULL WHERE document_r2_key = ${key}`;
  } catch {
    // The object is gone either way; the next run's size count still shows any row left holding it.
  }
  return "deleted";
}

/** Pure: the step's warnings for a vault above its size or week's growth threshold. */
export function vaultAlerts(size: VaultSize | null): string[] {
  if (!size) return [];
  const alerts: string[] = [];
  if (size.mb > VAULT_ALERT_MB) alerts.push(`document vault is ${size.mb.toLocaleString("en-US")} MB, above ${VAULT_ALERT_MB.toLocaleString("en-US")} MB`);
  if (size.weekMb > VAULT_WEEKLY_GROWTH_ALERT_MB) {
    alerts.push(`document vault grew ${size.weekMb.toLocaleString("en-US")} MB in ${VAULT_GROWTH_DAYS} days, above ${VAULT_WEEKLY_GROWTH_ALERT_MB.toLocaleString("en-US")} MB`);
  }
  return alerts;
}

/**
 * Measure the vault, count what the retention rule would delete and, only while it is switched
 * on, delete it. Never throws: a failed measurement or count is reported in the result.
 */
export async function runVaultRetention(options: {
  db: SqlTag;
  dryRun?: boolean;
  live?: boolean;
  /** R2 client for deletion; null when R2 is not configured. Read only while retention is live. */
  client?: S3Client | null;
  bucket?: string;
  /**
   * A connection outside the step's transaction (the pool), on which each deletion's re-check and
   * key clearing commit before the object is deleted. Read only while retention is live.
   */
  commitDb?: SqlTag | null;
}): Promise<VaultResult> {
  const { db } = options;
  const dryRun = Boolean(options.dryRun);
  const live = !dryRun && (options.live ?? VAULT_RETENTION_LIVE);

  let size: VaultSize | null = null;
  let sizeError: string | undefined;
  try {
    size = await withTimeout(db, measureVault);
  } catch (error) {
    sizeError = message(error);
  }

  const retention: VaultRetention = {
    live, days: VAULT_REJECTED_DAYS, eligibleObjects: null, eligibleMb: null, eligibleUnsized: null,
    deleted: 0, deletedMb: 0, kept: 0, failed: 0, lineageRefs: [], deletedKeys: [],
  };
  try {
    const refs = await withTimeout(db, presentLineageRefs);
    retention.lineageRefs = refs.map(refName);
    const eligible = await withTimeout(db, (scope) => countEligible(scope, refs));
    retention.eligibleObjects = eligible.objects;
    retention.eligibleMb = eligible.mb;
    retention.eligibleUnsized = eligible.unsized;

    if (live && eligible.objects > 0) {
      if (!options.client) {
        retention.note = "R2 is not configured; nothing deleted";
      } else if (!options.commitDb) {
        retention.note = "no connection outside the step's transaction; nothing deleted";
      } else {
        const client = options.client;
        const commitDb = options.commitDb;
        // Candidates only: each key is re-checked and cleared in its own committed transaction
        // before its object is deleted (`retireVaultObject`), never inside the step's transaction.
        const keys = await withTimeout(db, (scope) => listEligible(scope, refs, VAULT_DELETE_BATCH));
        let bytes = 0;
        for (const { key, bytes: objectBytes } of keys) {
          if (!isVaultKey(key)) { retention.failed += 1; continue; }
          let outcome: RetireOutcome;
          try {
            outcome = await retireVaultObject(commitDb, refs, client, key, options.bucket);
          } catch {
            outcome = "failed";
          }
          if (outcome === "deleted") {
            retention.deletedKeys.push(key);
            bytes += objectBytes ?? 0;
          } else if (outcome === "kept") {
            retention.kept += 1;
          } else {
            retention.failed += 1;
          }
        }
        retention.deleted = retention.deletedKeys.length;
        retention.deletedMb = mb(bytes);
      }
    }
  } catch (error) {
    retention.error = message(error);
  }

  return { dryRun, size, ...(sizeError ? { sizeError } : {}), alerts: vaultAlerts(size), retention };
}

export function vaultRetentionDetail(result: VaultResult): Record<string, unknown> {
  const { size, retention } = result;
  return {
    dry_run: result.dryRun,
    size: size
      ? {
        objects: size.objects, mb: size.mb, unsized_objects: size.unsizedObjects,
        html_mb: size.htmlMb, pdf_mb: size.pdfMb, other_mb: size.otherMb,
        week_objects: size.weekObjects, week_mb: size.weekMb, growth_days: VAULT_GROWTH_DAYS,
      }
      : null,
    ...(result.sizeError ? { size_error: result.sizeError } : {}),
    alerts: result.alerts,
    thresholds: { alert_mb: VAULT_ALERT_MB, weekly_growth_alert_mb: VAULT_WEEKLY_GROWTH_ALERT_MB },
    retention: {
      live: retention.live,
      days: retention.days,
      eligible_objects: retention.eligibleObjects,
      eligible_mb: retention.eligibleMb,
      eligible_unsized: retention.eligibleUnsized,
      deleted: retention.deleted,
      deleted_mb: retention.deletedMb,
      kept: retention.kept,
      failed: retention.failed,
      lineage_refs: retention.lineageRefs,
      deleted_keys: retention.deletedKeys,
      ...(retention.error ? { error: retention.error } : {}),
      ...(retention.note ? { note: retention.note } : {}),
    },
  };
}

export function summarizeVaultRetention(result: VaultResult): string {
  const { size, retention } = result;
  const sized = size
    ? `Document vault ${size.objects.toLocaleString("en-US")} files, ${size.mb.toLocaleString("en-US")} MB `
      + `(HTML ${size.htmlMb.toLocaleString("en-US")}, PDF ${size.pdfMb.toLocaleString("en-US")}, other ${size.otherMb.toLocaleString("en-US")}); `
      + `+${size.weekMb.toLocaleString("en-US")} MB in ${size.weekObjects.toLocaleString("en-US")} new files over ${VAULT_GROWTH_DAYS} days`
      + `${size.unsizedObjects > 0 ? `; ${size.unsizedObjects.toLocaleString("en-US")} files with no recorded size` : ""}.`
    : "Atlas could not measure the document vault.";
  const alert = result.alerts.length > 0 ? ` Warning: ${result.alerts.join("; ")}.` : "";
  const rule = `rejected documents over ${retention.days} days old, not fee lineage`;
  const kept = retention.eligibleObjects == null
    ? ` Vault retention (${rule}): could not count${retention.error ? ` (${retention.error})` : ""}.`
    : retention.live
      ? ` Vault retention (${rule}): deleted ${retention.deleted.toLocaleString("en-US")} of ${retention.eligibleObjects.toLocaleString("en-US")} files (${retention.deletedMb.toLocaleString("en-US")} MB)${retention.kept > 0 ? `, ${retention.kept} kept on re-check` : ""}${retention.failed > 0 ? `, ${retention.failed} failed` : ""}${retention.note ? `; ${retention.note}` : ""}.`
      : ` Vault retention (${rule}): ${retention.eligibleObjects.toLocaleString("en-US")} files, ${(retention.eligibleMb ?? 0).toLocaleString("en-US")} MB would go (off).`;
  return `${sized}${alert}${kept}`;
}
