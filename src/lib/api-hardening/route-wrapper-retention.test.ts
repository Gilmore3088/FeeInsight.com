import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ audit: vi.fn(), retain: vi.fn(), limited: vi.fn(), policy: vi.fn() }));
vi.mock("./audit", () => ({ recordApiRouteAuditEvent: calls.audit, getRequestSubjectKey: () => null }));
vi.mock("./rate-limit", () => ({ isRateLimited: calls.limited }));
vi.mock("./policies", () => ({ getApiRoutePolicy: calls.policy }));
// Exercise the existing retention helper through its actual Next lifecycle boundary.
vi.mock("next/server", () => ({ after: calls.retain }));
import { withApiRoutePolicy } from "./route-wrapper";

describe("route audit response lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks(); calls.limited.mockResolvedValue(false);
    calls.policy.mockReturnValue({ routeId: "test", routeTemplate: "/api/test", allowedMethods: ["GET"], surface: "admin" });
  });
  it.each(["admin", "public", "v1"])("retains one existing %s success audit without holding the response", async surface => {
    calls.policy.mockReturnValue({ surface });
    let finish!: () => void;
    const audit = new Promise<void>(resolve => { finish = resolve; }); calls.audit.mockReturnValue(audit);
    const response = new Response("ok");
    expect(await withApiRoutePolicy("test", "GET", async () => response)()).toBe(response);
    expect(calls.audit).toHaveBeenCalledTimes(1); expect(calls.retain).toHaveBeenCalledTimes(1);
    const retained = calls.retain.mock.calls[0][0]; finish(); await expect(retained).resolves.toBeUndefined();
  });
  it("retains the existing non-v1 failure audit while propagating the same handler error", async () => {
    const error = new Error("handler failed");
    let finish!: () => void;
    calls.audit.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    await expect(withApiRoutePolicy("test", "GET", async () => { throw error; })()).rejects.toBe(error);
    expect(calls.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusCode: 500, outcome: "error" }));
    expect(calls.retain).toHaveBeenCalledTimes(1);
    finish();
    await expect(calls.retain.mock.calls[0][0]).resolves.toBeUndefined();
  });
  it("keeps the rate-limit audit awaited once, without adding a background duplicate", async () => {
    calls.limited.mockResolvedValue(true);
    let finish!: () => void, answered = false;
    calls.audit.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const handler = vi.fn();
    const response = Promise.resolve(withApiRoutePolicy("test", "GET", handler)()).then(value => { answered = true; return value; });
    await Promise.resolve();
    expect(calls.audit).toHaveBeenCalledTimes(1); expect(answered).toBe(false);
    finish(); const result = await response;
    expect(result.status).toBe(429); expect(handler).not.toHaveBeenCalled();
    expect(calls.audit).toHaveBeenCalledTimes(1); expect(calls.retain).not.toHaveBeenCalled();
  });
  it("retains the already-handled audit rejection without an unhandled rejection or duplicate write", async () => {
    const unhandled = vi.fn(); process.on("unhandledRejection", unhandled);
    try {
      let reject!: (error: Error) => void;
      calls.audit.mockReturnValue(new Promise<void>((_resolve, no) => { reject = no; }));
      expect((await withApiRoutePolicy("test", "GET", () => new Response("ok"))()).status).toBe(200);
      reject(new Error("writer already logged SQL failure"));
      await expect(calls.retain.mock.calls[0][0]).resolves.toBeUndefined();
      expect(calls.audit).toHaveBeenCalledTimes(1); expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off("unhandledRejection", unhandled); }
  });
  it("preserves success outside a valid request without starting the audit again", async () => {
    calls.retain.mockImplementationOnce(() => { throw new Error("outside request"); });
    calls.audit.mockResolvedValue(undefined);
    expect((await withApiRoutePolicy("test", "GET", () => new Response("ok"))()).status).toBe(200);
    expect(calls.retain).toHaveBeenCalledTimes(1); expect(calls.audit).toHaveBeenCalledTimes(1);
  });
  it("keeps a cookieless early response free of audit and rate-limit work", async () => {
    const response = new Response("signed out"), handler = vi.fn();
    expect(await withApiRoutePolicy("test", "GET", handler, { answerWithoutDatabase: () => response })()).toBe(response);
    expect(handler).not.toHaveBeenCalled(); expect(calls.audit).not.toHaveBeenCalled();
    expect(calls.retain).not.toHaveBeenCalled(); expect(calls.limited).not.toHaveBeenCalled();
  });
});
