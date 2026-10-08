import { describe, expect, it } from "vitest";
import type { SpendSummary } from "@/lib/data-store/console-spend";
import { buildLaunchChecklist } from "./launch-checklist";

const spend: SpendSummary = {
  readAt: "2026-10-06T06:00:00Z",
  total: { key: "all", todayUsd: 8.35, monthUsd: 23.27, dailyCapUsd: 75, monthlyCapUsd: 500, enabled: true },
  agents: [],
};

function state(key: string, checks = buildLaunchChecklist({ env: {}, spend: null, readyMarkets: null, libraryReports: null })) {
  return checks.find((check) => check.key === key)!;
}

describe("buildLaunchChecklist", () => {
  it("never marks a check done when it could not read the source", () => {
    const checks = buildLaunchChecklist({ env: {}, spend: null, readyMarkets: null, libraryReports: null });
    expect(state("caps", checks).state).toBe("unknown");
    expect(state("markets", checks).state).toBe("unknown");
    expect(state("library", checks).state).toBe("unknown");
    expect(state("analytics", checks).state).toBe("unknown");
    expect(checks.some((check) => check.state === "done")).toBe(false);
  });

  it("reads email, caps and the gate from live inputs", () => {
    const checks = buildLaunchChecklist({
      env: { RESEND_API_KEY: "x", TRANSACTIONAL_EMAIL_FROM: "hello@feeinsight.com", CRON_SECRET: "y" },
      spend,
      readyMarkets: 0,
      libraryReports: 0,
    });
    expect(state("email", checks).state).toBe("done");
    expect(state("cron", checks).state).toBe("done");
    expect(state("caps", checks).detail).toBe("All agents: $75 a day, $500 a month.");
    expect(state("markets", checks).state).toBe("not_done");
    expect(state("library", checks).state).toBe("not_done");
  });

  it("names the agents still on the shared key", () => {
    const checks = buildLaunchChecklist({
      env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_API_KEY_KNOX: "k1", ANTHROPIC_API_KEY_DARWIN: "k2" },
      spend,
      readyMarkets: 1,
      libraryReports: 1,
    });
    const keys = state("agent-keys", checks);
    expect(keys.state).toBe("partial");
    expect(keys.detail).toBe("Using the shared key: Magellan, Rosetta, Hamilton, Growth.");
  });
});
