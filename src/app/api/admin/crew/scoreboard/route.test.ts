// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), execute: vi.fn(), user: vi.fn(), permission: vi.fn(), audit: vi.fn(), limited: vi.fn(),
}));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: mocks.start }));
vi.mock("@/lib/agents/run-to-end", () => ({ executeAgentRunToEnd: mocks.execute }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, hasPermission: mocks.permission }));
vi.mock("@/lib/api-hardening/audit", () => ({ recordApiRouteAuditEvent: mocks.audit, getRequestSubjectKey: () => "scoreboard-fixture" }));
vi.mock("@/lib/api-hardening/rate-limit", () => ({ isRateLimited: mocks.limited }));

// Exercise the actual policy wrapper and timing-safe signed cron helper.
import { GET, maxDuration } from "./route";

const STEPS = ["score-answer-key", "deming-regression", "deming-fresh-audit", "deming-benchmark-health",
  "deming-playbook-check", "deming-data-quality", "deming-source-health", "deming-filings-reconcile", "scoreboard-snapshot",
  "deming-change-outcomes", "deming-error-fix-recheck", "deming-error-classes", "deming-monthly-review", "deming-sunday-maintenance", "deming-live-source-draw", "atlas-lesson-sync", "atlas-city-repair", "atlas-storage-retention"];
const request = (headers: Record<string, string> = { authorization: "Bearer synthetic-scoreboard-cron" }) =>
  new NextRequest("https://feeinsight.com/api/admin/crew/scoreboard", { headers });

describe("daily scoreboard request queues bounded ledger work", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "synthetic-scoreboard-cron");
    vi.stubEnv("REPORT_CRON_SECRET", "");
    vi.stubEnv("BFI_REVALIDATE_TOKEN", "");
    mocks.audit.mockResolvedValue(undefined);
    mocks.limited.mockResolvedValue(false);
    mocks.user.mockResolvedValue(null);
    mocks.permission.mockReturnValue(false);
    mocks.start.mockResolvedValue({ run: { id: 17, status: "queued" }, steps: [], reused: false });
    // An inline regression must fail quickly, without source work.
    mocks.execute.mockRejectedValue(new Error("Scoreboard must be advanced by its tick"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T00:00:01.000Z"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(["authorization", "x-cron-secret"])("accepts the real signed %s and returns pending without executing", async (header) => {
    const response = await GET(request({ [header]: "Bearer synthetic-scoreboard-cron" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: 17, reused: false, pending: true, leftQueued: true,
      result: { status: "queued", terminal: false, executedSteps: 0, message: expect.stringContaining("queued") } });
    expect(maxDuration).toBe(60);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agent: "atlas", kind: "workflow",
      params: { source: "atlas.scoreboard" }, idempotencyKey: "atlas:scoreboard:2026-10-19", reuseTerminal: true }));
    expect(mocks.start.mock.calls[0][0].steps.map((step: { key: string }) => step.key)).toEqual(STEPS);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200, outcome: "success",
      policy: expect.objectContaining({ routeId: "api.admin.crew.scoreboard", authRequirement: "cron_or_admin" }) }));
  });

  it.each(["queued", "running", "cancel_requested"])("reports reused %s honestly", async (status) => {
    mocks.start.mockResolvedValue({ run: { id: 17, status }, steps: [], reused: true });
    const response = await GET(request());
    const body = await response.json();
    expect(body).toMatchObject({ runId: 17, reused: true, pending: true, leftQueued: true,
      result: { status, terminal: false, executedSteps: 0 } });
    expect(body.result.message).not.toMatch(/already ran|completed/i);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["complete", "completed", "failed", "cancelled", "blocked"])("reports existing terminal %s without rerunning", async (status) => {
    mocks.start.mockResolvedValue({ run: { id: 17, status }, steps: [], reused: true });
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ reused: true, pending: false, leftQueued: false, result: { status, terminal: true, executedSteps: 0 } });
    expect(body.result.message).toContain(status === "complete" ? "completed" : status);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("allows an authenticated job operator, refusing other users and invalid cron signatures", async () => {
    mocks.user.mockResolvedValue({ id: 5 });
    expect((await GET(request({ authorization: "Bearer incorrect" }))).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.permission).toHaveBeenCalledWith({ id: 5 }, "trigger_jobs");
    mocks.permission.mockReturnValue(true);
    expect((await GET(request({}))).status).toBe(200);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("keeps policy rate limiting ahead of any run creation", async () => {
    mocks.limited.mockResolvedValue(true);
    expect((await GET(request())).status).toBe(429);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("uses the UTC day across the local-date boundary", async () => {
    vi.setSystemTime(new Date("2026-10-19T23:59:59.000Z"));
    await GET(request());
    vi.setSystemTime(new Date("2026-10-20T00:00:01.000Z"));
    await GET(request());
    expect(mocks.start.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(["atlas:scoreboard:2026-10-19", "atlas:scoreboard:2026-10-20"]);
  });
});
