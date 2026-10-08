import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startAgentRunMock = vi.fn();
const executeAgentRunMock = vi.fn();
const getCurrentUserMock = vi.fn();
const cronSecretMock = vi.fn();
const findRecentQueueItemMock = vi.fn();
const recentLessonsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
  hasPermission: vi.fn(() => true),
}));

vi.mock("@/lib/cron-secret", () => ({
  matchesConfiguredCronSecret: cronSecretMock,
}));

vi.mock("@/lib/agents/run-store", () => ({
  startAgentRun: startAgentRunMock,
  executeAgentRun: executeAgentRunMock,
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

vi.mock("@/lib/data-store/content-drafts", () => ({
  findRecentQueueItem: findRecentQueueItemMock,
}));

vi.mock("@/lib/agents/growth/lessons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/growth/lessons")>()),
  recentLessons: recentLessonsMock,
}));

function post(body: unknown, secret = true) {
  cronSecretMock.mockReturnValue(secret);
  return new NextRequest("https://feeinsight.com/api/admin/growth/intake", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ITEM = {
  agent: "norman",
  kind: "pull_request",
  title: "Shorter report request form",
  body: "Cuts the form to three fields.",
  pr_url: "https://github.com/acme/feeinsight/pull/541",
};

describe("POST /api/admin/growth/intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(null);
    startAgentRunMock.mockResolvedValue({ reused: false, run: { id: 31, status: "queued" } });
    executeAgentRunMock.mockResolvedValue({ runId: 31, status: "completed", terminal: true, executedSteps: 1, message: "done" });
    findRecentQueueItemMock.mockResolvedValue(77);
  });

  it("refuses a caller without the cron secret or an admin session", async () => {
    const { POST } = await import("./route");
    const response = await POST(post(ITEM, false));
    expect(response.status).toBe(401);
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("files an item as a growth run with one intake step", async () => {
    const { POST } = await import("./route");
    const response = await POST(post(ITEM));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, runId: 31, status: "completed", draftId: 77 });

    const input = startAgentRunMock.mock.calls[0][0];
    expect(input).toMatchObject({
      agent: "growth",
      kind: "workflow",
      triggeredBy: "growth.intake",
      triggerSource: "api",
      idempotencyKey: "growth:intake:norman:pull_request:https://github.com/acme/feeinsight/pull/541",
    });
    expect(input.steps).toEqual([
      expect.objectContaining({
        key: "growth-intake",
        agent: "growth",
        input: {
          item: {
            agent: "norman",
            kind: "pull_request",
            title: "Shorter report request form",
            body: "Cuts the form to three fields.",
            pr_url: "https://github.com/acme/feeinsight/pull/541",
            subject_key: "https://github.com/acme/feeinsight/pull/541",
          },
        },
      }),
    ]);
    expect(executeAgentRunMock).toHaveBeenCalledWith(31, { maxSteps: 1 });
  });

  it("refuses an invalid item before any run starts, with every reason", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ agent: "hamilton", kind: "pull_request", title: "x", body: "y", contact_email: "a@b.com" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.errors.length).toBeGreaterThanOrEqual(3);
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const { POST } = await import("./route");
    expect((await POST(post("not json"))).status).toBe(400);
  });

  it("answers 202 when the marketing pause holds the run", async () => {
    executeAgentRunMock.mockResolvedValue({ runId: 31, status: "queued", terminal: false, executedSteps: 0, message: "Marketing is paused; run left queued." });
    const { POST } = await import("./route");
    const response = await POST(post(ITEM));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued", draftId: null });
    expect(findRecentQueueItemMock).not.toHaveBeenCalled();
  });

  it("reports a failed filing as a failure", async () => {
    executeAgentRunMock.mockResolvedValue({ runId: 31, status: "failed", terminal: true, executedSteps: 1, message: "Filed nothing" });
    const { POST } = await import("./route");
    const response = await POST(post(ITEM));
    expect(response.status).toBe(500);
    expect((await response.json()).ok).toBe(false);
  });
});

describe("GET /api/admin/growth/intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(null);
    cronSecretMock.mockReturnValue(true);
  });

  it("returns an agent's lessons for its brief", async () => {
    recentLessonsMock.mockResolvedValue([
      { draftId: 12, agent: "murrow", kind: "linkedin_post", workflow: "w1-market-spread", title: "Overdraft in Tampa", reason: "Metro too small", at: "2026-10-05T09:00:00.000Z" },
    ]);
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://feeinsight.com/api/admin/growth/intake?agent=murrow", { headers: { authorization: "Bearer test" } }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agent).toBe("murrow");
    expect(json.brief).toEqual(['- "Overdraft in Tampa" skipped: Metro too small']);
    expect(recentLessonsMock.mock.calls[0][1]).toBe("murrow");
  });

  it("refuses an unknown agent", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://feeinsight.com/api/admin/growth/intake?agent=hamilton", { headers: { authorization: "Bearer test" } }));
    expect(response.status).toBe(400);
  });
});
