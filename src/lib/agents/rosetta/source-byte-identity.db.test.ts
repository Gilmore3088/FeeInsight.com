// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import type { DocumentVault } from "../document-vault";
import { isPermanentForInput } from "../learning/outcomes";
import { normalizedWitnessSchemaReady } from "./normalized-witness";
import { runRosettaRead } from "./read";

const url = process.env.E2E_DATABASE_URL;
const a = readFileSync(new URL("./test-fixtures/byte-identity-A.html", import.meta.url));
const b = readFileSync(new URL("./test-fixtures/byte-identity-B.html", import.meta.url));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = hash(a);
const sourceUrl = "https://fixture.invalid/fees.html";
type Db = NonNullable<Parameters<typeof runRosettaRead>[0]["db"]>;

describe.skipIf(!url)("Rosetta selected raw bytes on the current native schema", () => {
  let client: postgres.Sql<{ json: unknown; numeric: number; text: string }>;
  beforeAll(async () => {
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Owned loopback PostgreSQL required");
    client = postgres(url, { max: 1, ssl: "require", prepare: false,
      types: { json: JSON_TEXT_PASSTHROUGH, numeric: NUMERIC_AS_NUMBER, text: TEXT_WITHOUT_NUL } });
    const [ready] = await client`SELECT to_regclass('public.source_documents') IS NOT NULL
      AND to_regclass('public.pipeline_attempts') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='agent_source_texts' AND column_name='table_rows') AS ready`;
    if (!ready?.ready) throw new Error("Load the exact current production-schema fixture first");
  });
  afterAll(async () => { if (client) await client.end({ timeout: 5 }); });

  async function isolated(work: (db: Db) => Promise<void>) {
    const rollback = new Error("Owned native fixture rollback");
    try {
      await client.begin(async (tx) => {
        await work(tx as unknown as Db);
        throw rollback;
      });
      throw new Error("Fixture unexpectedly committed");
    } catch (error) { if (error !== rollback) throw error; }
  }
  async function seed(db: Db, selected: string | null = sourceHash, vault = false) {
    const [run] = await db`INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta','workflow') RETURNING id`;
    const [institution] = await db`INSERT INTO institution_sources (institution_name,charter_type,state_code,source,fee_schedule_url)
      VALUES ('Owned Byte Identity Bank','bank','ZX','e2e',${sourceUrl}) RETURNING id`;
    const [document] = await db`INSERT INTO source_documents (institution_id,status,document_url,content_hash,content_type,document_r2_key)
      VALUES (${institution.id},'success',${sourceUrl},${selected},'text/html',${vault ? `${sourceHash.slice(0, 2)}/${sourceHash}` : null}) RETURNING id`;
    await db`INSERT INTO institution_source_profiles (institution_id,state_code,canonical_source_url,source_kind)
      VALUES (${institution.id},'ZX',${sourceUrl},'unknown')`;
    return { run: Number(run.id), institution: Number(institution.id), document: Number(document.id) };
  }
  function inputs(bytes = a, vaultBytes?: Uint8Array) {
    const fetch = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "text/html" } }));
    const read = vi.fn(async () => vaultBytes ?? a);
    const vault: DocumentVault = { configured: vaultBytes !== undefined, read,
      store: async () => { throw new Error("No storage write"); }, presign: async () => { throw new Error("No presign"); } };
    const pdf = vi.fn(async () => { throw new Error("No PDF conversion"); });
    const ocr = vi.fn(async () => { throw new Error("No OCR"); });
    return { fetch, read, vault, pdf, ocr };
  }
  async function run(db: Db, selected: Awaited<ReturnType<typeof seed>>, io: ReturnType<typeof inputs>) {
    return runRosettaRead({ db, runId: selected.run, institutionId: selected.institution, limit: 1,
      fetchImpl: io.fetch, vault: io.vault, pdfTextExtractor: io.pdf,
      scannedPdfReader: { read: io.ocr, close: async () => {} }, ocrDocumentsPerRun: 0 });
  }

  it.each(["http", "vault"])("keeps ordinary matching %s conversion and native writes intact", async (transport) => isolated(async (db) => {
    const selected = await seed(db, sourceHash, transport === "vault");
    const io = inputs(a, transport === "vault" ? a : undefined);
    const result = await run(db, selected, io);
    expect(result).toMatchObject({ selected: 1, completed: 1, failed: 0 });
    expect(result.results[0].primaryByteIdentity).toMatchObject({ status: "verified", selectedHash: sourceHash, observedHash: sourceHash });
    const [stored] = await db`SELECT * FROM agent_source_texts WHERE source_document_id=${selected.document}`;
    expect(stored).toMatchObject({ status: "completed", source_hash: sourceHash, reader: "read.html_dom" });
    expect(stored.normalized_text).toContain("Overdraft fee | $30.00"); expect(stored.table_rows.rows).toHaveLength(13);
    expect(io.fetch).toHaveBeenCalledTimes(transport === "http" ? 1 : 0);
    expect(io.read).toHaveBeenCalledTimes(transport === "vault" ? 1 : 0);
  }));

  it.each(["http", "vault", "malformed"])("leaves native artifacts/profile/witnesses untouched after %s identity failure", async (transport) => isolated(async (db) => {
    const selected = await seed(db, transport === "malformed" ? "invalid-selected-hash" : sourceHash, transport === "vault");
    const [before] = await db`SELECT * FROM institution_source_profiles WHERE institution_id=${selected.institution}`;
    const io = inputs(b, transport === "vault" ? b : undefined);
    const result = await run(db, selected, io);
    expect(result).toMatchObject({ selected: 1, completed: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({ attemptOutcome: "evidence_mismatch", reader: null, textHash: null, charCount: 0 });
    expect(await db`SELECT * FROM agent_source_texts WHERE source_document_id=${selected.document}`).toHaveLength(0);
    expect((await db`SELECT * FROM institution_source_profiles WHERE institution_id=${selected.institution}`)[0]).toEqual(before);
    if (await normalizedWitnessSchemaReady(db))
      expect(await db`SELECT * FROM agent_source_text_witnesses WHERE source_document_id=${selected.document}`).toHaveLength(0);
    const attempts = await db`SELECT strategy,outcome,detail FROM pipeline_attempts WHERE source_document_id=${selected.document}`;
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ strategy: "read.document_access", outcome: "evidence_mismatch" });
    expect(isPermanentForInput(attempts[0].outcome)).toBe(false);
    expect(io.fetch).toHaveBeenCalledTimes(transport === "http" ? 1 : 0); expect(io.pdf).not.toHaveBeenCalled(); expect(io.ocr).not.toHaveBeenCalled();
  }));

  it("retains a usable legacy read as unbound without inventing a captured raw hash", async () => isolated(async (db) => {
    const selected = await seed(db, null); const result = await run(db, selected, inputs());
    expect(result.completed).toBe(1);
    expect(result.results[0]).toMatchObject({ sourceHash: null, primaryByteIdentity: { status: "unbound", selectedHash: null, observedHash: sourceHash } });
    expect((await db`SELECT source_hash FROM agent_source_texts WHERE source_document_id=${selected.document}`)[0].source_hash).toBeNull();
    expect((await db`SELECT last_source_hash FROM institution_source_profiles WHERE institution_id=${selected.institution}`)[0].last_source_hash).toBeNull();
  }));

  it("reads a legitimate later capture without a false success on the old hash", async () => isolated(async (db) => {
    const selected = await seed(db); const io = inputs(b);
    expect(await run(db, selected, io)).toMatchObject({ failed: 1, completed: 0 });
    const nextHash = hash(b);
    const [next] = await db`INSERT INTO source_documents (institution_id,status,document_url,content_hash,content_type)
      VALUES (${selected.institution},'success',${sourceUrl},${nextHash},'text/html') RETURNING id`;
    await db`UPDATE source_documents SET superseded_by_id=${next.id} WHERE id=${selected.document}`;
    const result = await run(db, selected, io);
    expect(result).toMatchObject({ selected: 1, completed: 1, failed: 0 });
    expect(result.results[0]).toMatchObject({ sourceDocumentId: Number(next.id), sourceHash: nextHash });
    const stored = await db`SELECT source_document_id,source_hash,normalized_text FROM agent_source_texts WHERE institution_id=${selected.institution}`;
    expect(stored).toHaveLength(1); expect(stored[0].source_hash).toBe(nextHash); expect(stored[0].normalized_text).toContain("Overdraft fee | $35.00");
    expect(await db`SELECT * FROM pipeline_attempts WHERE source_document_id=${selected.document} AND outcome='ok'`).toHaveLength(0);
  }));
});
