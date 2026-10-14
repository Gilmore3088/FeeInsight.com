import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startAgentRunMock = vi.fn();
const executeAgentRunMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => null),
  hasPermission: vi.fn(() => false),
}));

vi.mock("@/lib/cron-secret", () => ({
  matchesConfiguredCronSecret: vi.fn(() => true),
}));

vi.mock("@/lib/agents/run-store", () => ({
  startAgentRun: startAgentRunMock,
  executeAgentRun: executeAgentRunMock,
}));

/**
 * agent_runs has no `source` column: a run's source is `params_json->>'source'` (the tick and
 * the board read it there). The daily contacts run is found by `params_json->>'source' = 'growth.contacts'`.
 */
describe("the daily contacts run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 3524, status: "queued" } });
    executeAgentRunMock.mockResolvedValue({ runId: 3524, status: "completed", terminal: true, executedSteps: 2 });
  });

  it("starts under growth with source growth.contacts in its params", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://feeinsight.com/api/admin/crew/contacts?limit=60"));
    expect(response.status).toBe(200);
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input.agent).toBe("growth");
    expect(input.params).toMatchObject({ source: "growth.contacts", agent: "nielsen", limit: 60 });
    expect(input.triggeredBy).toBe("growth.contacts");
    expect(input.triggerSource).toBe("schedule");
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual(["growth-contacts", "growth-contact-picks"]);
    expect(input.idempotencyKey).toMatch(/^growth:contacts:\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});
