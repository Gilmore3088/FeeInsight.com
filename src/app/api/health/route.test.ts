// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  audit: vi.fn(async () => {}),
  rateLimited: vi.fn(async () => false),
  cached: new Map<string, unknown>(),
  registrations: [] as Array<{ key: string[]; options: { revalidate?: number; tags?: string[] } }>,
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/api-hardening/audit", () => ({ recordApiRouteAuditEvent: mocks.audit, getRequestSubjectKey: () => "fixture" }));
vi.mock("@/lib/api-hardening/rate-limit", () => ({ isRateLimited: mocks.rateLimited }));
vi.mock("next/cache", () => ({
  // As with the existing shared-cache tests, only successful reads are retained.
  unstable_cache: <A extends unknown[], R>(read: (...args: A) => Promise<R>, key: string[], options: { revalidate?: number; tags?: string[] }) => {
    mocks.registrations.push({ key, options });
    return async (...args: A): Promise<R> => {
      const id = JSON.stringify([key, args]);
      if (mocks.cached.has(id)) return mocks.cached.get(id) as R;
      const value = await read(...args);
      mocks.cached.set(id, value);
      return value;
    };
  },
}));

// Keep the real public-cache and route-policy wrappers: assertions cover their
// registration, ping/count behavior and audit status without a database/network.
import { GET } from "./route";

const GENERIC = { status: "error", message: "Service temporarily unavailable" };
const SECRET = "postgresql://fixture_user:fixture_secret@internal.example:5432/db SELECT private_table; synthetic stack/cause";
const query = (parts: TemplateStringsArray) => parts.join(" ");
const callsFor = (fragment: string) => mocks.sql.mock.calls.filter(([parts]) => query(parts).includes(fragment));

describe("public health response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cached.clear();
    mocks.rateLimited.mockResolvedValue(false);
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => query(parts).includes("COUNT(*)") ? [{ cnt: 42 }] : [{ one: 1 }]);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function failAt(stage: "database_ping" | "live_fee_count", error: unknown) {
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
      if ((stage === "live_fee_count") === query(parts).includes("COUNT(*)")) throw error;
      return [{ one: 1 }];
    });
  }

  it.each(["database_ping", "live_fee_count"] as const)("keeps %s exception details private with bounded useful diagnostics", async (stage) => {
    const error = Object.assign(new Error(SECRET), { code: "28P01", cause: new Error(SECRET), query: SECRET });
    failAt(stage, error);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(GENERIC);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Health check failed", { stage, code: "28P01" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(SECRET);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ routeId: "api.health", authRequirement: "public" }), statusCode: 503, outcome: "error", metadata: {} }));
    expect(callsFor("SELECT 1")).toHaveLength(1);
    expect(callsFor("COUNT(*)")).toHaveLength(stage === "database_ping" ? 0 : 1);
  });

  it.each(["database_ping", "live_fee_count"] as const)("handles unusual %s throws without reading messages or coercing them", async (stage) => {
    const stringify = vi.fn(() => { throw new Error("toString must not be called"); });
    const values = [
      SECRET, null, undefined, 123, Symbol("synthetic secret"),
      { toString: stringify },
      Object.defineProperty({}, "code", { get() { throw new Error("getter synthetic secret"); } }),
      new Proxy({}, { get() { throw new Error("proxy synthetic secret"); }, getPrototypeOf() { throw new Error("prototype synthetic secret"); }, ownKeys() { throw new Error("keys synthetic secret"); } }),
    ];
    for (const value of values) {
      failAt(stage, value);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(GENERIC);
      expect(console.error).toHaveBeenLastCalledWith("Health check failed", { stage, code: "unknown" });
    }
    expect(stringify).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(5000), SECRET, "ECONNREFUSED\nSQL secret", "28P01\n", "28P01\r", "28P01\u2028", "28P01\0", "lowercase", { toString() { throw new Error("do not coerce code"); } }])("discards unsafe or oversized diagnostic codes", async (code) => {
    failAt("database_ping", { code, message: SECRET });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(GENERIC);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Health check failed", { stage: "database_ping", code: "unknown" });
  });

  it("retains a valid Node error code and stays generic if logging itself fails", async () => {
    failAt("database_ping", { code: "ECONNREFUSED", message: SECRET });
    expect((await GET()).status).toBe(503);
    expect(console.error).toHaveBeenLastCalledWith("Health check failed", { stage: "database_ping", code: "ECONNREFUSED" });
    vi.mocked(console.error).mockImplementation(() => { throw new Error(SECRET); });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(GENERIC);
  });

  it.each([0, 42])("preserves successful count %i, timestamp, public wrapper and cached aggregate", async (count) => {
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => query(parts).includes("COUNT(*)") ? [{ cnt: String(count) }] : [{ one: 1 }]);
    for (let i = 0; i < 2; i++) {
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ok", fee_count: count, timestamp: expect.any(String) });
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    }
    expect(callsFor("SELECT 1")).toHaveLength(2);
    expect(callsFor("COUNT(*)")).toHaveLength(1);
    expect(mocks.registrations.find(({ key }) => key.includes("health-live-fee-count"))?.options).toEqual({ revalidate: 3600, tags: ["public-fee-reads"] });
    expect(mocks.rateLimited).toHaveBeenCalledWith(expect.objectContaining({ routeId: "api.health", authRequirement: "public", rateLimitBucket: "health" }), "fixture");
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 200, outcome: "success" }));
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["database_ping", "live_fee_count"] as const)("recovers after a %s failure without caching the failure", async (stage) => {
    failAt(stage, new Error(SECRET));
    expect((await GET()).status).toBe(503);
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => query(parts).includes("COUNT(*)") ? [{ cnt: 12 }] : [{ one: 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", fee_count: 12 });
    expect((await GET()).status).toBe(200);
    expect(callsFor("SELECT 1")).toHaveLength(3);
    expect(callsFor("COUNT(*)")).toHaveLength(stage === "live_fee_count" ? 2 : 1);
  });

  it("still treats a failed ping as unhealthy when a good count is already cached", async () => {
    expect((await GET()).status).toBe(200);
    failAt("database_ping", new Error(SECRET));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(GENERIC);
    expect(callsFor("SELECT 1")).toHaveLength(2);
    expect(callsFor("COUNT(*)")).toHaveLength(1);
  });
});
