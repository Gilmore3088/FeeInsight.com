/**
 * Deming's audience replay (#2064, target 0 consumer/business mix-ups): a seeded confirmed
 * business-schedule takedown is caught by today's audience rules, and flagged as a regression when
 * those rules stop catching it. The rule change is simulated by switching Hamilton's
 * business-schedule read and Darwin's audience decision off, so the test proves the replay reads
 * the deployed rules, not a copy of them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const rules = vi.hoisted(() => ({ regressed: false }));

vi.mock("@/lib/agents/hamilton/business-schedule", async (original) => {
  const actual = await original<typeof import("@/lib/agents/hamilton/business-schedule")>();
  return { ...actual, readsAsBusinessSchedule: (...args: Parameters<typeof actual.readsAsBusinessSchedule>) => !rules.regressed && actual.readsAsBusinessSchedule(...args) };
});
vi.mock("@/lib/agents/darwin/audience", async (original) => {
  const actual = await original<typeof import("@/lib/agents/darwin/audience")>();
  return { ...actual, darwinAudience: (...args: Parameters<typeof actual.darwinAudience>) => (rules.regressed ? null : actual.darwinAudience(...args)) };
});

const { buildTakedownCase, replayFieldCase } = await import("./regression");

// A confirmed takedown as `loadNewTakedowns` reads it: a business fee shown beside the bank's consumer one.
const takedown = {
  feedback_id: 41, check_name: "hamilton.business_schedule", reason: "business_schedule: consumer fee #14535",
  fee_published_id: 20640200, institution_id: 20640001, canonical_fee_key: "overdraft", fee_name: "Balancing Checkbook",
  amount: "15", amount_kind: "fixed", rate_percent: null, source_url: null, lineage_ref: 1, fee_raw_id: 2,
  source: "knox", source_document_id: 3, conditions: null,
  document_url: "https://www.apgfcu.com/business-service-charges-and-fees-list.html",
};

afterEach(() => {
  rules.regressed = false;
});

describe("audience replay", () => {
  it("catches a seeded audience case and keeps it active", () => {
    const built = buildTakedownCase(takedown, []);
    expect(built).toMatchObject({ status: "active", lastCaught: true, lastVerdict: "darwin_reads_business", input: { kind: "audience" } });
    expect(replayFieldCase({ status: built.status, check_name: built.checkName, input: built.input, fee_live: false }).outcome)
      .toEqual({ status: "active", regression: false });
  });

  it("flags the case when the audience rules regress", () => {
    const built = buildTakedownCase(takedown, []);
    rules.regressed = true;
    const replay = replayFieldCase({ status: built.status, check_name: built.checkName, input: built.input, fee_live: false });
    expect(replay.replay).toEqual({ caught: false, verdict: "passes_audience_rules" });
    expect(replay.outcome).toEqual({ status: "active", regression: true });
    // The regressed rule would also restore the fee: still a regression, never a retirement.
    expect(replayFieldCase({ status: built.status, check_name: built.checkName, input: built.input, fee_live: true }).outcome)
      .toEqual({ status: "active", regression: true });
  });
});
