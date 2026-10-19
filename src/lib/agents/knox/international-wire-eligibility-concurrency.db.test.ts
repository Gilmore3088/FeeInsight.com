// @vitest-environment node
/** Real independent transactions; only owned, committed loopback fixtures are removed. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RawFeeRow } from "../darwin/verify";

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
const SOURCE_URL = "https://example.invalid/international-concurrency-fees";
const TEXT = "International Wire Outgoing | $45";
const HASH = createHash("sha256").update(TEXT).digest("hex");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.skipIf(!connection)("International applicability hold and Darwin concurrency (#2278)", () => {
  let observer: postgres.Sql;
  let firstConnection: postgres.Sql;
  let secondConnection: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let nextRunId = -227_890_000 - process.pid * 10;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("International concurrency tests require disposable loopback PostgreSQL; production is forbidden");
    vi.stubEnv("DATABASE_URL", connection);
    const mod = await import("@/lib/data-store/connection");
    appSql = mod.sql;
    const options = { max: 1, ssl: "require" as const, types: {
      numeric: mod.NUMERIC_AS_NUMBER, json: mod.JSON_TEXT_PASSTHROUGH, text: mod.TEXT_WITHOUT_NUL,
    } };
    observer = postgres(connection, options);
    firstConnection = postgres(connection, options);
    secondConnection = postgres(connection, options);
    extract = await import("./extract");
    darwin = await import("../darwin/verify");
  }, 30_000);
  afterAll(async () => {
    for (const client of [firstConnection, secondConnection, observer, appSql]) if (client) await client.end();
    vi.unstubAllEnvs();
  });

  async function seed() {
    // Committed seeds are necessary for separate sessions to observe the same raw row.
    // The unique IDs returned here are the only IDs the finally cleanup may remove.
    return observer.begin(async scope => {
      const tx = scope as unknown as Db;
      const [{ id: institutionId }] = await tx`INSERT INTO institution_sources
        (institution_name,website_url,fee_schedule_url,charter_type,state,state_code,asset_size,source,status)
        VALUES ('Synthetic international concurrency fixture','https://example.invalid/',${SOURCE_URL},
        'bank','Wisconsin','WI',500000,'e2e','active') RETURNING id`;
      const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
        VALUES (${nextRunId--},'knox','state_agent','International concurrency fixture','running') RETURNING id`;
      const [{ id: documentId }] = await tx`INSERT INTO source_documents
        (institution_id,status,document_url,content_hash,content_type)
        VALUES (${institutionId},'success',${SOURCE_URL},${HASH},'text/plain') RETURNING id`;
      const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
        (agent_run_id,source_document_id,institution_id,source_url,status,source_hash,normalized_text,text_hash,char_count)
        VALUES (${runId},${documentId},${institutionId},${SOURCE_URL},'completed',${HASH},${TEXT},${HASH},${TEXT.length}) RETURNING id`;
      const note = `Knox deterministic extraction from Rosetta artifact #${textId}. canonical_hint=wire_intl_outgoing; text_hash=${HASH}; excerpt="International Wire Outgoing | $45"`;
      const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source_url,source,extraction_confidence,agent_event_id,fee_name,
        amount,frequency,conditions,extraction_note,outlier_flags,fee_audience,line_share)
        VALUES (${institutionId},${documentId},${SOURCE_URL},'knox',.91,gen_random_uuid(),'International Wire Outgoing',45,'per_item',
        ${note},${note},'["needs_darwin_verification","canonical_hint:wire_intl_outgoing"]'::jsonb,'unknown','')
        RETURNING fee_raw_id`;
      const [row] = await tx`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${rawId}`;
      return { institutionId: Number(institutionId), runId: Number(runId), documentId: Number(documentId),
        textId: Number(textId), rawId: Number(rawId), row: row as unknown as RawFeeRow };
    });
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;

  async function cleanup(fixture: Fixture) {
    await observer.begin(async scope => {
      const tx = scope as unknown as Db;
      const owned = await tx`SELECT id FROM institution_sources WHERE id=${fixture.institutionId}
        AND institution_name='Synthetic international concurrency fixture' AND website_url='https://example.invalid/'`;
      expect(owned).toHaveLength(1);
      await tx`DELETE FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      await tx`DELETE FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId} AND institution_id=${fixture.institutionId}`;
      await tx`DELETE FROM agent_source_texts WHERE id=${fixture.textId} AND institution_id=${fixture.institutionId}`;
      await tx`DELETE FROM source_documents WHERE id=${fixture.documentId} AND institution_id=${fixture.institutionId}`;
      await tx`DELETE FROM agent_runs WHERE id=${fixture.runId} AND title='International concurrency fixture'`;
      await tx`DELETE FROM institution_sources WHERE id=${fixture.institutionId}
        AND institution_name='Synthetic international concurrency fixture'`;
      expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`).toHaveLength(0);
      expect(await tx`SELECT id FROM institution_sources WHERE id=${fixture.institutionId}`).toHaveLength(0);
    });
  }
  const hold = (tx: Db, fixture: Fixture) => extract.insertCandidate(tx, {
    runId: fixture.runId,
    row: { document_text_id: fixture.textId, source_document_id: fixture.documentId,
      institution_id: fixture.institutionId, source_url: SOURCE_URL, text_hash: HASH, normalized_text: TEXT },
    candidate: { feeName: "International Wire Outgoing", amount: 45, frequency: "per_item", canonicalHint: "wire_intl_incoming",
      confidence: .91, excerpt: "International Wire Outgoing | $45", waivable: false },
  });
  const verify = (tx: Db, fixture: Fixture, legacy = false, canonicalFeeKey = "wire_intl_outgoing") => {
    const row = { ...fixture.row };
    if (legacy) delete row.product_name;
    return darwin.insertVerifiedFee(tx, { runId: fixture.runId, row, canonicalFeeKey, sourceText: TEXT });
  };

  async function attemptVerify(client: postgres.Sql, fixture: Fixture, legacy = false, canonicalFeeKey = "wire_intl_outgoing") {
    return client.begin(tx => verify(tx as unknown as Db, fixture, legacy, canonicalFeeKey))
      .then(id => ({ kind: "completed" as const, id }), error => {
        if ((error as Error)?.constructor?.name === "VerificationAudienceDeferred") return { kind: "deferred" as const };
        throw error;
      });
  }

  async function observeBlockOrCompletion(waitingPid: number, expectedBlocker: number, settled: () => boolean) {
    // Observe the database's actual dependency; elapsed time alone never proves the race.
    for (let attempt = 0; attempt < 200; attempt++) {
      const [{ blockers }] = await observer<{ blockers: number[] }[]>`
        SELECT pg_blocking_pids(${waitingPid}) AS blockers`;
      if (blockers.includes(expectedBlocker)) return;
      if (settled()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("The expected independent raw-row lock wait was not observed");
  }

  it.each([
    { first: "Darwin", legacy: false, canonicalFeeKey: "wire_intl_outgoing" },
    { first: "hold", legacy: false, canonicalFeeKey: "wire_intl_outgoing" },
    { first: "hold", legacy: true, canonicalFeeKey: "wire_intl_outgoing" },
    { first: "hold", legacy: false, canonicalFeeKey: "minimum_balance" },
    { first: "hold", legacy: true, canonicalFeeKey: "minimum_balance" },
  ] as const)("preserves judgment and held eligibility when $first wins (legacy=$legacy, stale category=$canonicalFeeKey)", async ({ first, legacy, canonicalFeeKey }) => {
    const fixture = await seed();
    const release = deferred<void>();
    const ready = deferred<{ pid: number; result: number | boolean | null }>();
    const waiting = deferred<number>();
    let firstTask: Promise<unknown> | undefined;
    let secondTask: Promise<unknown> | undefined;
    let secondSettled = false;
    try {
      firstTask = firstConnection.begin(async scope => {
        const tx = scope as unknown as Db;
        await tx`SET LOCAL lock_timeout='8s'`;
        const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
        const result = await (first === "Darwin" ? verify(tx, fixture) : hold(tx, fixture));
        ready.resolve({ pid: Number(pid), result });
        await release.promise;
        return result;
      }).catch(error => { ready.reject(error); throw error; });
      const firstResult = await ready.promise;
      expect(firstResult.result).toBeTruthy();
      secondTask = secondConnection.begin(async scope => {
        const tx = scope as unknown as Db;
        await tx`SET LOCAL lock_timeout='8s'`;
        const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
        waiting.resolve(Number(pid));
        return first === "Darwin" ? hold(tx, fixture) : verify(tx, fixture, legacy, canonicalFeeKey);
      }).then(id => { secondSettled = true; return { kind: "completed", id }; }, error => {
        secondSettled = true; waiting.reject(error);
        if ((error as Error)?.constructor?.name === "VerificationAudienceDeferred") return { kind: "deferred" };
        throw error;
      });
      await observeBlockOrCompletion(await waiting.promise, firstResult.pid, () => secondSettled);
      release.resolve();
      const [, secondResult] = await Promise.all([firstTask, secondTask]);
      const [current] = await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      const judgments = await observer`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      if (first === "Darwin") {
        expect(secondResult).toEqual({ kind: "completed", id: false });
        expect(current).toEqual(fixture.row);
        expect(judgments).toHaveLength(1);
      } else {
        expect(secondResult).toEqual({ kind: "deferred" });
        expect(JSON.stringify(current.outlier_flags)).toContain("knox_review:eligibility");
        expect(JSON.stringify(current.outlier_flags)).toContain("knox_eligibility:international_wire");
        expect(JSON.stringify(current.outlier_flags)).not.toContain("needs_darwin_verification");
        expect(judgments).toHaveLength(0);
      }
    } finally {
      release.resolve();
      if (firstTask) await firstTask.catch(() => {});
      if (secondTask) await secondTask.catch(() => {});
      await cleanup(fixture);
    }
  }, 20_000);

  it.each(["wire_intl_outgoing", "minimum_balance"])("declines unmarked current generic international scope despite stale selected %s", async canonicalFeeKey => {
    const fixture = await seed();
    try {
      const generic = "International Wire Transfer Fee | $35";
      const hash = createHash("sha256").update(generic).digest("hex");
      await observer`UPDATE source_documents SET content_hash=${hash} WHERE id=${fixture.documentId}`;
      await observer`UPDATE agent_source_texts SET normalized_text=${generic},text_hash=${hash},source_hash=${hash},char_count=${generic.length} WHERE id=${fixture.textId}`;
      const note = `Knox deterministic extraction from Rosetta artifact #${fixture.textId}. canonical_hint=wire_intl_outgoing; text_hash=${hash}; excerpt="${generic}"`;
      await observer`UPDATE raw_fee_observations SET fee_name='International Wire Transfer Fee',amount=35,
        extraction_note=${note},conditions=${note},outlier_flags='["canonical_hint:wire_intl_outgoing"]'::jsonb WHERE fee_raw_id=${fixture.rawId}`;
      fixture.row = (await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`)[0] as unknown as RawFeeRow;
      const result = await attemptVerify(firstConnection, fixture, false, canonicalFeeKey);
      expect(result).toEqual({ kind: "deferred" });
      expect(await observer`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`).toHaveLength(0);
    } finally { await cleanup(fixture); }
  });

  it.each([false, true])("keeps a source-proven international rejudge without a needs flag (legacy=%s)", async legacy => {
    const fixture = await seed();
    try {
      await observer`UPDATE raw_fee_observations SET outlier_flags='["canonical_hint:wire_intl_outgoing"]'::jsonb WHERE fee_raw_id=${fixture.rawId}`;
      fixture.row = (await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`)[0] as unknown as RawFeeRow;
      const result = await attemptVerify(firstConnection, fixture, legacy);
      expect(result).toMatchObject({ kind: "completed", id: expect.any(Number) });
      expect(await observer`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`).toHaveLength(1);
    } finally { await cleanup(fixture); }
  });

  it("does not let actual stale minimum-balance hint and selected key negate own international source facts", async () => {
    const fixture = await seed();
    try {
      await observer`UPDATE raw_fee_observations SET
        extraction_note=replace(extraction_note,'canonical_hint=wire_intl_outgoing','canonical_hint=minimum_balance'),
        conditions=replace(conditions,'canonical_hint=wire_intl_outgoing','canonical_hint=minimum_balance'),
        outlier_flags='["canonical_hint:minimum_balance"]'::jsonb WHERE fee_raw_id=${fixture.rawId}`;
      fixture.row = (await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`)[0] as unknown as RawFeeRow;
      expect(await attemptVerify(firstConnection, fixture, false, "minimum_balance")).toEqual({ kind: "deferred" });
      expect(await observer`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`).toHaveLength(0);
    } finally { await cleanup(fixture); }
  });

  it.each([
    { name: "International Wire Outgoing", key: "minimum_balance", deferred: true },
    { name: "Outgoing Wire Transfer outside USA Consumer Customer", key: "minimum_balance", deferred: true },
    { name: "Domestic Wire Outgoing", key: "wire_domestic_outgoing", deferred: false },
    { name: "International Money Order", key: "money_order", deferred: false },
  ])("routes unavailable current $name source without changing unrelated ordinary admission", async ({ name, key, deferred: mustDefer }) => {
    const fixture = await seed();
    try {
      await observer`UPDATE agent_source_texts SET status='failed' WHERE id=${fixture.textId}`;
      await observer`UPDATE raw_fee_observations SET fee_name=${name},
        extraction_note=replace(extraction_note,'canonical_hint=wire_intl_outgoing',${`canonical_hint=${key}`}),
        conditions=replace(conditions,'canonical_hint=wire_intl_outgoing',${`canonical_hint=${key}`}),
        outlier_flags=${JSON.stringify([`canonical_hint:${key}`])}::jsonb WHERE fee_raw_id=${fixture.rawId}`;
      fixture.row = (await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`)[0] as unknown as RawFeeRow;
      const result = await attemptVerify(firstConnection, fixture, false, key);
      expect(result).toMatchObject(mustDefer ? { kind: "deferred" } : { kind: "completed", id: expect.any(Number) });
      expect(await observer`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`)
        .toHaveLength(mustDefer ? 0 : 1);
    } finally { await cleanup(fixture); }
  });
});
