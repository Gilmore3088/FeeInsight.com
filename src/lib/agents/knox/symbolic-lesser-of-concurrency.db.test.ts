// @vitest-environment node
/** Real independent transactions; only owned, committed loopback fixtures are removed. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RawFeeRow } from "../darwin/verify";

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
const SOURCE_URL = "https://example.invalid/symbolic-lesser-concurrency-fees";
const TEXT = "Late Payment Fee | $10.00 each billing period or amount of minimum payment, whichever is less";
const HASH = createHash("sha256").update(TEXT).digest("hex");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.skipIf(!connection)("Symbolic lesser-of hold and Darwin concurrency (#2335)", () => {
  let observer: postgres.Sql;
  let firstConnection: postgres.Sql;
  let secondConnection: postgres.Sql;
  let appSql: Db;
  let extract: typeof import("./extract");
  let darwin: typeof import("../darwin/verify");
  let nextRunId = -233_550_000 - process.pid * 10;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Symbolic lesser concurrency tests require disposable loopback PostgreSQL; production is forbidden");
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
        VALUES ('Synthetic symbolic lesser concurrency fixture','https://example.invalid/',${SOURCE_URL},
        'bank','Wisconsin','WI',500000,'e2e','active') RETURNING id`;
      const [{ id: runId }] = await tx`INSERT INTO agent_runs(id,agent_name,run_kind,title,status)
        VALUES (${nextRunId--},'knox','state_agent','Symbolic lesser concurrency fixture','running') RETURNING id`;
      const [{ id: documentId }] = await tx`INSERT INTO source_documents
        (institution_id,status,document_url,content_hash,content_type)
        VALUES (${institutionId},'success',${SOURCE_URL},${HASH},'text/plain') RETURNING id`;
      const [{ id: textId }] = await tx`INSERT INTO agent_source_texts
        (agent_run_id,source_document_id,institution_id,source_url,status,normalized_text,text_hash,char_count)
        VALUES (${runId},${documentId},${institutionId},${SOURCE_URL},'completed',${TEXT},${HASH},${TEXT.length}) RETURNING id`;
      const note = `Knox deterministic extraction. canonical_hint=late_payment; text_hash=${HASH}; excerpt="Late Payment Fee | $10.00 each billing period or amount of minimum payment, whichever is less"`;
      const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source_url,source,extraction_confidence,agent_event_id,fee_name,
        amount,frequency,conditions,extraction_note,outlier_flags,fee_audience,line_share)
        VALUES (${institutionId},${documentId},${SOURCE_URL},'knox',.91,gen_random_uuid(),'Late Payment Fee',10,'per_item',
        ${note},${note},'["needs_darwin_verification","canonical_hint:late_payment"]'::jsonb,'unknown','')
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
        AND institution_name='Synthetic symbolic lesser concurrency fixture' AND website_url='https://example.invalid/'`;
      expect(owned).toHaveLength(1);
      await tx`DELETE FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      await tx`DELETE FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId} AND institution_id=${fixture.institutionId}`;
      await tx`DELETE FROM agent_source_texts WHERE id=${fixture.textId} AND institution_id=${fixture.institutionId}`;
      await tx`DELETE FROM source_documents WHERE id=${fixture.documentId} AND institution_id=${fixture.institutionId}`;
      await tx`DELETE FROM agent_runs WHERE id=${fixture.runId} AND title='Symbolic lesser concurrency fixture'`;
      await tx`DELETE FROM institution_sources WHERE id=${fixture.institutionId}
        AND institution_name='Synthetic symbolic lesser concurrency fixture'`;
      expect(await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`).toHaveLength(0);
      expect(await tx`SELECT id FROM institution_sources WHERE id=${fixture.institutionId}`).toHaveLength(0);
    });
  }
  const hold = (tx: Db, fixture: Fixture) => extract.insertCandidate(tx, {
    runId: fixture.runId,
    row: { document_text_id: fixture.textId, source_document_id: fixture.documentId,
      institution_id: fixture.institutionId, source_url: SOURCE_URL, text_hash: HASH, normalized_text: TEXT },
    candidate: { feeName: "Late Payment Fee", amount: 10, frequency: "per_item", canonicalHint: "late_payment",
      confidence: .91, excerpt: "Late Payment Fee | $10.00 each billing period or amount of minimum payment, whichever is less", waivable: false },
  });
  const verify = (tx: Db, fixture: Fixture, legacy = false, canonicalFeeKey = "late_payment") => {
    const row = { ...fixture.row };
    if (legacy) delete row.product_name;
    return darwin.insertVerifiedFee(tx, { runId: fixture.runId, row, canonicalFeeKey, sourceText: TEXT });
  };

  async function observeBlock(waitingPid: number, expectedBlocker: number) {
    // Observe the database's actual dependency; elapsed time alone never proves the race.
    for (let attempt = 0; attempt < 200; attempt++) {
      const [{ blockers }] = await observer<{ blockers: number[] }[]>`
        SELECT pg_blocking_pids(${waitingPid}) AS blockers`;
      if (blockers.includes(expectedBlocker)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("The expected independent raw-row lock wait was not observed");
  }

  it.each([
    { first: "Darwin", legacy: false, canonicalFeeKey: "late_payment" },
    { first: "hold", legacy: false, canonicalFeeKey: "late_payment" },
    { first: "hold", legacy: true, canonicalFeeKey: "late_payment" },
    { first: "hold", legacy: false, canonicalFeeKey: "minimum_balance" },
    { first: "hold", legacy: true, canonicalFeeKey: "minimum_balance" },
  ] as const)("preserves judgment and held eligibility when $first wins (legacy=$legacy, stale category=$canonicalFeeKey)", async ({ first, legacy, canonicalFeeKey }) => {
    const fixture = await seed();
    const release = deferred<void>();
    const ready = deferred<{ pid: number; result: number | boolean | null }>();
    const waiting = deferred<number>();
    let firstTask: Promise<unknown> | undefined;
    let secondTask: Promise<unknown> | undefined;
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
      }).catch(error => { waiting.reject(error); throw error; });
      await observeBlock(await waiting.promise, firstResult.pid);
      release.resolve();
      const [, secondResult] = await Promise.all([firstTask, secondTask]);
      const [current] = await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      const judgments = await observer`SELECT fee_verified_id FROM verified_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      if (first === "Darwin") {
        expect(secondResult).toBe(false);
        expect(current).toEqual(fixture.row);
        expect(judgments).toHaveLength(1);
      } else {
        expect(secondResult).toBeNull();
        expect(JSON.stringify(current.outlier_flags)).toContain("knox_review:eligibility");
        expect(JSON.stringify(current.outlier_flags)).toContain("knox_eligibility:symbolic_lesser");
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

  it.each([false, true])("still verifies an ordinary pending item row (legacy=%s)", async legacy => {
    const fixture = await seed();
    try {
      const verifiedId = await firstConnection.begin(scope => verify(scope as unknown as Db, fixture, legacy));
      expect(verifiedId).not.toBeNull();
      expect(await observer`SELECT fee_verified_id FROM verified_fee_observations
        WHERE fee_raw_id=${fixture.rawId} AND review_status='verified'`).toHaveLength(1);
    } finally { await cleanup(fixture); }
  });

  it.each(["late_payment", "minimum_balance"])("does not add a needs-verification flag requirement to legitimate %s rejudges", async canonicalFeeKey => {
    const fixture = await seed();
    try {
      await observer`UPDATE raw_fee_observations SET outlier_flags='["canonical_hint:late_payment"]'::jsonb
        WHERE fee_raw_id=${fixture.rawId}`;
      const [current] = await observer`SELECT * FROM raw_fee_observations WHERE fee_raw_id=${fixture.rawId}`;
      fixture.row = current as unknown as RawFeeRow;
      expect(await firstConnection.begin(scope => verify(scope as unknown as Db, fixture, false, canonicalFeeKey))).not.toBeNull();
      expect(await observer`SELECT fee_verified_id FROM verified_fee_observations
        WHERE fee_raw_id=${fixture.rawId} AND review_status='verified'`).toHaveLength(1);
    } finally { await cleanup(fixture); }
  });
});
