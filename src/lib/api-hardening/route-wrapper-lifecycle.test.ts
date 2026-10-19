import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock, auditMock } = vi.hoisted(() => ({ afterMock: vi.fn(), auditMock: vi.fn() }));
vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("./audit", () => ({
  getRequestSubjectKey: () => "subject",
  recordApiRouteAuditEvent: auditMock,
}));
vi.mock("./rate-limit", () => ({ isRateLimited: vi.fn().mockResolvedValue(false) }));

import { withApiRoutePolicy } from "./route-wrapper";

function pendingAudit() {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  auditMock.mockReturnValue(new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }));
  return { finish, fail };
}

describe("v1 route audit lifetime", () => {
  beforeEach(() => {
    afterMock.mockReset();
    auditMock.mockReset();
  });

  it.each([
    [200, "application/json", '{"total":0,"data":[]}'],
    [200, "text/csv", "category,median\noverdraft,30"],
    [400, "application/json", '{"code":"invalid_parameter"}'],
    [401, "application/json", '{"code":"api_key_required"}'],
    [403, "application/json", '{"code":"plan_required"}'],
  ])("returns the original %s %s response while its one audit write remains pending", async (status, contentType, body) => {
    const audit = pendingAudit();
    const response = new Response(body, { status, headers: { "Content-Type": contentType } });
    const handler = withApiRoutePolicy("api.v1.index", "GET", () => response);

    expect(await handler()).toBe(response);
    expect(await response.text()).toBe(body);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledTimes(1);
    const task = afterMock.mock.calls[0][0];
    expect(task).toBeInstanceOf(Promise);
    audit.finish();
    await task;
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("handles an audit failure after returning the original response", async () => {
    const audit = pendingAudit();
    const response = new Response("ok");
    expect(await withApiRoutePolicy("api.v1.index", "GET", () => response)()).toBe(response);

    audit.fail(new Error("CONNECT_TIMEOUT"));
    await expect(afterMock.mock.calls[0][0]).resolves.toBeUndefined();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("retains the error audit without replacing the handler exception", async () => {
    const audit = pendingAudit();
    const error = new Error("Data unavailable");
    const handler = withApiRoutePolicy("api.v1.index", "GET", () => { throw error; });

    await expect(handler()).rejects.toBe(error);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, reasonCode: "route_handler_exception" }));
    audit.fail(new Error("CONNECT_TIMEOUT"));
    await expect(afterMock.mock.calls[0][0]).resolves.toBeUndefined();
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("runs the same handled task once outside a Next request", async () => {
    const audit = pendingAudit();
    afterMock.mockImplementation(() => { throw new Error("No request context"); });
    const response = new Response("ok");

    expect(await withApiRoutePolicy("api.v1.index", "GET", () => response)()).toBe(response);
    audit.finish();
    await afterMock.mock.calls[0][0];
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the existing background behavior outside v1", async () => {
    const audit = pendingAudit();
    const response = new Response("ok");

    expect(await withApiRoutePolicy("api.session", "GET", () => response)()).toBe(response);
    expect(afterMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
    audit.finish();
    await auditMock.mock.results[0].value;
  });
});
