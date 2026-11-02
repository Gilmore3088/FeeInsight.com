// @vitest-environment node
/**
 * Knox's re-read backlog planner (gap 10) inside a real Postgres transaction, the way the extract step
 * runs it (run-store `withTransaction`). A failed or timed-out planner statement must roll back to its
 * savepoint and leave the step's transaction usable, with its statement timeout as it was. Every
 * fixture runs in a transaction that is rolled back; the failures are forced with a temporary table
 * that shadows a real one (a missing column, as during a deploy) and with `pg_sleep` past the timeout.
 * Needs only a disposable loopback database. No provider or network call.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;

describe.skipIf(!connection)("Knox re-read backlog planner in a real transaction (gap 10)", () => {
  let db: postgres.Sql;
  let backlog: typeof import("./reread-backlog");
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Re-read backlog DB tests require a disposable loopback database");
    // CI's e2e database requires TLS like the other DB tests; a local server without TLS sets
    // E2E_DATABASE_SSL=disable.
    db = postgres(connection, { max: 1, ssl: process.env.E2E_DATABASE_SSL === "disable" ? false : "require", onnotice: () => {} });
    backlog = await import("./reread-backlog");
  });
  afterAll(async () => { if (db) await db.end(); });

  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback re-read backlog fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; }).catch((error) => { if (error !== stop) throw error; });
  }
  const timeoutOf = async (tx: Db) => (await tx<Array<{ value: string }>>`SELECT current_setting('statement_timeout') AS value`)[0].value;

  it("a planner query that fails mid-step leaves the transaction usable and says it was not counted", async () => {
    await rollback(async (tx) => {
      await tx`SET LOCAL statement_timeout = '7s'`;
      await tx`CREATE TEMP TABLE gap10_marker (id int) ON COMMIT DROP`;
      await tx`INSERT INTO gap10_marker VALUES (1)`;
      // Shadows the real table for this transaction: the planner's fp.rolled_back_at no longer exists.
      await tx`CREATE TEMP TABLE published_fee_records (id int) ON COMMIT DROP`;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { rows, report } = await backlog.planRereadBacklog(tx, { slots: 10, stateCode: "TX", live: false });
      error.mockRestore();
      expect(rows).toEqual([]);
      expect(report).toMatchObject({ counted: false, notCounted: "failed", due: null, dueBehindLive: null, documentsUnchecked90: null, queued: null });
      expect(backlog.rereadBacklogSummary(report)).toContain("not counted this step");
      expect(backlog.rereadBacklogSummary(report)).not.toMatch(/\b0 current texts\b/);
      // The step's transaction goes on: earlier work is intact and later statements run.
      expect(await tx`SELECT count(*)::int AS n FROM gap10_marker`).toEqual([{ n: 1 }]);
      await tx`INSERT INTO gap10_marker VALUES (2)`;
      expect(await timeoutOf(tx)).toBe("7s");
    });
  });

  it("a planner read past its statement timeout is cancelled and rolled back to its savepoint", async (ctx) => {
    // An embedded single-process server (PGlite, used to run this file locally) does not cancel on
    // statement_timeout; CI's Postgres does.
    const enforced = await db.begin(async (scope) => {
      const probe = scope as unknown as Db;
      await probe`SET LOCAL statement_timeout = '20ms'`;
      return probe`SELECT pg_sleep(0.2)`.then(() => false, () => true);
    }).catch(() => true);
    if (!enforced) ctx.skip();
    await rollback(async (tx) => {
      await tx`SET LOCAL statement_timeout = '7s'`;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const read = await backlog.boundedRead(tx, 50, (scope) => scope`SELECT pg_sleep(1)`, "gap 10 fixture");
      error.mockRestore();
      expect(read.ok).toBe(false);
      expect(await tx`SELECT 1 AS one`).toEqual([{ one: 1 }]);
      expect(await timeoutOf(tx)).toBe("7s");
    });
  });

  it("a successful read runs under its own timeout and puts the step's timeout back", async () => {
    await rollback(async (tx) => {
      await tx`SET LOCAL statement_timeout = '7s'`;
      const read = await backlog.boundedRead(tx, backlog.KNOX_REREAD_BACKLOG_TIMEOUT_MS, (scope) => timeoutOf(scope), "gap 10 fixture");
      expect(read).toEqual({ ok: true, value: "5s" });
      expect(await timeoutOf(tx)).toBe("7s");
    });
  });
});
