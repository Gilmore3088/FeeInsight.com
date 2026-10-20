import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HMDA_IDENTITY_REPAIR_SOURCE, HMDA_REPAIR_MANIFEST_DIGEST } from "@/lib/agents/hoovie/hmda-identity-repair";
import { HMDA_REPAIR_WRITES_ENABLED } from "@/lib/agents/hoovie/hmda-repair-release";

const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), start: vi.fn(), execute: vi.fn(), agent: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, hasPermission: mocks.permission }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: mocks.start, executeAgentRun: mocks.execute }));
vi.mock("@/lib/agents/registry-scheduler", () => ({ registryLedgerAgent: mocks.agent }));

const { POST } = await import("./route");
const preview = { source: HMDA_IDENTITY_REPAIR_SOURCE, mode: "preview", manifest_digest: HMDA_REPAIR_MANIFEST_DIGEST };
const request = (body: unknown = preview, headers: Record<string, string> = {}) => new NextRequest("https://feeinsight.com/api/admin/registry/hmda-identity-repair", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

describe("POST /api/admin/registry/hmda-identity-repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: 7 });
    mocks.permission.mockReturnValue(true);
    mocks.agent.mockResolvedValue({ agent: "hoovie" });
    mocks.start.mockResolvedValue({ run: { id: 2253, status: "queued" }, reused: false });
  });

  it("queues the pinned preview for explicit manual execution without executing it", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(mocks.permission).toHaveBeenCalledWith({ id: 7 }, "trigger_jobs");
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      agent: "hoovie", kind: "dry_run", params: preview, triggerSource: "admin", triggeredBy: "admin:7",
      idempotencyKey: `hmda:identity:${HMDA_REPAIR_MANIFEST_DIGEST}:preview`, reuseTerminal: true,
      steps: [expect.objectContaining({ key: "hmda-identity-repair", agent: "hoovie", input: preview })],
    }));
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, runId: 2253, mode: "preview", manualExecutionRequired: true,
      manifestDigest: HMDA_REPAIR_MANIFEST_DIGEST });
  });

  it("retains the visible registry-ledger fallback when Hoovie's row is unavailable", async () => {
    mocks.agent.mockResolvedValue({ agent: "magellan", fallback: "hoovie row missing" });
    await POST(request());
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ agent: "magellan",
      params: { ...preview, ledger_agent_fallback: "hoovie row missing" },
      steps: [expect.objectContaining({ agent: "magellan" })] }));
  });

  it("returns a reused terminal run without creating or executing a second repair", async () => {
    mocks.start.mockResolvedValue({ run: { id: 2253, status: "completed" }, reused: true });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ runId: 2253, status: "completed", reused: true });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["apply", "rollback"])("refuses %s while the actual write release is disabled", async (mode) => {
    expect(HMDA_REPAIR_WRITES_ENABLED).toBe(false);
    const response = await POST(request({ ...preview, mode, authorization_reference: "test-authorization-reference",
      ...(mode === "rollback" ? { apply_event_id: 123 } : {}) }));
    expect(response.status).toBe(423);
    expect(mocks.agent).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not accept cron credentials in place of an admin session", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await POST(request(preview, { authorization: "Bearer cron-token", "x-cron-secret": "cron-token" }));
    expect(response.status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("refuses an authenticated user without trigger permission", async () => {
    mocks.permission.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ...preview, mode: "reaggregate" },
    { ...preview, mode: ["apply"], authorization_reference: "test-authorization-reference" },
    { ...preview, authorization_reference: { reviewed: true } },
    { ...preview, source: "magellan.registry" },
    { ...preview, manifest_digest: "0".repeat(64) },
    { ...preview, mode: "apply" },
    { ...preview, mode: "rollback", authorization_reference: "test-authorization-reference" },
    { ...preview, manifest: { cohort: [] } },
  ])("refuses malformed or widened configuration: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each(["{", "", JSON.stringify({ ...preview, padding: "x".repeat(4_096) })])("refuses invalid or oversized JSON before queueing", async (body) => {
    const response = await POST(new NextRequest("https://feeinsight.com/api/admin/registry/hmda-identity-repair", { method: "POST", body }));
    expect(response.status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized body before requesting a stream reader", async () => {
    const input = request(preview, { "content-length": "4097" });
    const reader = vi.spyOn(input.body!, "getReader");
    expect((await POST(input)).status).toBe(400);
    expect(reader).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("cancels an oversized stream with absent or understated content length: %s", async (declared) => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"padding":"'));
        controller.enqueue(encoder.encode("x".repeat(4_096)));
      },
      cancel,
    });
    const input = new NextRequest("https://feeinsight.com/api/admin/registry/hmda-identity-repair", {
      method: "POST", headers: declared ? { "content-length": declared } : {}, body,
      duplex: "half",
    } as NonNullable<ConstructorParameters<typeof NextRequest>[1]> & { duplex: "half" });
    const text = vi.spyOn(input, "text");
    expect((await POST(input)).status).toBe(400);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("queues valid configuration split across stream chunks without a length header", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(preview));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 23)); controller.enqueue(bytes.slice(23)); controller.close();
    } });
    const input = new NextRequest("https://feeinsight.com/api/admin/registry/hmda-identity-repair", {
      method: "POST", body, duplex: "half",
    } as NonNullable<ConstructorParameters<typeof NextRequest>[1]> & { duplex: "half" });
    expect((await POST(input)).status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ params: preview }));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
