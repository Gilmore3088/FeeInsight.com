import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cookieJar = new Map<string, string>();
  const setCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const queries: string[] = [];
  let nextRows: unknown[] = [];
  let txError: unknown = null;

  function makeSql() {
    const fn = (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      const rows = nextRows;
      const promise = Promise.resolve(rows);
      return Object.assign(promise, { catch: promise.catch.bind(promise) });
    };
    return fn;
  }

  return {
    cookieJar,
    setCalls,
    queries,
    setRows(rows: unknown[]) {
      nextRows = rows;
    },
    setTxError(error: unknown) {
      txError = error;
    },
    sql: makeSql(),
    withTransaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      if (txError) throw txError;
      return cb(makeSql());
    }),
    cookies: vi.fn(async () => ({
      get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
      set: (name: string, value: string, options: Record<string, unknown>) => {
        setCalls.push({ name, value, options });
        cookieJar.set(name, value);
      },
      delete: (name: string) => cookieJar.delete(name),
    })),
  };
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sql,
  withTransaction: mocks.withTransaction,
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/passwords", () => ({
  hashPassword: vi.fn(async () => "hashed"),
  verifyPassword: vi.fn(async () => ({ valid: true })),
}));

const DAY = 24 * 60 * 60 * 1000;

describe("session lifetime", () => {
  beforeEach(() => {
    mocks.cookieJar.clear();
    mocks.setCalls.length = 0;
    mocks.queries.length = 0;
    mocks.setRows([]);
    mocks.setTxError(null);
  });

  it("renews only when fewer than 15 days remain", async () => {
    const { shouldRenewSession } = await import("./auth");
    const now = Date.UTC(2026, 9, 3);
    expect(shouldRenewSession(new Date(now + 10 * DAY), now)).toBe(true);
    expect(shouldRenewSession(new Date(now + 20 * DAY), now)).toBe(false);
    expect(shouldRenewSession(null, now)).toBe(false);
    expect(shouldRenewSession("not a date", now)).toBe(false);
  });

  it("login issues a 30-day session cookie", async () => {
    mocks.setRows([{ id: 4, username: "a@b.com", password_hash: "x", role: "viewer" }]);
    const { login, SESSION_COOKIE } = await import("./auth");
    await login("a@b.com", "password1");
    const set = mocks.setCalls.find((c) => c.name === SESSION_COOKIE);
    expect(set?.options.maxAge).toBe(30 * 24 * 60 * 60);
    expect(mocks.queries.some((q) => q.includes("INSERT INTO sessions"))).toBe(true);
  });

  it("slides the session row when it is close to expiry, and not otherwise", async () => {
    const { getCurrentUser, issueSession, SESSION_COOKIE } = await import("./auth");
    const { signed } = await issueSession(4);
    mocks.cookieJar.set(SESSION_COOKIE, signed);

    mocks.queries.length = 0;
    mocks.setRows([{ id: 4, role: "viewer", session_expires_at: new Date(Date.now() + 5 * DAY) }]);
    const user = await getCurrentUser();
    expect(user).not.toHaveProperty("session_expires_at");
    expect(mocks.queries.some((q) => q.includes("UPDATE sessions SET expires_at"))).toBe(true);

    mocks.queries.length = 0;
    mocks.setRows([{ id: 4, role: "viewer", session_expires_at: new Date(Date.now() + 25 * DAY) }]);
    await getCurrentUser();
    expect(mocks.queries.some((q) => q.includes("UPDATE sessions SET expires_at"))).toBe(false);
  });

  it("renewSessionCookie re-issues a valid cookie and ignores a missing one", async () => {
    const { renewSessionCookie, issueSession, SESSION_COOKIE } = await import("./auth");
    await renewSessionCookie();
    expect(mocks.setCalls).toHaveLength(0);

    const { signed } = await issueSession(9);
    mocks.cookieJar.set(SESSION_COOKIE, signed);
    await renewSessionCookie();
    expect(mocks.setCalls).toHaveLength(1);
    expect(mocks.setCalls[0].value).toBe(signed);
    expect(mocks.setCalls[0].options.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("rejects a tampered cookie on renewal", async () => {
    const { renewSessionCookie, SESSION_COOKIE } = await import("./auth");
    mocks.cookieJar.set(SESSION_COOKIE, `abc.${"0".repeat(64)}`);
    await renewSessionCookie();
    expect(mocks.setCalls).toHaveLength(0);
  });
});

describe("createUserWithSession", () => {
  beforeEach(() => {
    mocks.cookieJar.clear();
    mocks.setCalls.length = 0;
    mocks.queries.length = 0;
    mocks.setTxError(null);
  });

  it("creates the user and session, then signs the reader in", async () => {
    mocks.setRows([{ id: 31 }]);
    const { createUserWithSession, SESSION_COOKIE } = await import("./auth");
    const result = await createUserWithSession({ email: " Reader@Example.com ", password: "password1", displayName: "Reader" });
    expect(result).toEqual({ ok: true, userId: 31 });
    expect(mocks.setCalls.map((c) => c.name)).toEqual([SESSION_COOKIE]);
  });

  it("reports a duplicate email without setting a cookie", async () => {
    mocks.setTxError(Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }));
    const { createUserWithSession } = await import("./auth");
    const result = await createUserWithSession({ email: "a@b.com", password: "password1", displayName: "A" });
    expect(result).toMatchObject({ ok: false, code: "duplicate" });
    expect(mocks.setCalls).toHaveLength(0);
  });
});
