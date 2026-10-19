/** Real cross-connection reservations; isolated schema in a loopback-only database. */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reserveLoginAttempt, LOGIN_ATTEMPT_LIMITS, loginLimitSubjects } from "./login-rate-limit";
import type { withTransaction } from "@/lib/data-store/connection";

const connection = process.env.E2E_DATABASE_URL;
const schema = `login_limit_${randomBytes(8).toString("hex")}`;

describe.skipIf(!connection)("login limits in isolated PostgreSQL", () => {
  let db: postgres.Sql;
  let transact: typeof withTransaction;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Login reservation tests require a loopback E2E database");
    }
    db = postgres(connection, { max: 16, ssl: "require", prepare: false });
    await db`CREATE SCHEMA ${db(schema)}`;
    // Copy current production columns/constraints/indexes, with an independent sequence.
    // Do not copy defaults: the public audit sequence must never advance from this test.
    await db`CREATE TABLE ${db(schema)}.api_route_audit_events (LIKE public.api_route_audit_events INCLUDING CONSTRAINTS INCLUDING INDEXES)`;
    await db`ALTER TABLE ${db(schema)}.api_route_audit_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY`;
    transact = (async (callback) => db.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      return callback(tx as unknown as Parameters<Parameters<typeof withTransaction>[0]>[0]);
    })) as typeof withTransaction;
  });
  beforeEach(async () => { await db`TRUNCATE ${db(schema)}.api_route_audit_events`; });
  afterAll(async () => {
    if (db) {
      await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`;
      await db.end();
    }
  });

  it("admits only ten parallel attempts at one identifier across clients, including aliases", async () => {
    const result = await Promise.all(Array.from({ length: 32 }, (_, i) => reserveLoginAttempt(
      i % 2 ? " Person@Example.COM " : "person@example.com",
      new Headers({ "x-forwarded-for": `203.0.113.${i + 1}` }), transact,
    )));
    expect(result.filter((v) => v === "allowed")).toHaveLength(LOGIN_ATTEMPT_LIMITS.identifier);
    expect(result.filter((v) => v === "limited")).toHaveLength(32 - LOGIN_ATTEMPT_LIMITS.identifier);
    expect(await db`SELECT count(*)::int AS n FROM ${db(schema)}.api_route_audit_events`).toEqual([{ n: 20 }]);
  });

  it("bounds one client across different identifiers and leaves blocked scopes unreserved", async () => {
    const result = await Promise.all(Array.from({ length: 64 }, (_, i) => reserveLoginAttempt(
      `person-${i}@example.com`, new Headers({ "x-forwarded-for": "203.0.113.9" }), transact,
    )));
    expect(result.filter((v) => v === "allowed")).toHaveLength(LOGIN_ATTEMPT_LIMITS.client);
    expect(result.filter((v) => v === "limited")).toHaveLength(64 - LOGIN_ATTEMPT_LIMITS.client);
    expect(await db`SELECT count(*)::int AS n FROM ${db(schema)}.api_route_audit_events`).toEqual([{ n: 100 }]);
  });

  it("keeps the account scope without an IP, lets its rolling window expire, and does not extend it on denial", async () => {
    const h = new Headers();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveLoginAttempt("unknown@example.com", h, transact)));
    expect(results.filter((v) => v === "allowed")).toHaveLength(10);
    expect(await reserveLoginAttempt("unknown@example.com", h, transact)).toBe("limited");
    await db`UPDATE ${db(schema)}.api_route_audit_events SET created_at = statement_timestamp() - interval '16 minutes'`;
    expect(await reserveLoginAttempt("unknown@example.com", h, transact)).toBe("allowed");
    const [{ subject_key }] = await db`SELECT subject_key FROM ${db(schema)}.api_route_audit_events LIMIT 1`;
    expect(subject_key).toBe(loginLimitSubjects("unknown@example.com", h)[0].key);
    expect(subject_key).toMatch(/^[0-9a-f]{64}$/);
  });
});
