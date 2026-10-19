// @vitest-environment node
/** Real HTTP, installed Next lifecycle and owned loopback SQL; no cancellation or application writes. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server } from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const connection = process.env.E2E_DATABASE_URL;
const modes = ["required_error", "factory_throw", "optional_error", "deadline_success", "deadline_error"] as const;

describe.skipIf(!connection)("public abandoned native SQL lifecycle", () => {
  let holder: postgres.Sql;
  let reader: postgres.Sql;
  let observer: postgres.Sql;
  let failing: postgres.Sql;
  let createPublicReadBudget: typeof import("./public-read-budget").createPublicReadBudget;
  let AfterContext: typeof import("next/dist/server/after/after-context.js").AfterContext;
  let workAsyncStorage: typeof import("next/dist/server/app-render/work-async-storage.external.js").workAsyncStorage;
  let workUnitAsyncStorage: typeof import("next/dist/server/app-render/work-unit-async-storage.external.js").workUnitAsyncStorage;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Public SQL lifecycle tests require owned loopback PostgreSQL; production forbidden");
    }
    // Next uses this global to create its real request stores. Import it after Node's ALS
    // is present, as Next's server bootstrap does; neither after() nor timers are mocked.
    Object.defineProperty(globalThis, "AsyncLocalStorage", { value: AsyncLocalStorage, configurable: true });
    ({ AfterContext } = await import("next/dist/server/after/after-context.js"));
    ({ workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js"));
    ({ workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js"));
    ({ createPublicReadBudget } = await import("./public-read-budget"));
    const options = { max: 1, ssl: "require" as const };
    holder = postgres(connection, options);
    reader = postgres(connection, options);
    observer = postgres(connection, options);
    failing = postgres(connection, options);
    await Promise.all([holder`SELECT 1`, reader`SELECT 1`, observer`SELECT 1`, failing`SELECT 1`]);
  });

  afterAll(async () => {
    for (const db of [reader, holder, observer, failing]) if (db) await db.end();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(modes)("retains started work before the real response closes: %s", async (mode) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = 23_180_000 + process.pid * modes.length + modes.indexOf(mode);
    const [{ pid: holderPid }] = await holder`SELECT pg_backend_pid() AS pid`;
    const [{ pid: readerPid }] = await reader`SELECT pg_backend_pid() AS pid`;
    await holder`SELECT pg_advisory_lock(${key})`;
    let locked = true;
    let actualRead: Promise<unknown> | undefined;
    let actualSettled = false;
    let server: Server | undefined;
    const retained: Promise<unknown>[] = [];
    let atResponse: { retained: number; actualSettled: boolean } | undefined;
    let errorCode: string | undefined;
    let optionalRetained: number | undefined;
    let laterStarted = 0;
    const start = vi.fn(() => actualRead!);

    try {
      server = createServer((_request, response) => {
        const afterContext = new AfterContext({
          waitUntil: (promise) => { retained.push(promise); },
          onClose: (callback) => response.once("finish", callback),
          onTaskError: (error) => { throw error; },
        });
        // Only the fields read by the installed after() implementation are needed by
        // this owned HTTP fixture. The actual Next storage and AfterContext are used.
        const workStore = {
          afterContext, pendingRevalidatedTags: [], pendingRevalidates: {}, pendingRevalidateWrites: [],
        } as unknown as Parameters<typeof workAsyncStorage.run>[0];
        const requestStore = { type: "request", phase: "render" } as Parameters<typeof workUnitAsyncStorage.run>[0];
        response.once("finish", () => {
          atResponse = { retained: retained.length, actualSettled };
        });
        void workAsyncStorage.run(workStore, () => workUnitAsyncStorage.run(requestStore, async () => {
          try {
            actualRead = mode === "deadline_error"
              ? Promise.resolve(reader`WITH held AS MATERIALIZED (SELECT pg_advisory_xact_lock(${key}) AS locked)
                  SELECT 1 / length(held.locked::text) FROM held`)
              : Promise.resolve(reader`SELECT pg_advisory_xact_lock(${key})`);
            void actualRead.then(() => { actualSettled = true; }, () => { actualSettled = true; });
            let blocked = false;
            for (let attempt = 0; attempt < 200; attempt += 1) {
              const [{ blockers }] = await observer<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${readerPid}) AS blockers`;
              if (blockers.includes(Number(holderPid))) { blocked = true; break; }
              await wait(10);
            }
            if (!blocked) throw new Error("Native pending read was not observed");

            const isDeadline = mode.startsWith("deadline");
            const budget = createPublicReadBudget(isDeadline ? 20 : 1_000, "Native SQL fixture");
            if (mode === "factory_throw") {
              await Promise.all([
                budget.required(() => { throw new Error("factory could not start"); }, "institution"),
                budget.required(start, "fees"),
              ]);
            } else if (mode === "required_error") {
              await Promise.all([
                budget.required(start, "fees"),
                budget.required(() => Promise.resolve(failing`SELECT 1 / 0`), "institution"),
              ]);
            } else if (mode === "optional_error") {
              const sibling = budget.required(start, "fees");
              expect(await budget.optional(() => Promise.resolve(failing`SELECT 1 / 0`), "complaints", null)).toBeNull();
              optionalRetained = retained.length;
              expect(await budget.required(async () => { laterStarted += 1; return "later"; }, "later section")).toBe("later");
              await holder`SELECT pg_advisory_unlock(${key})`;
              locked = false;
              await sibling;
            } else {
              expect(await budget.optional(start, "fees", [])).toEqual([]);
              const late = vi.fn(async () => { throw new Error("must never start SQL after deadline"); });
              expect(await budget.optional(late, "later section", [])).toEqual([]);
              expect(late).not.toHaveBeenCalled();
            }
            response.statusCode = 200;
            response.end("completed");
          } catch (error) {
            errorCode = (error as { code?: string }).code;
            response.statusCode = 500;
            response.end("bounded fixture error");
          }
        }));
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing owned HTTP listener");
      const response = await fetch(`http://127.0.0.1:${address.port}/native-fixture`);
      await response.text();
      expect(start).toHaveBeenCalledTimes(1);

      if (mode === "optional_error") {
        expect(response.status).toBe(200);
        expect(optionalRetained).toBe(0);
        expect(laterStarted).toBe(1);
        expect(atResponse).toEqual({ retained: 0, actualSettled: true });
      } else {
        expect(response.status).toBe(mode.startsWith("deadline") ? 200 : 500);
        if (mode === "required_error") expect(errorCode).toBe("22012");
        const [{ blockers }] = await observer<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${readerPid}) AS blockers`;
        expect(blockers).toContain(Number(holderPid));
        // This closes the response-time exposure window. It does not simulate a Vercel
        // process freeze or claim the platform will retain a query without a time limit.
        expect(atResponse).toEqual({ retained: 1, actualSettled: false });
      }
    } finally {
      if (locked) await holder`SELECT pg_advisory_unlock(${key})`;
      await actualRead?.catch(() => {});
      await Promise.all(retained);
      if (server) {
        await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
      }
    }

    const [{ pid: sameClient, ready }] = await reader`SELECT pg_backend_pid() AS pid, 1 AS ready`;
    expect(Number(sameClient)).toBe(Number(readerPid));
    expect(ready).toBe(1);
    const [{ waiting }] = await observer`SELECT count(*)::int AS waiting FROM pg_locks
      WHERE pid=${readerPid} AND NOT granted`;
    expect(waiting).toBe(0);
    if (mode === "deadline_error") {
      expect(console.error).toHaveBeenCalledWith("Native SQL fixture fees abandoned read failed:",
        expect.objectContaining({ code: "22012" }));
    } else {
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("abandoned read failed:"), expect.anything());
    }
  }, 10_000);
});
