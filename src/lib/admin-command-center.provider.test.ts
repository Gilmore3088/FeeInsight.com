import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./automation-control", () => ({
  findOpenProviderCreditFailure: vi.fn(),
  getAutomationControl: vi.fn(),
  getPipelineControl: vi.fn(),
}));

import { buildProviderReadiness } from "./admin-command-center";

const enabled = {
  enabled: true, reason: null, changedBy: "x", changedAt: "2026-10-03T00:00:00.000Z", revision: 1,
};

afterEach(() => vi.unstubAllEnvs());

describe("buildProviderReadiness", () => {
  it("is ready when there is no OPEN credit failure (old or resolved failures are filtered upstream)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    expect(buildProviderReadiness(enabled, null).status).toBe("ready");
  });

  it("opens the circuit only for an open credit failure", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const result = buildProviderReadiness(enabled, { createdAt: "2026-10-03T01:00:00.000Z" });
    expect(result.status).toBe("circuit_open");
    expect(result.lastCreditFailureAt).toBe("2026-10-03T01:00:00.000Z");
  });

  it("reports a stopped automation ahead of the circuit", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const result = buildProviderReadiness({ ...enabled, enabled: false, reason: "stop" }, null);
    expect(result.status).toBe("automation_stopped");
  });
});
