import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock("./data-store/connection", () => ({
  sql: sqlMock,
  withTransaction: vi.fn(),
}));

import {
  assertPipelineEnabled,
  findOpenProviderCreditFailure,
  getPipelineControl,
  PipelinePausedError,
  PROVIDER_CREDIT_ERROR_PATTERNS,
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
