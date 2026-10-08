import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startAgentRunMock = vi.fn();
const executeAgentRunMock = vi.fn();
const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
  hasPermission: vi.fn(() => true),
}));

vi.mock("@/lib/cron-secret", () => ({
  matchesConfiguredCronSecret: vi.fn(() => true),
}));

vi.mock("@/lib/agents/run-store", () => ({
  startAgentRun: startAgentRunMock,
  executeAgentRun: executeAgentRunMock,
}));

vi.mock("@/lib/agents/marketing/monthly", () => ({
  currentMonth: () => "2026-11",
}));

/** Growth's marketing workflows run as agent growth; their idempotency keys are unchanged. */
describe("growth's marketing workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 7, status: "queued" } });
    executeAgentRunMock.mockResolvedValue({ runId: 7, status: "completed", terminal: true, executedSteps: 2 });
    getCurrentUserMock.mockResolvedValue({ id: 1, email: "james@example.com" });
  });

  it("starts the monthly marketing run under growth", async () => {
    const { GET } = await import("./route");
    await GET(new NextRequest("https://feeinsight.com/api/admin/crew/marketing"));
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.agent).toBe("growth");
    expect(input.steps.map((step: { agent: string }) => step.agent)).toEqual(["growth", "growth", "growth"]);
    expect(input.idempotencyKey).toBe("hamilton:marketing:2026-11");
  });

  it("starts the weekly content run under growth", async () => {
    const { GET } = await import("../content/route");
    await GET(new NextRequest("https://feeinsight.com/api/admin/crew/content"));
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.agent).toBe("growth");
    expect(input.steps.map((step: { key: string; agent: string }) => [step.key, step.agent])).toEqual([
      ["content-market-spread", "growth"],
      ["content-fee-depth", "growth"],
    ]);
    expect(input.idempotencyKey).toMatch(/^hamilton:content:\d{4}-\d{2}-\d{2}$/);
  });

  it("sends an approved month under growth with the same key as before", async () => {
    const { POST } = await import("../../marketing/approve/route");
    const body = new FormData();
    body.set("month", "2026-11");
    await POST(new NextRequest("https://feeinsight.com/api/admin/marketing/approve", { method: "POST", body }));
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.agent).toBe("growth");
    expect(input.steps).toEqual([expect.objectContaining({ key: "marketing-send", agent: "growth" })]);
    expect(input.idempotencyKey).toBe("hamilton:marketing-send:2026-11");
  });
});
