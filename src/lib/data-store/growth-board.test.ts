import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { growthAgentForStep, listGrowthSteps, readGrowthBudget } from "./growth-board";

type Db = NonNullable<Parameters<typeof listGrowthSteps>[1]>;

function mockDb(answer: unknown[] = []) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?"), values });
    return Promise.resolve(answer);
  });
  return { db: db as unknown as Db, calls };
}

describe("growthAgentForStep", () => {
  it("takes the agent an intake filing names, from the run or the step", () => {
    expect(growthAgentForStep("growth-intake", { agent: "ernest" }, {})).toBe("ernest");
    expect(growthAgentForStep("growth-intake", "{}", JSON.stringify({ item: { agent: "sherlock" } }))).toBe("sherlock");
  });

  it("gives the weekly LinkedIn steps to murrow", () => {
    expect(growthAgentForStep("content-market-spread", {}, {})).toBe("murrow");
    expect(growthAgentForStep("content-fee-depth", null, null)).toBe("murrow");
  });

  it("leaves the email, scoring and unknown agents unowned rather than guessing", () => {
    expect(growthAgentForStep("marketing-write", {}, {})).toBeNull();
    expect(growthAgentForStep("growth-score", {}, {})).toBeNull();
    expect(growthAgentForStep("growth-intake", { agent: "atlas" }, "not json")).toBeNull();
  });
});

describe("listGrowthSteps", () => {
  it("reads only growth's runs, newest first, and maps each step", async () => {
    const { db, calls } = mockDb([
      {
        id: 9,
        agent_run_id: 4,
        step_key: "growth-intake",
        title: "File ernest's article into the queue",
        status: "completed",
        summary: "Filed",
        error_summary: null,
        input_payload: { item: { agent: "ernest" } },
        queued_at: new Date("2026-10-08T10:00:00Z"),
        started_at: null,
        completed_at: "2026-10-08T10:01:00Z",
        run_title: "Growth intake",
        run_status: "completed",
        params_json: {},
      },
    ]);
    const steps = await listGrowthSteps(500, db);
    expect(calls[0].query).toContain("r.agent_name = 'growth'");
    expect(calls[0].values).toEqual([200]);
    expect(steps).toEqual([
      expect.objectContaining({ stepId: 9, runId: 4, agent: "ernest", at: "2026-10-08T10:00:00.000Z", summary: "Filed", errorSummary: null }),
    ]);
  });
});

describe("readGrowthBudget", () => {
  it("says missing when there is no row", async () => {
    const { db } = mockDb([]);
    await expect(readGrowthBudget(db)).resolves.toEqual({ state: "missing", dailyCapUsd: null, monthlyCapUsd: null });
  });

  it("reads the row's state and caps in dollars", async () => {
    const { db } = mockDb([{ enabled: false, hard_daily_microusd: "5000000", hard_monthly_microusd: 60_000_000 }]);
    await expect(readGrowthBudget(db)).resolves.toEqual({ state: "off", dailyCapUsd: 5, monthlyCapUsd: 60 });
  });

  it("says enabled only when the row is enabled", async () => {
    const { db } = mockDb([{ enabled: true, hard_daily_microusd: null, hard_monthly_microusd: null }]);
    await expect(readGrowthBudget(db)).resolves.toMatchObject({ state: "enabled", dailyCapUsd: null });
  });
});
