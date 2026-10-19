// @vitest-environment node
/** Actual owner selection/readiness/ledger in a fresh loopback production-schema DB. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connection = process.env.E2E_DATABASE_URL;
const STATE = "ZX"; // Dedicated fake state; never select another E2E suite's bank.
const bytes = readFileSync(join(__dirname, "test-fixtures/oakwood-fees.pdf"));
const sourceHash = createHash("sha256").update(bytes).digest("hex");
const text = readFileSync(join(__dirname, "test-fixtures/oakwood-interleaved.txt"), "utf8");
const textHash = createHash("sha256").update(text).digest("hex");

describe.skipIf(!connection)("stacked PDF repair in isolated PostgreSQL", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let owner: typeof import("./read");
  let stateHasDocumentBacklog: typeof import("../state-lane-scheduler").stateHasDocumentBacklog;
  let loadManifests: typeof import("../bayes/manifests").loadManifests;
  let readRosettaNumbers: typeof import("../agent-health").readRosettaNumbers;
  let previousUrl: string | undefined;
  let previousPool: string | undefined;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Stacked PDF tests require a loopback E2E database; production is forbidden");
    }
    previousUrl = process.env.DATABASE_URL;
    previousPool = process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_URL = connection;
    process.env.DATABASE_POOL_MAX = "1";
    vi.resetModules();
    ({ sql: db } = await import("@/lib/data-store/connection"));
    owner = await import("./read");
    ({ stateHasDocumentBacklog } = await import("../state-lane-scheduler"));
    ({ loadManifests } = await import("../bayes/manifests"));
    ({ readRosettaNumbers } = await import("../agent-health"));
  }, 30_000);
  beforeEach(async () => { await db`BEGIN`; });
  afterEach(async () => { await db`ROLLBACK`; });
  afterAll(async () => {
    if (db) await db.end();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousPool === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = previousPool;
  });

  async function seed(state = STATE) {
    const [inst] = await db`
      INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url, last_crawl_at, rescue_status)
      VALUES ('Stacked PDF Fixture', 'bank', ${state}, 'e2e', 'https://fixture.example/fees.pdf', NOW(), 'rescued') RETURNING id
    `;
    const [doc] = await db`
      INSERT INTO source_documents (institution_id, status, document_url, content_hash, content_type, document_r2_key)
      VALUES (${inst.id}, 'success', 'https://fixture.example/fees.pdf', ${sourceHash}, 'application/pdf', ${`${sourceHash.slice(0, 2)}/${sourceHash}`}) RETURNING id
    `;
    await db`
      INSERT INTO agent_source_texts (institution_id, source_document_id, status, document_type, reader, source_hash, normalized_text, text_hash, char_count)
      VALUES (${inst.id}, ${doc.id}, 'completed', 'pdf', 'read.pdf_layout', ${sourceHash}, ${text}, ${textHash}, ${text.length})
    `;
    // Enough prior raw rows to defeat Knox's thin rule; no pending verification.
    for (let i = 0; i < 6; i += 1) await db`
      INSERT INTO raw_fee_observations (institution_id, source_document_id, source, fee_name, amount, outlier_flags, agent_event_id)
      VALUES (${inst.id}, ${doc.id}, 'knox', ${`Existing fixture ${i}`}, 1, '[]'::jsonb, gen_random_uuid())
    `;
    await db`
      INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
      VALUES (${inst.id}, ${doc.id}, 'read', 'read.pdf_layout', 3, ${sourceHash}, 'ok', '{"pdf_layout":4}'::jsonb),
             (${inst.id}, ${doc.id}, 'extract', 'extract.rules', 84, ${textHash}, 'ok', '{}'::jsonb)
    `;
    return { institutionId: Number(inst.id), documentId: Number(doc.id) };
  }
  async function selected(mode: "include" | "only" | "exclude" = "only", state: string = STATE) {
    const selection = owner.rosettaReadCandidatesQuery(100, true, undefined, state, true, true, true, true, mode);
    return db.unsafe(selection.query, selection.params);
  }

  it("makes the real old Oakwood witness due without reopening ordinary settled reads", async () => {
    const fixture = await seed();
    expect((await selected()).map((row) => Number(row.source_document_id))).toEqual([fixture.documentId]);
    expect(await selected("exclude")).toHaveLength(0);
    expect(await owner.countPdfStackedRepairsDue(db)).toBe(1);
    expect(await stateHasDocumentBacklog(STATE)).toBe(true);
    expect((await readRosettaNumbers(db)).stackedPdfRepairsDue).toBe(1);
    expect(await selected("only", "VT")).toHaveLength(0);
    const manifest = (await loadManifests()).find((entry) => entry.key === "rosetta.pdf_stacked_repair")!;
    expect(await manifest.count!(db)).toMatchObject({ affected: 1, done: 0, queued: 1 });
  });

  it("settles the same source hash once across owner, state readiness and ledger", async () => {
    const fixture = await seed();
    await db`
      INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
      VALUES (${fixture.institutionId}, ${fixture.documentId}, 'read', 'read.pdf_layout', 3, ${sourceHash}, 'ok', '{"pdf_layout":5,"pdf_stacked":1}'::jsonb)
    `;
    expect(await selected()).toHaveLength(0);
    expect(await owner.countPdfStackedRepairsDue(db)).toBe(0);
    expect(await stateHasDocumentBacklog(STATE)).toBe(false);
    expect((await readRosettaNumbers(db)).stackedPdfRepairsDue).toBe(0);
    const manifest = (await loadManifests()).find((entry) => entry.key === "rosetta.pdf_stacked_repair")!;
    expect(await manifest.count!(db)).toMatchObject({ affected: 1, done: 1, queued: 0 });
  });

  it("does not settle this document from a different document's same-hash request", async () => {
    const fixture = await seed();
    const other = await seed("ZY");
    await db`
      INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
      VALUES (${fixture.institutionId}, ${other.documentId}, 'read', 'read.pdf_stacked_repair', 1, ${sourceHash}, 'evidence_mismatch', '{"pdf_stacked_requested":1}'::jsonb)
    `;
    expect((await selected()).map((row) => Number(row.source_document_id))).toEqual([fixture.documentId]);
  });

  it("keeps ordinary backlog visible when the repair's newer schema is unavailable", async () => {
    const fixture = await seed();
    await db`ALTER TABLE source_documents RENAME COLUMN duplicate_of_id TO prior_duplicate_of_id`;
    await db`UPDATE raw_fee_observations SET outlier_flags = '["needs_darwin_verification", "canonical_hint:monthly_maintenance"]'::jsonb WHERE institution_id = ${fixture.institutionId}`;
    expect(await stateHasDocumentBacklog(STATE)).toBe(true);
    expect((await readRosettaNumbers(db)).stackedPdfRepairsDue).toBeNull();
  });

  it.each(["nonvault", "superseded", "duplicate", "offline", "wrong_hash", "insufficient_witness"])("excludes %s sources from the repair", async (kind) => {
    const fixture = await seed();
    if (kind === "nonvault") await db`UPDATE source_documents SET document_r2_key = NULL WHERE id = ${fixture.documentId}`;
    if (kind === "superseded") {
      const newer = await seed();
      await db`UPDATE source_documents SET superseded_by_id = ${newer.documentId} WHERE id = ${fixture.documentId}`;
      await db`UPDATE agent_source_texts SET normalized_text = 'No witness' WHERE source_document_id = ${newer.documentId}`;
    }
    if (kind === "duplicate") await db`UPDATE source_documents SET duplicate_of_id = id WHERE id = ${fixture.documentId}`;
    if (kind === "offline") await db`INSERT INTO institution_source_profiles (institution_id, state_code, source_kind) VALUES (${fixture.institutionId}, ${STATE}, 'offline')`;
    if (kind === "wrong_hash") await db`UPDATE agent_source_texts SET source_hash = 'other-source' WHERE source_document_id = ${fixture.documentId}`;
    if (kind === "insufficient_witness") await db`UPDATE agent_source_texts SET normalized_text = 'Wire Transfer | $30.00' WHERE source_document_id = ${fixture.documentId}`;
    expect(await selected()).toHaveLength(0);
    expect(await owner.countPdfStackedRepairsDue(db)).toBe(0);
  });

  it("uses current-copy and companion-stream selection, not institution-wide newest ID", async () => {
    const fixture = await seed();
    await db`
      INSERT INTO source_documents (institution_id, status, document_url, content_hash)
      VALUES (${fixture.institutionId}, 'success', 'https://fixture.example/new-fees.pdf', 'new-hash')
    `;
    expect(await selected()).toHaveLength(0);
  });

  it("runs at most four free vault repairs and records their own detector version", async () => {
    for (let i = 0; i < 5; i += 1) await seed();
    const [run] = await db`INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta', 'state_agent') RETURNING id`;
    const fetchImpl = vi.fn().mockRejectedValue(new Error("No network is permitted in this fixture"));
    const result = await owner.runRosettaRead({ runId: Number(run.id), db, stateCode: STATE, limit: 25, fetchImpl,
      vault: { configured: true, read: async () => new Uint8Array(bytes), store: async () => ({ status: "already_stored", key: `${sourceHash.slice(0, 2)}/${sourceHash}` }), presign: async () => "unused" },
    });
    expect(result).toMatchObject({ selected: 4, completed: 4, readFromVault: 4, failed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const versions = await db`SELECT detail FROM pipeline_attempts WHERE detail ? 'pdf_stacked'`;
    expect(versions).toHaveLength(4);
    for (const row of versions) expect(row.detail).toMatchObject({ pdf_layout: 5, pdf_stacked: 1, reader_version: 3 });
    expect(await owner.countPdfStackedRepairsDue(db)).toBe(1);
  });

  it.each(["unconfigured", "missing", "wrong_hash"])("retains original text and refuses network fallback when the vault is %s", async (kind) => {
    const fixture = await seed();
    if (kind === "missing") for (let i = 0; i < 3; i += 1) await db`
      INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
      VALUES (${fixture.institutionId}, ${fixture.documentId}, 'read', 'read.document_access', 1, ${sourceHash}, 'http_5xx')
    `;
    const [run] = await db`INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta', 'state_agent') RETURNING id`;
    const fetchImpl = vi.fn().mockRejectedValue(new Error("External fetch is forbidden"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await owner.runRosettaRead({ runId: Number(run.id), db, stateCode: STATE, limit: 25, fetchImpl,
        vault: { configured: kind !== "unconfigured", read: async () => {
          if (kind === "missing") throw new Error("Stored PDF unavailable");
          return new Uint8Array([1, 2, 3]);
        }, store: async () => ({ status: "already_stored", key: `${sourceHash.slice(0, 2)}/${sourceHash}` }), presign: async () => "unused" },
      });
      expect(result).toMatchObject({ selected: 1, completed: 0, failed: 1, deferred: 0 });
      expect(fetchImpl).not.toHaveBeenCalled();
      const [artifact] = await db`SELECT normalized_text, text_hash, status FROM agent_source_texts WHERE source_document_id = ${fixture.documentId}`;
      expect(artifact).toMatchObject({ normalized_text: text, text_hash: textHash, status: "completed" });
      const [inst] = await db`SELECT fee_schedule_url FROM institution_sources WHERE id = ${fixture.institutionId}`;
      expect(inst.fee_schedule_url).toBe("https://fixture.example/fees.pdf");
      expect(await db`SELECT id FROM pipeline_attempts WHERE detail ? 'pdf_stacked'`).toHaveLength(0);
      const requests = await db`SELECT detail FROM pipeline_attempts WHERE detail ? 'pdf_stacked_requested'`;
      expect(requests).toHaveLength(1);
      expect(await owner.countPdfStackedRepairsDue(db)).toBe(0);
      const manifest = (await loadManifests()).find((entry) => entry.key === "rosetta.pdf_stacked_repair")!;
      expect(await manifest.count!(db)).toMatchObject({ affected: 1, done: 0, queued: 0, exclusions: { repair_failed_requires_review: 1 } });
    } finally { errorLog.mockRestore(); }
  });
});
