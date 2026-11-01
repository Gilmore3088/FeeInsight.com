// @vitest-environment node
/**
 * The error loop's re-runs past extract (#2058) in real PostgreSQL, loopback only, against the
 * production schema: a read fix reopens its documents for Rosetta's read step, a verify fix's named
 * fees join Darwin's verified recheck and are judged by its verdict, and a publish fix waits for a
 * direct run's publish step.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { DOCUMENT_ACCESS_STRATEGY, ERROR_FIX_UNCOUNTED_READ_STRATEGIES, REOPEN_STRATEGY, SETTLED_READ_OUTCOMES, reopenErrorFixDocuments, rosettaReadCandidatesQuery } from "@/lib/agents/rosetta/read";
import { ROSETTA_READ_VERSION } from "@/lib/agents/rosetta/reader-versions";
import { DARWIN_RECHECK_STRATEGY, recheckVerifiedFees } from "@/lib/agents/darwin/verified-recheck";
import { errorFixRereadDocuments, errorFixVerifyTargets } from "./error-fix-targets";
import { errorFixRequests, runErrorFixRecheck, type ErrorFixEntry } from "./error-fixes";

const connection = process.env.E2E_DATABASE_URL;
const READ = 20581001, VERIFY = 20581002, PUBLISH = 20581003, COHORT = 20581004, CHAIN = 20581005;
const BANKS = [READ, VERIFY, PUBLISH, COHORT, CHAIN];
// The chain bank's copies: A was replaced by B, B by C (current).
const CHAIN_A = 20581201, CHAIN_B = 20581202, CHAIN_C = 20581203;
const REOPEN_ARGS = { limit: 10, auxiliaryStrategies: ERROR_FIX_UNCOUNTED_READ_STRATEGIES, settledOutcomes: SETTLED_READ_OUTCOMES, reopenStrategy: REOPEN_STRATEGY };
const EVENT = "00000000-0000-4000-8000-000020581001";
const TEXT = "OTHER SERVICES\nStop Payment Fee | $35.00\nOverdraft Fee | $30.00 per item\nWire Transfer | $25.00";
const READ_FIX: ErrorFixEntry = { pr: 92101, issue: 2058, stage: "read", merged_on: "2026-10-20", checks: ["hamilton.source_check"] };
const VERIFY_FIX: ErrorFixEntry = { pr: 92102, issue: 2058, stage: "verify", merged_on: "2026-10-20", checks: ["darwin.verified_recheck"] };
const PUBLISH_FIX: ErrorFixEntry = { pr: 92103, issue: 2058, stage: "publish", merged_on: "2026-10-20", checks: ["hamilton.source_check"] };
/** Injects a real SQL error at one query, preserving native savepoint semantics (as verified-recheck.db.test.ts does). */
function failSelectedSql(tx: unknown, needle: string): unknown {
  const target = tx as ((...args: unknown[]) => unknown) & { unsafe: (query: string) => unknown; savepoint: (work: (inner: unknown) => Promise<unknown>) => Promise<unknown> };
  return new Proxy(target, {
    apply(fn, thisArg, args) {
      if (Array.isArray(args[0]) && (args[0] as string[]).join(" ").includes(needle)) return fn.unsafe("SELECT 1/0");
      return Reflect.apply(fn, thisArg, args);
    },
    get(fn, key) {
      if (key === "savepoint") return (work: (inner: unknown) => Promise<unknown>) => fn.savepoint((inner) => work(failSelectedSql(inner, needle)));
      const value = Reflect.get(fn, key);
      return typeof value === "function" ? value.bind(fn) : value;
    },
  });
}
type Db = Parameters<typeof runErrorFixRecheck>[0] extends infer O ? O extends { db?: infer D } ? D : never : never;

describe.skipIf(!connection)("error loop re-runs for read, verify and publish fixes (#2058)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let db: Db;
  let nextRaw = 20581300;
  const fees: Record<string, number> = {};
  const verifiedOf: Record<string, number> = {};

  const doc = (bank: number) => bank + 100;
  const hash = (bank: number) => `hash-2058-${bank}`;

  async function seedFee(bank: number, name: string, key: string, amount: number) {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${bank}, ${doc(bank)}, ${EVENT}, ${name}, ${amount}, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${bank}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${bank}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'agentic-run-2058', ${`https://bank${bank}.test/fees`}) RETURNING fee_published_id`;
    fees[`${bank}:${key}`] = Number(published.fee_published_id);
    verifiedOf[`${bank}:${key}`] = Number(verified.fee_verified_id);
  }

  async function seedBank(bank: number) {
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${bank}, ${`Loop Stage Bank ${bank}`}, 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${doc(bank)}, ${bank}, 'success', ${`https://bank${bank}.test/fees.pdf`}, ${hash(bank)}, '2026-10-01T00:00:00Z')`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text, text_hash, source_hash, reader, document_type, updated_at)
              VALUES (${doc(bank)}, ${bank}, 'completed', ${TEXT}, ${`text-${hash(bank)}`}, ${hash(bank)}, 'read.pdf_layout', 'pdf', '2026-10-02T00:00:00Z')`;
    // Read by the current reader before the error: settled, so nothing reads it again on its own.
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, created_at)
              VALUES (${bank}, ${doc(bank)}, 'read', 'read.pdf_layout', ${ROSETTA_READ_VERSION}, ${hash(bank)}, 'ok', '2026-10-02T00:00:00Z')`;
    // Three live fee types, so the institution is deep enough for the catalog.
    await seedFee(bank, "Stop Payment Fee", "stop_payment", 35);
    await seedFee(bank, "Overdraft Fee", "overdraft", 30);
    await seedFee(bank, "Wire Transfer", "wire_domestic_outgoing", 25);
  }

  async function named(stage: string, bank: number, key: string, check: string, documentId: number | null = null): Promise<number> {
    const dedupe = `test2058stages:${stage}:${bank}:${key}`;
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, institution_id, fee_published_id, source_document_id, canonical_fee_key, check_name, dedupe_key, created_at)
              VALUES (${stage}, 'wrong', 'test_2058_stage_error', 'deming', ${bank}, ${fees[`${bank}:${key}`]}, ${documentId}, ${key}, ${check}, ${dedupe}, '2026-10-10T00:00:00Z')`;
    const [row] = await raw`SELECT id FROM pipeline_feedback WHERE dedupe_key = ${dedupe}`;
    return Number(row.id);
  }

  async function completedRun(params: Record<string, unknown> = {}): Promise<number> {
    const [run] = await raw`INSERT INTO agent_runs (agent_name, run_kind, title, status, params_json)
              VALUES ('atlas', 'manual_repair', 'Loop stage re-run', 'completed', ${raw.json(params as never)}) RETURNING id`;
    return Number(run.id);
  }

  async function clean() {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM pipeline_attempts WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ANY(${BANKS})`;
    await raw`DELETE FROM institution_sources WHERE id = ANY(${BANKS})`;
    await raw`DELETE FROM agent_run_steps WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE title = 'Loop stage re-run')`;
    await raw`DELETE FROM agent_runs WHERE title = 'Loop stage re-run'`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Error-loop DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    db = raw as unknown as Db;
    await clean();
    for (const bank of [READ, VERIFY, PUBLISH]) await seedBank(bank);
  });

  afterAll(async () => {
    if (raw) {
      await clean();
      await raw.end();
    }
  });

  it("read fix: reopens the named document once, Rosetta's selection reads it again, and the error is judged after that read", async () => {
    const id = await named("read", READ, "stop_payment", "hamilton.source_check", doc(READ));
    const selected = async () => {
      const { query, params } = rosettaReadCandidatesQuery(10, true, READ, undefined, false, false, true, false);
      return (await raw.unsafe(query, params as never[])).map((row) => Number(row.source_document_id));
    };
    // Settled bytes: no read selects them on its own.
    expect(await selected()).toEqual([]);
    const reopen = await errorFixRereadDocuments(db, { ...REOPEN_ARGS, entries: [READ_FIX] });
    expect(reopen.map((row) => [row.pr, Number(row.source_document_id), row.content_hash, row.feedback_ids.map(Number)])).toEqual([[READ_FIX.pr, doc(READ), hash(READ), [id]]]);
    // Atlas asks for the bank, with no Knox version to reach.
    const requests = await errorFixRequests(db, [READ_FIX]);
    expect(requests).toEqual([expect.objectContaining({ institutionId: READ, requestedAt: "2026-10-20" })]);
    expect(requests[0]).not.toHaveProperty("minExtractVersion");

    // The read step's reopen: one visible attempt naming the fix, then the document is a candidate.
    const run = await completedRun({ institution_id: READ });
    expect(await reopenErrorFixDocuments(db as never, { runId: run, stepId: null, institutionId: READ, entries: [READ_FIX] })).toBe(1);
    const [marker] = await raw`SELECT outcome, input_fingerprint, detail->>'error_fix_pr' AS pr FROM pipeline_attempts
                                 WHERE institution_id = ${READ} AND strategy = ${REOPEN_STRATEGY}`;
    expect(marker).toMatchObject({ outcome: "ok", input_fingerprint: hash(READ), pr: String(READ_FIX.pr) });
    expect(await selected()).toEqual([doc(READ)]);
    // Once per fix and bytes.
    expect(await reopenErrorFixDocuments(db as never, { runId: run, stepId: null, institutionId: READ, entries: [READ_FIX] })).toBe(0);
    // Not yet read: waiting.
    expect((await runErrorFixRecheck({ db, entries: [READ_FIX] })).results[0]).toMatchObject({ named: 1, waiting: 1 });
    // A failed attempt to obtain the bytes (http_403), or a read that failed, read nothing: still waiting.
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id)
              VALUES (${READ}, ${doc(READ)}, 'read', ${DOCUMENT_ACCESS_STRATEGY}, 1, ${hash(READ)}, 'http_403', ${run}),
                     (${READ}, ${doc(READ)}, 'read', 'read.pdf_layout', ${ROSETTA_READ_VERSION}, ${hash(READ)}, 'parse_error', ${run})`;
    expect((await runErrorFixRecheck({ db, entries: [READ_FIX] })).results[0]).toMatchObject({ named: 1, waiting: 1 });
    expect((await errorFixRequests(db, [READ_FIX])).map((request) => request.institutionId)).toEqual([READ]);

    // The re-read under the fixed reader, in a completed run: the request ends and the fee is judged.
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id)
              VALUES (${READ}, ${doc(READ)}, 'read', 'read.pdf_layout', ${ROSETTA_READ_VERSION}, ${hash(READ)}, 'ok', ${run})`;
    expect(await selected()).toEqual([]);
    expect(await errorFixRequests(db, [READ_FIX])).toEqual([]);
    expect(await errorFixRereadDocuments(db, { ...REOPEN_ARGS, entries: [READ_FIX] })).toEqual([]);
    const result = await runErrorFixRecheck({ db, entries: [READ_FIX] });
    expect(result.results[0]).toMatchObject({ named: 1, waiting: 0, nowMatches: 1 });
  });

  it("verify fix: the named live fees are Darwin's targets until a recheck reads them, then judged by its verdict", async () => {
    const right = await named("verify", VERIFY, "wire_domestic_outgoing", "darwin.verified_recheck");
    const wrong = await named("verify", VERIFY, "overdraft", "darwin.verified_recheck");
    const targets = await errorFixVerifyTargets(db, { limit: 10, recheckStrategy: DARWIN_RECHECK_STRATEGY.strategy, entries: [VERIFY_FIX] });
    expect(targets.map((target) => Number(target.fee_verified_id)).sort()).toEqual([verifiedOf[`${VERIFY}:wire_domestic_outgoing`], verifiedOf[`${VERIFY}:overdraft`]].sort());
    // Live named fees are re-read by Darwin's recheck, not by a direct run.
    expect(await errorFixRequests(db, [VERIFY_FIX])).toEqual([]);
    expect((await runErrorFixRecheck({ db, entries: [VERIFY_FIX] })).results[0]).toMatchObject({ named: 2, waiting: 2 });

    const run = await completedRun();
    // A recheck before the merge day does not carry the fix.
    await raw`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id, created_at)
              VALUES (${VERIFY}, 'verify', ${DARWIN_RECHECK_STRATEGY.strategy}, ${DARWIN_RECHECK_STRATEGY.version}, ${`verified:${verifiedOf[`${VERIFY}:wire_domestic_outgoing`]}`}, 'ok', ${run}, '2026-10-12T00:00:00Z')`;
    expect((await runErrorFixRecheck({ db, entries: [VERIFY_FIX] })).results[0]).toMatchObject({ waiting: 2 });
    await raw`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id, detail)
              VALUES (${VERIFY}, 'verify', ${DARWIN_RECHECK_STRATEGY.strategy}, ${DARWIN_RECHECK_STRATEGY.version}, ${`verified:${verifiedOf[`${VERIFY}:wire_domestic_outgoing`]}`}, 'ok', ${run}, '{"code":null}'::jsonb),
                     (${VERIFY}, 'verify', ${DARWIN_RECHECK_STRATEGY.strategy}, ${DARWIN_RECHECK_STRATEGY.version}, ${`verified:${verifiedOf[`${VERIFY}:overdraft`]}`}, 'evidence_mismatch', ${run}, '{"code":"conditional_zero"}'::jsonb)`;
    expect(await errorFixVerifyTargets(db, { limit: 10, recheckStrategy: DARWIN_RECHECK_STRATEGY.strategy, entries: [VERIFY_FIX] })).toEqual([]);
    const result = await runErrorFixRecheck({ db, entries: [VERIFY_FIX] });
    expect(result.results[0]).toMatchObject({ named: 2, waiting: 0, nowMatches: 1, stillWrong: 1 });
    expect(result.results[0].stillWrongRows).toEqual([expect.objectContaining({ feedbackId: wrong, check: "darwin.verified_recheck", reason: "conditional_zero" })]);
    const [closed] = await raw`SELECT kind FROM pipeline_feedback WHERE dedupe_key = ${`deming.error_fix:${VERIFY_FIX.pr}:${right}:closed`}`;
    expect(closed).toMatchObject({ kind: "error_fix_closed" });
  });

  it("verify fix: Darwin's verified recheck reads a named fee its once-per-version rule would skip, and records the fix", async () => {
    const stop = new Error("rollback cohort fixture");
    await raw.begin(async (native) => {
      // postgres.js omits the tag call signature from TransactionSql (as verified-recheck.db.test.ts does).
      const tx = native as unknown as typeof raw;
      await tx`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code, status) VALUES (${COHORT}, 'Loop Cohort Bank', 'bank', 'fdic', 'TX', 'active')`;
      await tx`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at) VALUES (${doc(COHORT)}, ${COHORT}, 'success', 'https://cohort2058.test/fees.pdf', ${hash(COHORT)}, '2026-10-01T00:00:00Z')`;
      await tx`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text, text_hash, source_hash, reader, document_type)
               VALUES (${doc(COHORT)}, ${COHORT}, 'completed', ${TEXT}, ${`text-${hash(COHORT)}`}, ${hash(COHORT)}, 'read.pdf_layout', 'pdf')`;
      const [rawRow] = await tx`INSERT INTO raw_fee_observations (institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, extraction_note)
               VALUES (${COHORT}, ${doc(COHORT)}, ${EVENT}, 'Wire Transfer', 25, 'per_item', 'knox', 'excerpt="Wire Transfer | $25.00"') RETURNING fee_raw_id`;
      const [verified] = await tx`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
               VALUES (${rawRow.fee_raw_id}, ${COHORT}, 'wire_domestic_outgoing', ${EVENT}, 'Wire Transfer', 25, 'per_item', 'verified') RETURNING fee_verified_id`;
      const [published] = await tx`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
               VALUES (${verified.fee_verified_id}, ${COHORT}, 'wire_domestic_outgoing', ${EVENT}, 'Wire Transfer', 25, 'per_item', 'agentic-run-2058', 'https://cohort2058.test/fees.pdf') RETURNING fee_published_id`;
      const [run] = await tx`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Loop stage re-run', 'running') RETURNING id`;
      const [step] = await tx`INSERT INTO agent_run_steps (agent_run_id, step_key, agent_name, title, status) VALUES (${run.id}, 'classify', 'darwin', 'Cohort fixture', 'running') RETURNING id`;
      // Read by this recheck version before the fix merged: the recheck's own selection skips it.
      await tx`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id, created_at)
               VALUES (${COHORT}, ${doc(COHORT)}, 'verify', ${DARWIN_RECHECK_STRATEGY.strategy}, ${DARWIN_RECHECK_STRATEGY.version}, ${`verified:${verified.fee_verified_id}`}, 'ok', ${run.id}, '2026-10-12T00:00:00Z')`;
      await tx`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, institution_id, fee_published_id, canonical_fee_key, check_name, dedupe_key, created_at)
               VALUES ('verify', 'wrong', 'test_2058_stage_error', 'deming', ${COHORT}, ${published.fee_published_id}, 'wire_domestic_outgoing', 'darwin.verified_recheck', 'test2058stages:cohort', '2026-10-10T00:00:00Z')`;
      const entry: ErrorFixEntry = { ...VERIFY_FIX, pr: 92104 };
      const result = await recheckVerifiedFees(tx as never, {
        runId: Number(run.id), stepId: Number(step.id), olderLive: false, secondLooks: false, secondLookCodes: [], errorFixes: [entry],
      });
      expect(result.errorFixRead).toBe(1);
      const [attempt] = await tx`SELECT outcome, detail->>'error_fix_pr' AS pr FROM pipeline_attempts
                                  WHERE input_fingerprint = ${`verified:${verified.fee_verified_id}`} AND strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
                                    AND created_at >= '2026-10-20' ORDER BY id DESC LIMIT 1`;
      expect(attempt).toMatchObject({ pr: String(entry.pr) });
      // Read once since the merge: not a target again.
      expect(await errorFixVerifyTargets(tx as never, { limit: 10, recheckStrategy: DARWIN_RECHECK_STRATEGY.strategy, entries: [entry] })).toEqual([]);
      throw stop;
    }).catch((error) => { if (error !== stop) throw error; });
  });

  it("read fix on a replaced document: reopens the end of the supersession chain and waits for a read of that copy", async () => {
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${CHAIN}, 'Loop Chain Bank', 'bank', 'fdic', 'TX')`;
    for (const [id, next, crawled] of [[CHAIN_C, null, "2026-10-03"], [CHAIN_B, CHAIN_C, "2026-10-02"], [CHAIN_A, CHAIN_B, "2026-10-01"]] as const) {
      await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at, superseded_by_id)
                VALUES (${id}, ${CHAIN}, 'success', 'https://chain2058.test/fees.pdf', ${`hash-chain-${id}`}, ${crawled}, ${next})`;
    }
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text, text_hash, source_hash, reader, document_type)
              VALUES (${CHAIN_C}, ${CHAIN}, 'completed', ${TEXT}, 'text-chain', ${`hash-chain-${CHAIN_C}`}, 'read.pdf_layout', 'pdf')`;
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${CHAIN}, ${CHAIN_A}, ${EVENT}, 'Stop Payment Fee', 99, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${CHAIN}, 'stop_payment', ${EVENT}, 'Stop Payment Fee', 99, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url, rolled_back_at)
              VALUES (${verified.fee_verified_id}, ${CHAIN}, 'stop_payment', ${EVENT}, 'Stop Payment Fee', 99, 'per_item', 'agentic-run-2058', 'https://chain2058.test/fees.pdf', NOW()) RETURNING fee_published_id`;
    fees[`${CHAIN}:stop_payment`] = Number(published.fee_published_id);
    await named("read", CHAIN, "stop_payment", "hamilton.source_check", CHAIN_A);
    const run = await completedRun({ institution_id: CHAIN });
    // A failed access of the current copy since the merge day is no read: it is still reopened.
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id)
              VALUES (${CHAIN}, ${CHAIN_C}, 'read', ${DOCUMENT_ACCESS_STRATEGY}, 1, ${`hash-chain-${CHAIN_C}`}, 'http_403', ${run})`;
    const reopen = await errorFixRereadDocuments(db, { ...REOPEN_ARGS, entries: [READ_FIX] });
    expect(reopen.filter((row) => Number(row.institution_id) === CHAIN).map((row) => Number(row.source_document_id))).toEqual([CHAIN_C]);
    // A settled read of the middle copy B is not the re-read: the error's current copy is C.
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id)
              VALUES (${CHAIN}, ${CHAIN_B}, 'read', 'read.pdf_layout', ${ROSETTA_READ_VERSION}, ${`hash-chain-${CHAIN_B}`}, 'ok', ${run})`;
    const pending = async () => (await runErrorFixRecheck({ db, entries: [READ_FIX] })).results[0];
    const chainRequests = async () => (await errorFixRequests(db, [READ_FIX])).filter((request) => request.institutionId === CHAIN);
    expect(await chainRequests()).toHaveLength(1);
    expect(await pending()).toMatchObject({ named: 1, waiting: 1 });
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, agent_run_id)
              VALUES (${CHAIN}, ${CHAIN_C}, 'read', 'read.pdf_layout', ${ROSETTA_READ_VERSION}, ${`hash-chain-${CHAIN_C}`}, 'ok', ${run})`;
    expect(await chainRequests()).toEqual([]);
    // Re-read, but no right fee published in the taken-down fee's place yet: open, not waiting.
    expect(await pending()).toMatchObject({ named: 1, waiting: 0, notReproduced: 1 });
  });

  it("verify fix whose named fee is already down: asks Atlas for the bank and counts its direct run's classify step", async () => {
    const DOWN_FIX: ErrorFixEntry = { pr: 92105, issue: 2058, stage: "verify", merged_on: "2026-10-20", checks: ["hamilton.source_check"] };
    await raw`UPDATE published_fee_records SET rolled_back_at = NOW() WHERE fee_published_id = ${fees[`${VERIFY}:stop_payment`]}`;
    await named("verify", VERIFY, "stop_payment", "hamilton.source_check");
    // Down, so Darwin's recheck has nothing live to read: not a target, and Atlas is asked instead.
    expect(await errorFixVerifyTargets(db, { limit: 10, recheckStrategy: DARWIN_RECHECK_STRATEGY.strategy, entries: [DOWN_FIX] })).toEqual([]);
    expect((await errorFixRequests(db, [DOWN_FIX])).map((request) => request.institutionId)).toEqual([VERIFY]);
    expect((await runErrorFixRecheck({ db, entries: [DOWN_FIX] })).results[0]).toMatchObject({ named: 1, waiting: 1 });
    const run = await completedRun({ institution_id: VERIFY });
    await raw`INSERT INTO agent_run_steps (agent_run_id, step_key, agent_name, title, status, completed_at)
              VALUES (${run}, 'classify', 'darwin', 'Classify and verify extracted fees', 'completed', NOW())`;
    expect(await errorFixRequests(db, [DOWN_FIX])).toEqual([]);
    expect((await runErrorFixRecheck({ db, entries: [DOWN_FIX] })).results[0]).toMatchObject({ named: 1, waiting: 0, notReproduced: 1 });
  });

  it("verify fix: a failed cohort selection inside the step's transaction is reported and the recheck finishes", async () => {
    const stop = new Error("rollback cohort failure fixture");
    await raw.begin(async (native) => {
      const tx = native as unknown as typeof raw;
      const [run] = await tx`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Loop stage re-run', 'running') RETURNING id`;
      const [step] = await tx`INSERT INTO agent_run_steps (agent_run_id, step_key, agent_name, title, status) VALUES (${run.id}, 'classify', 'darwin', 'Cohort failure fixture', 'running') RETURNING id`;
      // A real SQL error at the cohort's target read only, keeping native savepoint semantics.
      const failing = failSelectedSql(native, "'verified:' || p.lineage_ref::text");
      const result = await recheckVerifiedFees(failing as never, {
        runId: Number(run.id), stepId: Number(step.id), olderLive: false, secondLooks: false, secondLookCodes: [], errorFixes: [VERIFY_FIX],
      });
      expect(result.errorFixError).toContain("division by zero");
      expect(result.execution).toMatchObject({ eventId: expect.any(Number) });
      expect(result.execution?.phases.primary).toBe("complete");
      // The host transaction is still usable.
      expect((await tx`SELECT 1 AS ok`)[0].ok).toBe(1);
      throw stop;
    }).catch((error) => { if (error !== stop) throw error; });
  });

  it("publish fix: waits for a direct run's publish step for the bank, not a lane's, then judges the fee", async () => {
    await named("publish", PUBLISH, "stop_payment", "hamilton.source_check");
    expect((await errorFixRequests(db, [PUBLISH_FIX])).map((request) => request.institutionId)).toEqual([PUBLISH]);
    const step = async (run: number) => {
      await raw`INSERT INTO agent_run_steps (agent_run_id, step_key, agent_name, title, status, completed_at)
                VALUES (${run}, 'publish', 'gutenberg', 'Publish verified fees', 'completed', NOW())`;
    };
    // A lane run's publish is not the bank's direct run.
    await step(await completedRun());
    expect((await runErrorFixRecheck({ db, entries: [PUBLISH_FIX] })).results[0]).toMatchObject({ named: 1, waiting: 1 });
    await step(await completedRun({ institution_id: PUBLISH }));
    expect(await errorFixRequests(db, [PUBLISH_FIX])).toEqual([]);
    expect((await runErrorFixRecheck({ db, entries: [PUBLISH_FIX] })).results[0]).toMatchObject({ named: 1, waiting: 0, nowMatches: 1 });
  });
});
