// @vitest-environment node
/** Private prospective evidence: real PostgreSQL, no production connection or providers. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReadResult } from "./read";
import type { WitnessRequest } from "./normalized-witness";
const connection = process.env.E2E_DATABASE_URL;
const migration = readFileSync(join(__dirname, "../../../../supabase/migrations/20270110000067_normalized_source_text_witnesses.sql"), "utf8");
const textA = "Fee Schedule\nWire transfer $25.00 per item unless waived";
const textB = "Fee Schedule\nWire transfer $30.00 per item unless waived";
describe.skipIf(!connection)("private exact normalized witnesses", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let reader: typeof import("./read");
  let witness: typeof import("./normalized-witness");
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
    witness = await import("./normalized-witness");
    if (!(await witness.normalizedWitnessSchemaReady(db)))
      await db.unsafe(migration);
  });
  afterAll(async () => {
    await db?.end();
    if (priorUrl === undefined)
      delete process.env.DATABASE_URL;
    else
      process.env.DATABASE_URL = priorUrl;
    if (priorPool === undefined)
      delete process.env.DATABASE_POOL_MAX;
    else
      process.env.DATABASE_POOL_MAX = priorPool;
  });
  type Db = typeof db;
  async function rolledBack(work: (scope: Db) => Promise<void>) {
    const rollback = new Error("intentional fixture rollback");
    try {
      await db.begin(async (tx) => { await work(tx as unknown as Db); throw rollback; });
    }
    catch (error) {
      if (error !== rollback)
        throw error;
    }
  }
  async function seed(scope: Db = db) {
    const [inst] = await scope `
   INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
   VALUES ('Normalized witness fixture', 'bank', 'ZW', 'e2e', 'https://fixture.example/fees.pdf') RETURNING id
  `;
    const [doc] = await scope `
   INSERT INTO source_documents (institution_id, status, document_url, content_hash)
   VALUES (${inst.id}, 'success', 'https://fixture.example/fees.pdf', 'captured-source-metadata') RETURNING id
  `;
    const [run] = await scope `INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta', 'manual_repair') RETURNING id`;
    return { institutionId: Number(inst.id), documentId: Number(doc.id), runId: Number(run.id) };
  }
  function result(fixture: Awaited<ReturnType<typeof seed>>, text: string | null, readerName = "read.pdf_layout"): ReadResult {
    return { sourceDocumentId: fixture.documentId, institutionId: fixture.institutionId, institutionName: "Normalized witness fixture",
      sourceUrl: "https://fixture.example/fees.pdf", status: "completed", documentType: "pdf", contentType: "application/pdf",
      sourceHash: "captured-source-metadata", textHash: text == null ? null : witness.exactTextHash(text), charCount: text?.length ?? 0,
      error: null, attemptOutcome: "ok", strategy: readerName, format: "pdf_text", routerReason: null, fromVault: true,
      pageCheck: null, tableRows: 0, rows: [], reader: readerName, followUps: [], handoff: null, reread: false, durationMs: 0 };
  }
  async function current(scope: Db, fixture: Awaited<ReturnType<typeof seed>>) {
    const [row] = await scope `SELECT * FROM agent_source_texts WHERE source_document_id=${fixture.documentId}`;
    return row;
  }
  function request(row: Record<string, unknown>, text: string): WitnessRequest {
    return { artifactId: Number(row.id), textHash: witness.exactTextHash(text),
      sourceDocumentId: Number(row.source_document_id), institutionId: Number(row.institution_id) };
  }
  it("archives A before same-ID B replacement, resolves exact history, and deduplicates repeated bytes", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const first = result(fixture, textA);
    await reader.recordReadResult(scope, fixture.runId, first, textA, true);
    const a = await current(scope, fixture);
    expect(first.witnessRetention).toMatchObject({ status: "active", incoming: "captured" });
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textB, "read.paid_transcribe"), textB, true);
    const b = await current(scope, fixture);
    expect(b.id).toBe(a.id);
    expect(await scope `SELECT id FROM agent_source_texts WHERE source_document_id=${fixture.documentId}`).toHaveLength(1);
    const historical = await witness.resolveNormalizedWitness(scope, request(a, textA));
    expect(historical).toMatchObject({ status: "available_history", text: textA, originalReadAt: null });
    expect(historical.status !== "unavailable" && historical.capturedAt).toBeTruthy();
    expect(await witness.resolveNormalizedWitness(scope, request(b, textB))).toMatchObject({ status: "available_current", text: textB, originalReadAt: null });
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textB), textB, true);
    expect(await scope `SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=${Number(a.id)}`).toHaveLength(2);
  }));
  it("retains the first capture metadata without inventing complete read history or original time", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    const row = await current(scope, fixture);
    const [before] = await scope `SELECT to_jsonb(w)::text AS bytes FROM agent_source_text_witnesses w WHERE artifact_id=${Number(row.id)}`;
    const again = result(fixture, textA, "read.paid_transcribe");
    again.sourceHash = "different-captured-byte-metadata";
    await reader.recordReadResult(scope, fixture.runId, again, textA, true);
    const [after] = await scope `SELECT to_jsonb(w)::text AS bytes FROM agent_source_text_witnesses w WHERE artifact_id=${Number(row.id)}`;
    expect(after.bytes).toBe(before.bytes);
    expect((await current(scope, fixture)).source_hash).toBe("different-captured-byte-metadata");
    const captured = JSON.parse(before.bytes);
    expect(captured.reader).toBe("read.pdf_layout");
    expect(new Date(captured.captured_at).getTime()).toBeGreaterThanOrEqual(new Date(captured.observed_artifact_created_at).getTime());
  }));
  it("does not substitute later B when legacy A was never retained", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const [row] = await scope `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,normalized_text,text_hash)
   VALUES (${fixture.institutionId},${fixture.documentId},'completed',${textB},${witness.exactTextHash(textB)}) RETURNING *
  `;
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA))).toMatchObject({ status: "unavailable", reason: "not_retained" });
  }));
  it("reports a corrupt incumbent honestly and never archives it under its claimed hash", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const [row] = await scope `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,normalized_text,text_hash)
   VALUES (${fixture.institutionId},${fixture.documentId},'completed','corrupt body',${witness.exactTextHash(textA)}) RETURNING *
  `;
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA))).toMatchObject({ status: "unavailable", reason: "hash_mismatch" });
    const read = result(fixture, textB);
    await reader.recordReadResult(scope, fixture.runId, read, textB, true);
    expect(read.witnessRetention).toMatchObject({ status: "active", incumbent: "unavailable_hash_mismatch", incoming: "captured" });
    expect(await scope `SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)} AND text_hash=${witness.exactTextHash(textA)}`).toHaveLength(0);
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA))).toMatchObject({ status: "unavailable", reason: "not_retained" });
  }));
  it("rolls back archive-old and replacement when archive-incoming fails", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const [row] = await scope `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,normalized_text,text_hash)
   VALUES (${fixture.institutionId},${fixture.documentId},'completed',${textA},${witness.exactTextHash(textA)}) RETURNING *
  `;
    await scope `CREATE FUNCTION pg_temp.fail_incoming_witness() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN IF NEW.capture_kind='incoming' THEN RAISE EXCEPTION 'fixture incoming archive failure'; END IF; RETURN NEW; END $fn$`;
    await scope `CREATE TRIGGER fail_incoming_witness BEFORE INSERT ON agent_source_text_witnesses FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_incoming_witness()`;
    await expect(reader.recordReadResult(scope, fixture.runId, result(fixture, textB), textB, true)).rejects.toThrow("fixture incoming archive failure");
    expect((await current(scope, fixture)).text_hash).toBe(witness.exactTextHash(textA));
    expect(await scope `SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}`).toHaveLength(0);
  }));
  it("preserves evidence on null/empty/failed and status-only writes without fabricating a completed capture", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    const row = await current(scope, fixture);
    const read = result(fixture, null);
    read.status = "failed";
    await reader.recordReadResult(scope, fixture.runId, read, null, true);
    expect(read.witnessRetention).toMatchObject({ incumbent: "already_retained", incoming: "no_text" });
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA))).toMatchObject({ status: "available_history", text: textA });
    await reader.recordReadResult(scope, fixture.runId, result(fixture, ""), "", true);
    expect(await scope `SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}`).toHaveLength(1);
  }));
  it("captures the old completed status at actual retention time before triage changes it", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const [row] = await scope `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,normalized_text,text_hash,created_at,updated_at)
   VALUES (${fixture.institutionId},${fixture.documentId},'completed',${textA},${witness.exactTextHash(textA)},'2001-01-01','2001-01-01') RETURNING *
  `;
    await witness.preserveStatusChange(scope, Number(row.id), (tx) => tx `UPDATE agent_source_texts SET status='wrong_document' WHERE id=${Number(row.id)}`);
    const [captured] = await scope `SELECT observed_artifact_status,captured_at,observed_artifact_updated_at FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}`;
    expect(captured.observed_artifact_status).toBe("completed");
    expect(new Date(captured.captured_at).getTime()).toBeGreaterThan(new Date("2026-01-01").getTime());
    expect(new Date(captured.observed_artifact_updated_at).getUTCFullYear()).toBe(2001);
  }));
  it("retains failed-result bytes with their failed status rather than claiming a completed read", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const read = result(fixture, textA);
    read.status = "failed";
    read.error = "fixture parse failure";
    await reader.recordReadResult(scope, fixture.runId, read, textA, true);
    const row = await current(scope, fixture);
    const [retained] = await scope`
      SELECT normalized_text, observed_artifact_status
        FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}
    `;
    expect(retained).toEqual({ normalized_text: textA, observed_artifact_status: "failed" });
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA)))
      .toMatchObject({ status: "available_current", text: textA, originalReadAt: null });
  }));

  async function repairFixture(scope: Db) {
    const fixture = await seed(scope);
    const bytes = readFileSync(join(__dirname, "test-fixtures/oakwood-fees.pdf"));
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const incumbentText = readFileSync(join(__dirname, "test-fixtures/oakwood-interleaved.txt"), "utf8");
    const incumbentHash = witness.exactTextHash(incumbentText);
    await scope`
      UPDATE source_documents SET content_hash=${sourceHash}, content_type='application/pdf',
        document_r2_key=${`${sourceHash.slice(0, 2)}/${sourceHash}`}
      WHERE id=${fixture.documentId}
    `;
    const [artifact] = await scope`
      INSERT INTO agent_source_texts
        (institution_id, source_document_id, status, document_type, reader, source_hash,
         normalized_text, text_hash, char_count)
      VALUES (${fixture.institutionId}, ${fixture.documentId}, 'completed', 'pdf', 'read.pdf_layout',
        ${sourceHash}, ${incumbentText}, ${incumbentHash}, ${incumbentText.length}) RETURNING *
    `;
    await scope`
      INSERT INTO pipeline_feedback
        (institution_id, source_document_id, about_stage, check_name, signal, about_strategy,
         reported_by, kind, dedupe_key, evidence)
      VALUES (${fixture.institutionId}, ${fixture.documentId}, 'read', 'rosetta.text_survival', 'wrong',
        'read.pdf_layout', 'rosetta', 'text_lost_fees', ${`witness-survival-${fixture.documentId}`},
        ${JSON.stringify({ text_id: Number(artifact.id), text_hash: incumbentHash, live: 11, lost: 4 })}::jsonb)
    `;
    return { ...fixture, artifact, incumbentText, incumbentHash, bytes, sourceHash };
  }

  async function runRepair(scope: Db, fixture: Awaited<ReturnType<typeof repairFixture>>) {
    return reader.runRosettaRead({
      db: scope, runId: fixture.runId, institutionId: fixture.institutionId, limit: 1,
      fetchImpl: async () => { throw new Error("Network forbidden"); },
      vault: {
        configured: true,
        read: async () => new Uint8Array(fixture.bytes),
        store: async () => ({ status: "already_stored", key: `${fixture.sourceHash.slice(0, 2)}/${fixture.sourceHash}` }),
        presign: async () => "unused",
      },
    });
  }

  it("commits both exact witnesses and the bound PDF repair marker in the outer settlement", async () => rolledBack(async (scope) => {
    const fixture = await repairFixture(scope);
    const outcome = await runRepair(scope, fixture);
    expect(outcome.results[0].repairSettlement).toMatchObject({ accepted: true, reason: "lossless_geometry" });
    const row = await current(scope, fixture);
    expect(row.id).toBe(fixture.artifact.id);
    expect(row.text_hash).not.toBe(fixture.incumbentHash);
    const retained = await scope`
      SELECT text_hash, normalized_text FROM agent_source_text_witnesses
      WHERE artifact_id=${Number(row.id)} ORDER BY text_hash
    `;
    expect(retained).toHaveLength(2);
    expect(retained.map((entry) => entry.text_hash).sort()).toEqual([fixture.incumbentHash, row.text_hash].sort());
    expect(retained.every((entry) => witness.exactTextHash(entry.normalized_text) === entry.text_hash)).toBe(true);
    const [attempt] = await scope`
      SELECT detail FROM pipeline_attempts
      WHERE agent_run_id=${fixture.runId} AND detail ? 'persisted_text_hash'
    `;
    expect(attempt.detail).toMatchObject({
      persisted_text_id: Number(row.id), persisted_text_hash: row.text_hash,
      witness_retention: { status: "active", incumbent: "captured", incoming: "captured" },
    });
  }), 30_000);

  it("rolls back both witness inserts and replacement when the outer PDF marker fails", async () => rolledBack(async (scope) => {
    const fixture = await repairFixture(scope);
    await scope`CREATE FUNCTION pg_temp.fail_witness_repair_marker() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN IF NEW.detail ? 'persisted_text_hash' THEN RAISE EXCEPTION 'fixture bound marker failure'; END IF; RETURN NEW; END $fn$`;
    await scope`CREATE TRIGGER fail_witness_repair_marker BEFORE INSERT ON pipeline_attempts
      FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_witness_repair_marker()`;
    await expect(runRepair(scope, fixture)).rejects.toThrow("fixture bound marker failure");
    const row = await current(scope, fixture);
    expect(row.text_hash).toBe(fixture.incumbentHash);
    expect(row.normalized_text).toBe(fixture.incumbentText);
    expect(await scope`SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}`).toHaveLength(0);
    expect(await scope`SELECT id FROM pipeline_attempts WHERE agent_run_id=${fixture.runId} AND detail ? 'persisted_text_hash'`).toHaveLength(0);
  }), 30_000);

  it("commits the ordinary writer during a competing PDF source-lock wait and rejects the stale repair", async () => {
    const fixture = await repairFixture(db);
    let releaseWriter!: () => void;
    let sourceLocked!: () => void;
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const locked = new Promise<void>((resolve) => { sourceLocked = resolve; });
    const writer = db.begin(async (transaction) => {
      const scope = transaction as unknown as Db;
      await scope`SELECT id FROM source_documents WHERE id=${fixture.documentId} FOR SHARE`;
      sourceLocked();
      await release;
      const ordinary = result(fixture, textB);
      ordinary.sourceHash = fixture.sourceHash;
      await reader.recordReadResult(scope, fixture.runId, ordinary, textB, true);
    });
    await locked;
    let repairPid = 0;
    const repair = db.begin(async (transaction) => {
      const scope = transaction as unknown as Db;
      const [backend] = await scope`SELECT pg_backend_pid() AS pid`;
      repairPid = Number(backend.pid);
      return runRepair(scope, fixture);
    });
    let observedSourceWait = false;
    let outcomes!: Awaited<ReturnType<typeof Promise.allSettled<[typeof writer, typeof repair]>>>;
    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [activity] = await db`
          SELECT wait_event_type, query FROM pg_stat_activity WHERE pid=${repairPid}
        `;
        if (activity?.wait_event_type === "Lock" && activity.query.includes("FOR UPDATE")) {
          observedSourceWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      releaseWriter();
      outcomes = await Promise.allSettled([writer, repair]);
      // Older PDF suites inspect all repair attempts. Remove only this committed
      // fixture's mutable ledger records; keep its immutable witness evidence.
      await db`DELETE FROM pipeline_attempts WHERE source_document_id=${fixture.documentId}`;
      await db`DELETE FROM pipeline_feedback WHERE source_document_id=${fixture.documentId}`;
    }
    expect(observedSourceWait).toBe(true);
    const [writerOutcome, repairOutcome] = outcomes;
    if (writerOutcome.status === "rejected") throw writerOutcome.reason;
    if (repairOutcome.status === "rejected") throw repairOutcome.reason;
    const outcome = repairOutcome.value;
    expect(outcome.results[0].repairSettlement).toMatchObject({ accepted: false, reason: "selected_incumbent_changed" });
    const row = await current(db, fixture);
    expect(row.text_hash).toBe(witness.exactTextHash(textB));
    expect(await db`SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}`).toHaveLength(2);
  }, 30_000);
  it("refuses the wrong document/institution and invalid requests even when bytes match", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    const row = await current(scope, fixture);
    expect(await witness.resolveNormalizedWitness(scope, { ...request(row, textA), institutionId: fixture.institutionId + 1 })).toMatchObject({ status: "unavailable", reason: "owner_mismatch" });
    expect(await witness.resolveNormalizedWitness(scope, { ...request(row, textA), sourceDocumentId: fixture.documentId + 1 })).toMatchObject({ status: "unavailable", reason: "owner_mismatch" });
    expect(await witness.resolveNormalizedWitness(scope, { ...request(row, textA), textHash: "not-a-digest" })).toMatchObject({ status: "unavailable", reason: "invalid_request" });
    const wrong = result(fixture, textB);
    wrong.institutionId++;
    await expect(reader.recordReadResult(scope, fixture.runId, wrong, textB, true)).rejects.toThrow("document owner");
  }));
  it("refuses a conflicting retained owner before replacement", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const [row] = await scope `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,normalized_text,text_hash)
   VALUES (${fixture.institutionId},${fixture.documentId},'completed',${textA},${witness.exactTextHash(textA)}) RETURNING *
  `;
    await scope `INSERT INTO agent_source_text_witnesses(artifact_id,text_hash,source_document_id,institution_id,normalized_text,observed_artifact_status,capture_kind)
   VALUES (${Number(row.id)},${witness.exactTextHash(textA)},${fixture.documentId},${fixture.institutionId + 1},${textA},'completed','incumbent')`;
    await expect(reader.recordReadResult(scope, fixture.runId, result(fixture, textB), textB, true)).rejects.toThrow("conflicts with the exact artifact owner");
    expect((await current(scope, fixture)).text_hash).toBe(witness.exactTextHash(textA));
  }));
  it("keeps retained bytes when the mutable current artifact and source are removed", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    const row = await current(scope, fixture);
    await scope `DELETE FROM agent_source_texts WHERE id=${Number(row.id)}`;
    await scope `DELETE FROM source_documents WHERE id=${fixture.documentId}`;
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA))).toMatchObject({ status: "available_history", text: textA, originalReadAt: null });
    const foreignKeys = await scope `SELECT conname FROM pg_constraint WHERE conrelid='agent_source_text_witnesses'::regclass AND contype='f'`;
    expect(foreignKeys).toHaveLength(0);
  }));
  it("rejects a completed incoming hash mismatch before overwriting the current row", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    const invalid = result(fixture, textB);
    invalid.textHash = witness.exactTextHash(textA);
    await expect(reader.recordReadResult(scope, fixture.runId, invalid, textB, true)).rejects.toThrow("does not match its stated hash");
    expect((await current(scope, fixture)).text_hash).toBe(witness.exactTextHash(textA));
  }));
  it("continues current-only operation with an explicit missing-history capability diagnostic", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await scope `ALTER TABLE agent_source_text_witnesses RENAME TO hidden_witness_fixture`;
    const read = result(fixture, textA);
    await reader.recordReadResult(scope, fixture.runId, read, textA, true);
    expect(read.witnessRetention).toEqual({ status: "unavailable_schema" });
    const row = await current(scope, fixture);
    expect(await witness.resolveNormalizedWitness(scope, request(row, textA))).toMatchObject({ status: "available_current", originalReadAt: null });
    expect(await witness.resolveNormalizedWitness(scope, request(row, textB))).toMatchObject({ status: "unavailable", reason: "history_schema_unavailable" });
  }));
  it("enforces hash checks and immutable normal DML even for the table owner", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, result(fixture, textA), textA, true);
    for (const command of ["UPDATE agent_source_text_witnesses SET source_url='changed'", "DELETE FROM agent_source_text_witnesses", "TRUNCATE agent_source_text_witnesses"]) {
      await expect((scope as unknown as {
        savepoint: (work: (tx: Db) => Promise<unknown>) => Promise<unknown>;
      }).savepoint((tx) => tx.unsafe(command))).rejects.toThrow("append-only");
    }
    await expect((scope as unknown as {
      savepoint: (work: (tx: Db) => Promise<unknown>) => Promise<unknown>;
    }).savepoint((tx) => tx `
   INSERT INTO agent_source_text_witnesses(artifact_id,text_hash,source_document_id,institution_id,normalized_text,observed_artifact_status,capture_kind)
   VALUES (999,${witness.exactTextHash(textA)},1,1,'changed','completed','incoming')`)).rejects.toThrow("normalized_witness_hash");
  }));
  it.each(["anon", "authenticated"])("gives %s no read or append path", async (role) => rolledBack(async (scope) => {
    await expect((scope as unknown as {
      savepoint: (work: (tx: Db) => Promise<unknown>) => Promise<unknown>;
    }).savepoint(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx `SELECT * FROM agent_source_text_witnesses`;
    })).rejects.toThrow("permission denied");
    const [privileges] = await scope `SELECT has_table_privilege(${role},'agent_source_text_witnesses','INSERT') AS append`;
    expect(privileges.append).toBe(false);
  }));
  it("allows backend append/select but no update/delete/truncate privilege", async () => rolledBack(async (scope) => {
    const [rights] = await scope `SELECT has_table_privilege('service_role','agent_source_text_witnesses','SELECT') AS read,
   has_table_privilege('service_role','agent_source_text_witnesses','INSERT') AS append,
   has_table_privilege('service_role','agent_source_text_witnesses','UPDATE') AS mutate,
   has_table_privilege('service_role','agent_source_text_witnesses','DELETE') AS remove,
   has_table_privilege('service_role','agent_source_text_witnesses','TRUNCATE') AS clear`;
    expect(rights).toEqual({ read: true, append: true, mutate: false, remove: false, clear: false });
    await (scope as unknown as {
      savepoint: (work: (tx: Db) => Promise<unknown>) => Promise<unknown>;
    }).savepoint(async (tx) => {
      await tx `SET LOCAL ROLE service_role`;
      await tx `INSERT INTO agent_source_text_witnesses(artifact_id,text_hash,source_document_id,institution_id,normalized_text,observed_artifact_status,capture_kind)
    VALUES(999999,${witness.exactTextHash(textA)},1,1,${textA},'completed','incoming')`;
      expect(await tx `SELECT artifact_id FROM agent_source_text_witnesses WHERE artifact_id=999999`).toHaveLength(1);
    });
  }));
  it.each(["first_insert", "replacement"])("rolls back a root-client %s when archival fails", async (kind) => {
    const fixture = await seed();
    if (kind === "replacement")
      await db `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,normalized_text,text_hash)
   VALUES (${fixture.institutionId},${fixture.documentId},'completed',${textA},${witness.exactTextHash(textA)})
  `;
    await db.begin(async (transaction) => {
      const tx = transaction as unknown as Db;
      await tx `CREATE OR REPLACE FUNCTION pg_temp.fail_root_witness() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN IF NEW.capture_kind='incoming' THEN RAISE EXCEPTION 'fixture root archive failure'; END IF; RETURN NEW; END $fn$`;
      await tx `CREATE TRIGGER fail_root_witness BEFORE INSERT ON agent_source_text_witnesses FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_root_witness()`;
    });
    try {
      await expect(reader.recordReadResult(db, fixture.runId, result(fixture, textB), textB, true)).rejects.toThrow("fixture root archive failure");
      const row = await current(db, fixture);
      if (kind === "first_insert")
        expect(row).toBeUndefined();
      else
        expect(row.text_hash).toBe(witness.exactTextHash(textA));
      expect(await db `SELECT artifact_id FROM agent_source_text_witnesses WHERE source_document_id=${fixture.documentId}`).toHaveLength(0);
    }
    finally {
      await db `DROP TRIGGER fail_root_witness ON agent_source_text_witnesses`;
    }
  });
  it("captures an accepted paid-reader result through the shared writer without a provider call", async () => {
    const fixture = await seed();
    const bytes = readFileSync(join(__dirname, "test-fixtures/oakwood-fees.pdf"));
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    // The actual vault bytes are bound; only the model response is stubbed.
    await db `UPDATE source_documents SET content_hash=${sourceHash},document_r2_key=${`${sourceHash.slice(0, 2)}/${sourceHash}`},content_type='application/pdf' WHERE id=${fixture.documentId}`;
    const [original] = await db `
   INSERT INTO agent_source_texts (institution_id,source_document_id,status,document_type,source_hash,normalized_text,text_hash)
   VALUES (${fixture.institutionId},${fixture.documentId},'needs_ocr','pdf',${sourceHash},${textA},${witness.exactTextHash(textA)}) RETURNING *
  `;
    await db `INSERT INTO pipeline_attempts(institution_id,source_document_id,stage,strategy,strategy_version,input_fingerprint,outcome)
   VALUES(${fixture.institutionId},${fixture.documentId},'read','read.pdf_layout',3,${sourceHash},'scanned_pdf')`;
    const paidCall = vi.fn(async () => ({ message: { content: [{ type: "text", text: textB }], stop_reason: "end_turn" }, costMicrousd: 0 }));
    vi.doMock("@/lib/agents/paid-pass", async () => ({ ...await vi.importActual("@/lib/agents/paid-pass"), paidModelCall: paidCall }));
    try {
      const paid = await import("./paid-read");
      const outcome = await paid.runRosettaPaidRead({ db, runId: fixture.runId, stateCode: "ZW", limit: 1, pageCounter: async () => 1,
        fetchImpl: async () => { throw new Error("Network forbidden"); },
        vault: { configured: true, read: async () => new Uint8Array(bytes), store: async () => ({ status: "already_stored", key: "unused" }), presign: async () => "unused" } });
      expect(paidCall).toHaveBeenCalledTimes(1);
      expect(outcome.succeeded).toBe(1);
      expect(outcome.results[0].witness_retention).toMatchObject({ status: "active", incoming: "captured" });
      expect(await witness.resolveNormalizedWitness(db, request(original, textA))).toMatchObject({ status: "available_history", text: textA });
      expect((await current(db, fixture)).reader).toBe("read.paid_transcribe");
    }
    finally {
      vi.doUnmock("@/lib/agents/paid-pass");
    }
  });
  it.each(["first_insert", "reread"])("serializes a real competing %s without losing the intermediate witness", async (kind) => {
    // These committed fixtures remain in this disposable database for review; the
    // evidence guard is never disabled merely to clean up test rows.
    const fixture = await seed();
    if (kind === "reread")
      await reader.recordReadResult(db, fixture.runId, result(fixture, "earliest"), "earliest", true);
    let release!: () => void;
    let ready!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const first = db.begin(async (tx) => {
      await reader.recordReadResult(tx as unknown as Db, fixture.runId, result(fixture, textA), textA, true);
      ready();
      await hold;
    });
    await started;
    let secondFinished = false;
    const second = reader.recordReadResult(db, fixture.runId, result(fixture, textB), textB, true).then(() => { secondFinished = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(secondFinished).toBe(false);
    }
    finally {
      release();
    }
    await first;
    await second;
    const row = await current(db, fixture);
    expect(row.text_hash).toBe(witness.exactTextHash(textB));
    expect(await db `SELECT id FROM agent_source_texts WHERE source_document_id=${fixture.documentId}`).toHaveLength(1);
    const saved = await db `SELECT text_hash FROM agent_source_text_witnesses WHERE artifact_id=${Number(row.id)}`;
    expect(saved.map(x => x.text_hash).sort()).toEqual([textA, textB, ...(kind === "reread" ? ["earliest"] : [])].map(witness.exactTextHash).sort());
  });
});
