// @vitest-environment node
/** Owned loopback clients; one already-sent statement, no cancellation or application writes. */
import postgres from "postgres";
import { setTimeout as wait } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const lifecycle = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: lifecycle.after }));
import { createPublicReadBudget } from "./public-read-budget";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("public abandoned native SQL lifecycle", () => {
  let holder: postgres.Sql, reader: postgres.Sql, observer: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Public SQL lifecycle tests require owned loopback PostgreSQL; production forbidden");
    const options = { max: 1, ssl: "require" as const };
    holder = postgres(connection, options); reader = postgres(connection, options); observer = postgres(connection, options);
    await Promise.all([holder`SELECT 1`, reader`SELECT 1`, observer`SELECT 1`]);
  });
  afterAll(async () => { for (const db of [reader, holder, observer]) if (db) await db.end(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([false, true])("retains an actual blocked read once until its late %s result settles and the client is reusable", async rejects => {
    lifecycle.after.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {});
    const key = 23_180_000 + process.pid * 2 + Number(rejects);
    const [{ pid: holderPid }] = await holder`SELECT pg_backend_pid() AS pid`;
    const [{ pid: readerPid }] = await reader`SELECT pg_backend_pid() AS pid`;
    await holder`SELECT pg_advisory_lock(${key})`;
    let locked = true;
    let retained: Promise<void> | undefined;
    let actualRead: Promise<unknown> | undefined;
    try {
      const start = vi.fn(() => rejects
        ? Promise.resolve(reader`WITH held AS MATERIALIZED (SELECT pg_advisory_xact_lock(${key}) AS locked)
            SELECT 1 / length(held.locked::text) FROM held`)
        : Promise.resolve(reader`SELECT pg_advisory_xact_lock(${key})`));
      actualRead = start();
      void actualRead.catch(() => {}); // Cleanup also owns a failed assertion before lifecycle registration.
      // Observe the actual server-side dependency before advancing the budget's clock.
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [{ blockers }] = await observer<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${readerPid}) AS blockers`;
        if (blockers.includes(Number(holderPid))) { blocked = true; break; }
        await wait(10);
      }
      expect(blocked).toBe(true);
      // The server lock is proven before this real deadline starts; no driver timers are mocked.
      const budget = createPublicReadBudget(20, "Native SQL fixture");
      expect(await budget.optional(() => actualRead!, "fees", [])).toEqual([]);
      expect(lifecycle.after).toHaveBeenCalledTimes(1);
      const late = vi.fn(async () => { throw new Error("must never start SQL after deadline"); });
      expect(await budget.optional(late, "later section", [])).toEqual([]);
      expect(late).not.toHaveBeenCalled(); expect(start).toHaveBeenCalledTimes(1);
      retained = (lifecycle.after.mock.calls[0][0] as () => Promise<void>)();
      vi.useRealTimers();
      await holder`SELECT pg_advisory_unlock(${key})`; locked = false;
      await retained;
      const [{ pid: sameClient, ready }] = await reader`SELECT pg_backend_pid() AS pid,1 AS ready`;
      expect(Number(sameClient)).toBe(Number(readerPid)); expect(ready).toBe(1);
      const [{ waiting }] = await observer`SELECT count(*)::int AS waiting FROM pg_locks
        WHERE pid=${readerPid} AND NOT granted`;
      expect(waiting).toBe(0);
      if (rejects) expect(console.error).toHaveBeenCalledWith("Native SQL fixture fees abandoned read failed:",
        expect.objectContaining({ code: "22012" }));
      else expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("abandoned read failed:"), expect.anything());
    } finally {
      vi.useRealTimers();
      if (locked) await holder`SELECT pg_advisory_unlock(${key})`;
      if (retained) await retained;
      if (actualRead) await actualRead.catch(() => {});
    }
  }, 10_000);
});
