// @vitest-environment node
/**
 * Rosetta's page starts in real PostgreSQL (production schema, loopback only, #2929): the stored-text
 * writer records where each PDF page starts, clears them when the row's text is replaced by one with
 * none, and the citation read (`getFeeSourceLocations`) names the page from them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReadResult } from "./read";

const connection = process.env.E2E_DATABASE_URL;
const witnessMigration = readFileSync(join(__dirname, "../../../../supabase/migrations/20270110000067_normalized_source_text_witnesses.sql"), "utf8");
const EVENT = "00000000-0000-4000-8000-000002929000";
const PAGES = ["First Example Bank Schedule of Fees\nOverdraft Fee ........ $32.00 per item", "Wire Transfers\nOutgoing Domestic Wire ........ $25.00"];
const TEXT = PAGES.join("\n\n");
const WIRE = "Outgoing Domestic Wire ........ $25.00";

describe.skipIf(!connection)("Rosetta page starts in isolated PostgreSQL", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let reader: typeof import("./read");
  let pages: typeof import("./page-starts");
  let witness: typeof import("./normalized-witness");
  let locations: typeof import("@/lib/data-store/source-line-traces");
  const priorUrl = process.env.DATABASE_URL;
  const priorPool = process.env.DATABASE_POOL_MAX;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Only an isolated loopback database is allowed");
    }
    process.env.DATABASE_URL = connection;
    process.env.DATABASE_POOL_MAX = "5";
    vi.resetModules();
    ({ sql: db } = await import("@/lib/data-store/connection"));
    reader = await import("./read");
    pages = await import("./page-starts");
    witness = await import("./normalized-witness");
    locations = await import("@/lib/data-store/source-line-traces");
    if (!(await witness.normalizedWitnessSchemaReady(db))) await db.unsafe(witnessMigration);
  });

  afterAll(async () => {
    await db?.end();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
    if (priorPool === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = priorPool;
  });

  type Db = typeof db;
  async function rolledBack(work: (scope: Db) => Promise<void>) {
    const rollback = new Error("intentional fixture rollback");
    try {
      await db.begin(async (tx) => { await work(tx as unknown as Db); throw rollback; });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  async function seed(scope: Db) {
    const [inst] = await scope`
      INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
      VALUES ('Page starts fixture', 'bank', 'ZW', 'e2e', 'https://fixture.example/fees.pdf') RETURNING id`;
    const [doc] = await scope`
      INSERT INTO source_documents (institution_id, status, document_url, content_hash)
      VALUES (${inst.id}, 'success', 'https://fixture.example/fees.pdf', 'page-starts-source') RETURNING id`;
    const [run] = await scope`INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta', 'manual_repair') RETURNING id`;
    // The catalog shows a bank only once it has 3 fee categories live: publish three, cite the wire.
    const publish = async (key: string, name: string, amount: number, line: string): Promise<number> => {
      const note = `Knox deterministic extraction. canonical_hint=${key}; excerpt="${line}"`;
      const [rawFee] = await scope`
        INSERT INTO raw_fee_observations (institution_id, source_document_id, agent_event_id, fee_name, amount, source, extraction_note)
        VALUES (${inst.id}, ${doc.id}, ${EVENT}, ${name}, ${amount}, 'knox', ${note}) RETURNING fee_raw_id`;
      const [verified] = await scope`
        INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
        VALUES (${rawFee.fee_raw_id}, ${inst.id}, ${key}, ${EVENT}, ${name}, ${amount}, 'verified') RETURNING fee_verified_id`;
      const [published] = await scope`
        INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
        VALUES (${verified.fee_verified_id}, ${inst.id}, ${key}, ${EVENT}, ${name}, ${amount}, 'agentic-run-2929', 'https://fixture.example/fees.pdf')
        RETURNING fee_published_id`;
      return Number(published.fee_published_id);
    };
    const catalogId = await publish("wire_domestic_outgoing", "Outgoing Domestic Wire", 25, WIRE);
    await publish("overdraft", "Overdraft Fee", 32, "Overdraft Fee ........ $32.00 per item");
    await publish("stop_payment", "Stop Payment", 30, "Stop Payment $30.00");
    return { institutionId: Number(inst.id), documentId: Number(doc.id), runId: Number(run.id), catalogId };
  }

  function result(fixture: Awaited<ReturnType<typeof seed>>, text: string, pageStarts: number[] | null): ReadResult {
    return { sourceDocumentId: fixture.documentId, institutionId: fixture.institutionId, institutionName: "Page starts fixture",
      sourceUrl: "https://fixture.example/fees.pdf", status: "completed", documentType: "pdf", contentType: "application/pdf",
      sourceHash: "page-starts-source", textHash: witness.exactTextHash(text), charCount: text.length,
      error: null, attemptOutcome: "ok", strategy: "read.pdf_layout", format: "pdf_text", routerReason: null, fromVault: true,
      pageCheck: null, tableRows: 0, rows: [], reader: "read.pdf_layout", followUps: [], handoff: null, reread: false, pageStarts, durationMs: 0 };
  }

  async function storedStarts(scope: Db, documentId: number): Promise<number[] | null> {
    const [row] = await scope`SELECT page_starts FROM agent_source_texts WHERE source_document_id = ${documentId}`;
    return row.page_starts == null ? null : (row.page_starts as number[]).map(Number);
  }

  it("records the page starts, names the page from them, and clears them when the text changes", async () => rolledBack(async (scope) => {
    expect(await pages.pageStartsColumnReady(scope)).toBe(true);
    const fixture = await seed(scope);
    const starts = pages.pdfPageStarts(TEXT, PAGES, 2);
    expect(starts).toEqual([0, Array.from(PAGES[0]).length + 2]);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, TEXT, starts), TEXT, true);
    expect(await storedStarts(scope, fixture.documentId)).toEqual(starts);

    const found = await locations.getFeeSourceLocations([fixture.catalogId], scope);
    expect(found.get(fixture.catalogId)).toMatchObject({ miss: null, location: { page: 2, pageLine: 2, textLine: 5 } });

    // A new text with no proven page starts: the row never keeps the old text's starts.
    const plain = `Schedule of Fees\n${WIRE}`;
    await reader.recordReadResult(scope, fixture.runId, result(fixture, plain, null), plain, true);
    expect(await storedStarts(scope, fixture.documentId)).toBeNull();
    const again = await locations.getFeeSourceLocations([fixture.catalogId], scope);
    expect(again.get(fixture.catalogId)).toMatchObject({ miss: null, location: { page: null, textLine: 2 } });
  }));

  it("writes and reads as before when the column does not exist yet", async () => rolledBack(async (scope) => {
    await scope`ALTER TABLE agent_source_texts DROP COLUMN page_starts`;
    expect(await pages.pageStartsColumnReady(scope)).toBe(false);
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, TEXT, pages.pdfPageStarts(TEXT, PAGES, 2)), TEXT, true);
    const found = await locations.getFeeSourceLocations([fixture.catalogId], scope);
    expect(found.get(fixture.catalogId)).toMatchObject({ miss: null, location: { page: null, textLine: 5 } });
  }));

  it("stores no page starts that run past the text they describe", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, TEXT, [0, Array.from(TEXT).length + 10]), TEXT, true);
    expect(await storedStarts(scope, fixture.documentId)).toBeNull();
  }));
});
