/** Real PostgreSQL check of the vault retention rule (#1041): no object reached by fee lineage is ever deleted. */
import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { runVaultRetention } from "./vault-retention";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof runVaultRetention>[0]["db"];

const hash = (n: number) => n.toString(16).padStart(64, "0");
const key = (n: number) => `${hash(n).slice(0, 2)}/${hash(n)}`;

/**
 * One eligible object (A) and one protected object for every way a fee, past or present, or its
 * evidence can reach a stored document.
 */
const DOCS = [
  { id: 1, obj: 1, why: "eligible: rejected 60 days ago, nothing points at it" },
  { id: 2, obj: 2, why: "a raw fee cites the document" },
  { id: 3, obj: 3, why: "a rolled-back published fee cites the key" },
  { id: 4, obj: 4, why: "a verified fee cites the key" },
  { id: 5, obj: 5, why: "another bank's copy of the same bytes was read as a fee schedule" },
  { id: 6, obj: 5, why: "(the other copy)", text: "completed" },
  { id: 7, obj: 7, why: "judged wrong only 5 days ago", judgedDaysAgo: 5 },
  { id: 8, obj: 8, why: "a published fee correction cites the document" },
  { id: 9, obj: 9, why: "a live-fee audit captured it" },
  { id: 10, obj: 10, why: "a Deming eval case cites it" },
  { id: 11, obj: 11, why: "a copy with no vault key (same hash) is a past fee's source" },
  { id: 12, obj: 11, why: "(the copy, also judged wrong)", noKey: true },
  { id: 14, obj: 14, why: "the document extracted fees", feesExtracted: 2 },
  { id: 15, obj: 15, why: "an archived historical fee cites it" },
  { id: 16, obj: 16, why: "a profile's last good document" },
  { id: 17, obj: 17, why: "re-checked by Magellan 3 days ago", checkedDaysAgo: 3 },
] as const;

describe.skipIf(!connection)("vault retention in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Vault retention tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, status text, content_hash text,
      document_r2_key text, content_type text, byte_size bigint, fees_extracted integer NOT NULL DEFAULT 0, duplicate_of_id bigint,
      crawled_at timestamptz NOT NULL, last_checked_at timestamptz)`;
    await db`CREATE TEMP TABLE agent_source_texts (id bigserial PRIMARY KEY, source_document_id bigint NOT NULL, status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigserial PRIMARY KEY, source_document_id integer, document_r2_key text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigserial PRIMARY KEY, document_r2_key text)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigserial PRIMARY KEY, document_r2_key text, rolled_back_at timestamptz)`;
    await db`CREATE TEMP TABLE published_fee_corrections (id bigserial PRIMARY KEY, source_document_id bigint)`;
    await db`CREATE TEMP TABLE historical_fee_observation_archive (id bigserial PRIMARY KEY, source_document_id bigint)`;
    await db`CREATE TEMP TABLE eval_cases (id bigserial PRIMARY KEY, source_document_id bigint)`;
    await db`CREATE TEMP TABLE institution_source_profiles (institution_id bigint PRIMARY KEY, last_successful_source_document_id bigint)`;
    await db`CREATE TEMP TABLE agent_run_events (id bigserial PRIMARY KEY, event_type text NOT NULL, detail jsonb NOT NULL DEFAULT '{}')`;

    for (const doc of DOCS) {
      const d = doc as { id: number; obj: number; judgedDaysAgo?: number; checkedDaysAgo?: number; noKey?: boolean; text?: string | null; feesExtracted?: number };
      await db`INSERT INTO source_documents (id, institution_id, status, content_hash, document_r2_key, content_type, byte_size, fees_extracted, crawled_at, last_checked_at)
        VALUES (${d.id}, ${d.id}, 'success', ${hash(d.obj)}, ${d.noKey ? null : key(d.obj)}, 'text/html', 1048576, ${d.feesExtracted ?? 0},
                now() - interval '90 days', now() - make_interval(days => ${d.checkedDaysAgo ?? 60}))`;
      const status = d.text === undefined ? "wrong_document" : d.text;
      if (status) {
        await db`INSERT INTO agent_source_texts (source_document_id, status, created_at, updated_at)
          VALUES (${d.id}, ${status}, now() - interval '90 days', now() - make_interval(days => ${d.judgedDaysAgo ?? 60}))`;
      }
    }
    await db`INSERT INTO raw_fee_observations (source_document_id, document_r2_key) VALUES (2, NULL), (12, NULL)`;
    await db`INSERT INTO published_fee_records (document_r2_key, rolled_back_at) VALUES (${key(3)}, now() - interval '40 days')`;
    await db`INSERT INTO verified_fee_observations (document_r2_key) VALUES (${key(4)})`;
    await db`INSERT INTO published_fee_corrections (source_document_id) VALUES (8)`;
    await db`INSERT INTO agent_run_events (event_type, detail) VALUES ('live_fee_audit.capture', ${JSON.stringify({ sourceDocumentId: 9 })}::jsonb)`;
    await db`INSERT INTO eval_cases (source_document_id) VALUES (10)`;
    await db`INSERT INTO historical_fee_observation_archive (source_document_id) VALUES (15)`;
    await db`INSERT INTO institution_source_profiles VALUES (16, 16)`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("counts only the unreferenced rejected object while off, and changes nothing", async () => {
    const before = await db`SELECT * FROM source_documents ORDER BY id`;
    const result = await db.begin((tx) => runVaultRetention({ db: tx as unknown as Db, live: false, client: null }));
    expect(result.retention).toMatchObject({ live: false, eligibleObjects: 1, eligibleMb: 1, deleted: 0 });
    expect(result.retention.error).toBeUndefined();
    expect(result.size).toMatchObject({ objects: 14, mb: 14, unsizedObjects: 0 });
    expect(await db`SELECT * FROM source_documents ORDER BY id`).toEqual(before);
  });

  it("deletes only the object no fee lineage reaches, even when switched on", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;
    const result = await db.begin((tx) => runVaultRetention({ db: tx as unknown as Db, live: true, client, bucket: "docs" }));
    expect(result.retention).toMatchObject({ live: true, eligibleObjects: 1, deleted: 1, failed: 0, deletedKeys: [key(1)] });
    const deleted = send.mock.calls.map(([command]) => (command as DeleteObjectCommand).input.Key);
    expect(send.mock.calls.every(([command]) => command instanceof DeleteObjectCommand)).toBe(true);
    expect(deleted).toEqual([key(1)]);
    const rows = await db<{ id: string; document_r2_key: string | null }[]>`SELECT id, document_r2_key FROM source_documents ORDER BY id`;
    for (const row of rows) {
      const doc = DOCS.find((d) => d.id === Number(row.id)) as { obj: number; noKey?: boolean };
      expect(row.document_r2_key, `document ${row.id}`).toBe(Number(row.id) === 1 || doc.noKey ? null : key(doc.obj));
    }
  });

  it("protects each of those objects through its lineage row alone (not by accident)", async () => {
    // With every lineage row gone (rolled back after), the nine lineage-protected objects become
    // eligible; the four kept for other reasons (read copy, recent verdict, fees found, recent check) stay.
    const rollback = new Error("rollback");
    let eligible: number | null = null;
    await db.begin(async (tx) => {
      for (const table of ["raw_fee_observations", "verified_fee_observations", "published_fee_records", "published_fee_corrections",
        "historical_fee_observation_archive", "eval_cases", "institution_source_profiles", "agent_run_events"]) {
        await tx.unsafe(`DELETE FROM ${table}`);
      }
      eligible = (await runVaultRetention({ db: tx as unknown as Db, live: false })).retention.eligibleObjects;
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
    expect(eligible).toBe(9);
  });
});
