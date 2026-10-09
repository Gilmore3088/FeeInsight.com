import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./automation-control", () => ({
  findOpenProviderCreditFailure: vi.fn(),
  getAutomationControl: vi.fn(),
  getPipelineControl: vi.fn(),
  getMarketingControl: vi.fn(),
}));

import { buildProviderReadiness, controlAttention } from "./admin-command-center";

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

  it("does not claim a confirmed stop when the control could not be read", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const result = buildProviderReadiness({ ...enabled, enabled: false, reason: null, unreadable: true }, null);
    expect(result.label).toBe("Couldn't read the provider stop control");
  });
});

describe("controlAttention", () => {
  const unreadable = { ...enabled, enabled: false, reason: "Safety control is unavailable", unreadable: true as const };

  it("says a control could not be read instead of calling it stopped or paused, with a retry link", () => {
    const items = controlAttention(unreadable, unreadable);
    expect(items.map((item) => item.id)).toEqual(["automation:unreadable", "pipeline:unreadable"]);
    expect(items.every((item) => item.action === "Retry" && item.href === "/admin")).toBe(true);
    expect(items.map((item) => item.title).join(" ")).not.toMatch(/stop is active|is paused/i);
  });

  it("sends a confirmed stop or pause to Controls", () => {
    const off = { ...enabled, enabled: false, reason: "operator" };
    expect(controlAttention(off, off).map((item) => [item.id, item.href])).toEqual([
      ["automation:stopped", "/admin/controls"],
      ["pipeline:paused", "/admin/controls"],
    ]);
  });

  it("raises nothing when both controls read as running", () => {
    expect(controlAttention(enabled, enabled)).toEqual([]);
  });
});
