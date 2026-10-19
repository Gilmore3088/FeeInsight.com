import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_ATTEMPT_LIMITS, loginLimitSubjects, reserveLoginAttempt } from "./login-rate-limit";
import type { withTransaction } from "@/lib/data-store/connection";

const headers = (ip?: string) => new Headers(ip ? { "x-forwarded-for": ip } : {});

function storage(attempts: number, fail?: "count" | "insert") {
  const subjects = loginLimitSubjects("person@example.com", headers("203.0.113.9"));
  const tx = vi.fn(async (parts: TemplateStringsArray) => {
    const query = parts.join("?");
    if (query.includes("COUNT(*)")) {
      if (fail === "count") throw new Error("private@example.com");
      return subjects.map((subject) => ({ subject_key: subject.key, attempts }));
    }
    if (query.includes("INSERT INTO")) {
      if (fail === "insert") throw new Error("private@example.com");
      return subjects.map((subject) => ({ subject_key: subject.key }));
    }
    return [];
  });
  const transact = vi.fn(async (callback: (scope: unknown) => unknown) => callback(tx)) as unknown as typeof withTransaction;
  return { tx, transact };
}

describe("durable login attempt reservation", () => {
  beforeEach(() => {
    vi.stubEnv("BFI_COOKIE_SECRET", "test-only-login-scope-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("hashes and bounds identifier aliases and clients without persisting either value", async () => {
    expect(loginLimitSubjects(" Person@Example.COM ", headers())).toEqual(loginLimitSubjects("person@example.com", headers()));
    expect(loginLimitSubjects("person@example.com", headers("not-an-ip"))).toHaveLength(1);
    expect(loginLimitSubjects("person@example.com", new Headers({ "x-real-ip": "2001:db8::1" }))).toHaveLength(2);
    expect(loginLimitSubjects("person@example.com", headers("203.0.113.9, 192.0.2.1"))).toEqual(loginLimitSubjects("person@example.com", headers("203.0.113.9")));
    expect(() => loginLimitSubjects("x".repeat(321), headers())).toThrow();
    expect(() => loginLimitSubjects("user\u0000@example.com", headers())).toThrow();
    const { tx, transact } = storage(0);
    expect(await reserveLoginAttempt("person@example.com", headers("203.0.113.9"), transact)).toBe("allowed");
    const inputs = JSON.stringify(tx.mock.calls);
    expect(inputs).not.toContain("person@example.com");
    expect(inputs).not.toContain("203.0.113.9");
  });

  it("locks both scopes before a separate count and durable reservation", async () => {
    const { tx, transact } = storage(LOGIN_ATTEMPT_LIMITS.identifier - 1);
    expect(await reserveLoginAttempt("person@example.com", headers("203.0.113.9"), transact)).toBe("allowed");
    const queries = tx.mock.calls.map(([parts]) => parts.join("?"));
    expect(queries.filter((query) => query.includes("pg_advisory_xact_lock"))).toHaveLength(2);
    expect(queries.findIndex((query) => query.includes("COUNT(*)"))).toBeGreaterThan(queries.findLastIndex((query) => query.includes("pg_advisory_xact_lock")));
    expect(queries.at(-1)).toContain("RETURNING subject_key");
  });

  it("blocks at the allowance without a new reservation", async () => {
    const { tx, transact } = storage(LOGIN_ATTEMPT_LIMITS.identifier);
    expect(await reserveLoginAttempt("person@example.com", headers("203.0.113.9"), transact)).toBe("limited");
    expect(tx.mock.calls.some(([parts]) => parts.join("").includes("INSERT INTO"))).toBe(false);
  });

  it.each(["count", "insert"] as const)("fails closed when the %s fails without logging inputs", async (failure) => {
    const { transact } = storage(0, failure);
    expect(await reserveLoginAttempt("person@example.com", headers("203.0.113.9"), transact)).toBe("unavailable");
    expect(console.error).toHaveBeenCalledWith("Login attempt reservation unavailable");
    expect(console.error).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("fails closed when a reservation was not actually persisted", async () => {
    const transact = (async (callback: (scope: unknown) => unknown) => callback(vi.fn(async () => []))) as unknown as typeof withTransaction;
    expect(await reserveLoginAttempt("person@example.com", headers(), transact)).toBe("unavailable");
  });

  it("fails closed when the transaction cannot commit its reservation", async () => {
    const { tx } = storage(0);
    const transact = (async (callback: (scope: unknown) => unknown) => {
      await callback(tx);
      throw new Error("commit failed");
    }) as unknown as typeof withTransaction;
    expect(await reserveLoginAttempt("person@example.com", headers("203.0.113.9"), transact)).toBe("unavailable");
  });
});
