import { describe, expect, it, vi } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { narrateStepFinished } from "@/lib/agents/narrate";
import { GROWTH_LOOP_STEPS, loopIsFree } from "./loop";
import { runToolCheck, stateForDay, summarizeToolCheck } from "./edison";

type Db = Parameters<typeof runToolCheck>[0]["db"];

function fakeDb(institutions: number) {
  const db = vi.fn(() => Promise.resolve(Array.from({ length: institutions }, (_, i) => ({ id: i + 1, institution_name: `Bank ${i + 1}` })))) as unknown as Db;
  (db as unknown as { unsafe: unknown }).unsafe = vi.fn(async () =>
    Array.from({ length: institutions }, (_, i) => ({
      institution_id: i + 1,
      fee_category: "overdraft",
      fee_name: "Overdraft Fee",
      amount: 30,
      canonical_fee_key: "overdraft",
      conditions: null,
      account_product_type: null,
      waiver_text: null,
      document_url: null,
      read_at: null,
      normalized_text: "Overdraft Fee $30.00 per item",
    })),
  );
  return db;
}

describe("EDISON's tool check", () => {
  it("records what a visitor would see for each fee in the day's state", async () => {
    const result = await runToolCheck({ db: fakeDb(12), runId: 1, dryRun: true, state: "ia" });
    expect(result.state).toBe("IA");
    expect(result.fees[0]).toEqual({ fee: "overdraft", checked: 12, unchecked: 0, median: 30, shown: true });
    expect(summarizeToolCheck(result)).toContain("Ran the price check for IA: overdraft 12 source-checked (median $30), 0 left out");
  });

  it("goes through every state in turn", () => {
    const day = new Date("2026-10-09T00:57:00Z");
    expect(stateForDay(day)).not.toBe(stateForDay(new Date(day.getTime() + 86_400_000)));
  });

  it("is a free marketing step", () => {
    expect(isMarketingStep("growth-tools")).toBe(true);
    expect(isProviderStep("growth-tools")).toBe(false);
  });
});

describe("the daily growth loop", () => {
  it("runs only free marketing steps, never the send", () => {
    expect(loopIsFree()).toBe(true);
    expect(GROWTH_LOOP_STEPS.map((step) => step.key)).not.toContain("marketing-send");
    expect(GROWTH_LOOP_STEPS.map((step) => step.key)).not.toContain("marketing-write");
  });

  it("says a dry run saved nothing", () => {
    expect(narrateStepFinished("growth-outreach", { dryRun: true, drafted: 3 })).toBe("Dry run, nothing saved: Drafted 3 first emails for James to audit and send himself.");
    expect(narrateStepFinished("growth-outreach", { dryRun: false, drafted: 3 })).toBe("Drafted 3 first emails for James to audit and send himself.");
  });
});
