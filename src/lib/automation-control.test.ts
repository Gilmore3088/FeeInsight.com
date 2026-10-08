import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, txMock } = vi.hoisted(() => ({ sqlMock: vi.fn(), txMock: vi.fn() }));

vi.mock("./data-store/connection", () => ({
  sql: sqlMock,
  withTransaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}));

import {
  assertPipelineEnabled,
  findOpenProviderCreditFailure,
  getMarketingControl,
  getPipelineControl,
  PipelinePausedError,
  PROVIDER_CREDIT_ERROR_PATTERNS,
  setMarketingEnabled,
  setPipelineEnabled,
} from "./automation-control";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("pipeline control", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("treats a missing pipeline row as enabled so code can deploy before its migration", async () => {
    sqlMock.mockResolvedValue([]);
    await expect(getPipelineControl()).resolves.toMatchObject({ enabled: true, reason: null });
  });

  it("throws PipelinePausedError when the pipeline row is disabled", async () => {
    sqlMock.mockResolvedValue([
      { enabled: false, reason: "maintenance", changed_by: "admin", changed_at: "2026-10-02T00:00:00Z", revision: 3 },
    ]);
    await expect(assertPipelineEnabled("tick")).rejects.toBeInstanceOf(PipelinePausedError);
  });
});

describe("marketing control", () => {
  const row = { enabled: false, reason: "Holding marketing", changed_by: "james", changed_at: "2026-10-08T07:00:00Z", revision: 2 };

  beforeEach(() => {
    sqlMock.mockReset();
    txMock.mockReset();
  });

  it("treats a missing marketing row as enabled", async () => {
    sqlMock.mockResolvedValue([]);
    await expect(getMarketingControl()).resolves.toMatchObject({ enabled: true, reason: null, revision: 0 });
    expect(templateText(sqlMock.mock.calls[0][0])).toContain("control_key = 'marketing'");
  });

  it("reads the marketing row on its own, separate from the pipeline row", async () => {
    sqlMock.mockResolvedValue([row]);
    await expect(getMarketingControl()).resolves.toMatchObject({ enabled: false, reason: "Holding marketing", changedBy: "james" });
  });

  it("pauses marketing with an audit row, leaving the pipeline row alone", async () => {
    txMock.mockResolvedValue([row]);
    await expect(setMarketingEnabled("james", false, "  Holding marketing  ")).resolves.toMatchObject({ enabled: false });
    const [upsert, audit] = txMock.mock.calls;
    expect(upsert.slice(1)).toEqual(["marketing", false, "Holding marketing", "james"]);
    expect(templateText(audit[0])).toContain("INSERT INTO automation_control_audit");
    expect(audit.slice(1)).toEqual(["marketing_pause", "Holding marketing", "james"]);
  });

  it("audits a resume with a default reason, and the pipeline keeps its own actions", async () => {
    txMock.mockResolvedValue([{ ...row, enabled: true }]);
    await setMarketingEnabled("james", true, "");
    expect(txMock.mock.calls[1].slice(1)).toEqual(["marketing_resume", "Marketing resumed by an administrator", "james"]);
    txMock.mockClear();
    await setPipelineEnabled("james", false, "maintenance");
    expect(txMock.mock.calls[0].slice(1)).toEqual(["pipeline", false, "maintenance", "james"]);
    expect(txMock.mock.calls[1].slice(1)).toEqual(["pipeline_pause", "maintenance", "james"]);
  });
});

describe("provider credit circuit", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("uses one shared marker list and honors billing-resolved attestations", async () => {
    sqlMock.mockResolvedValue([]);
    await expect(findOpenProviderCreditFailure("anthropic")).resolves.toBeNull();
    const query = templateText(sqlMock.mock.calls[0][0]);
    expect(query).toContain("ILIKE ANY");
    expect(query).toContain("billing_resolved");
    expect(sqlMock.mock.calls[0]).toContainEqual(PROVIDER_CREDIT_ERROR_PATTERNS);
    expect(PROVIDER_CREDIT_ERROR_PATTERNS).toContain("%insufficient credits%");
  });

  it("maps an open failure for the operator message", async () => {
    sqlMock.mockResolvedValue([
      { provider: "anthropic", agent_name: "hamilton", operation: "chat", created_at: "2026-10-01T10:00:00Z" },
    ]);
    await expect(findOpenProviderCreditFailure()).resolves.toEqual({
      provider: "anthropic",
      agentName: "hamilton",
      operation: "chat",
      createdAt: "2026-10-01T10:00:00.000Z",
    });
  });
});
