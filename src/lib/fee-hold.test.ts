import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_HOLD_PREFIX,
  cleanHoldReason,
  getHeldFees,
  holdPublishedFee,
  readHoldReason,
  releasePublishedFee,
  validFeeId,
} from "./fee-hold";

type Call = { query: string; values: unknown[] };

/** A tagged-template mock: each statement returns the rows the matcher gives it. */
function createDb(rowsFor: (query: string) => unknown[]) {
  const calls: Call[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    return Promise.resolve(rowsFor(query));
  });
  const db = Object.assign(tag, { begin: vi.fn((callback: (tx: typeof tag) => unknown) => callback(tag)) });
  return { db: db as never, calls };
}

const actor = { id: 7, name: "James" };
const liveRow = { fee_published_id: 117687, institution_id: 809, canonical_fee_key: "safe_deposit_box", amount: "50.00", fee_name: "Escheat processing fee" };

describe("admin fee hold", () => {
  it("should_require_a_reason_of_reasonable_length", () => {
    expect(cleanHoldReason("  no  ")).toBeNull();
    expect(cleanHoldReason("x".repeat(501))).toBeNull();
    expect(cleanHoldReason(42)).toBeNull();
    expect(cleanHoldReason("  Wrong   category  ")).toBe("Wrong category");
  });

  it("should_accept_only_positive_integer_fee_ids", () => {
    expect(validFeeId("12")).toBe(12);
    for (const bad of [0, -1, 1.5, "abc", null, Number.MAX_SAFE_INTEGER + 1]) expect(validFeeId(bad)).toBeNull();
  });

  it("should_hold_a_live_fee_and_log_who_held_it_and_why", async () => {
    const { db, calls } = createDb((query) => (query.includes("UPDATE published_fee_records") ? [liveRow] : [{ id: 1 }]));
    const result = await holdPublishedFee(db, 117687, "Wrong category", actor);

    // The mock has no fee_index_cache writer column, so the rebuild reports "not applied".
    expect(result).toEqual({ ok: true, feePublishedId: 117687, institutionId: 809, indexRefreshed: false, runId: 1 });
    // James, 2026-10-16: a hold is a visible run and rebuilds the national index straight away.
    const run = calls.find((call) => call.query.includes("INSERT INTO agent_runs"));
    expect(run?.query).toContain("'manual_repair'");
    expect(run?.values).toContain("admin.fee_hold");
    expect(calls.some((call) => call.query.includes("INSERT INTO agent_run_steps"))).toBe(true);
    expect(calls.some((call) => call.query.includes("fee_index_cache"))).toBe(true);
    const indexEvent = calls.find((call) => call.query.includes("INSERT INTO agent_run_events") && call.query.includes("'index.refresh'"));
    expect(indexEvent).toBeDefined();
    const update = calls.find((call) => call.query.includes("UPDATE published_fee_records"));
    expect(update?.query).toContain("rolled_back_at IS NULL");
    expect(update?.query).toContain("quarantined_at IS NULL");
    expect(update?.values).toContain(`${ADMIN_HOLD_PREFIX} Wrong category`);
    const log = calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"));
    const logged = JSON.parse(String(log?.values[0]))[0];
    expect(logged).toMatchObject({
      reported_by: "human",
      check_name: "admin.fee_hold",
      kind: "admin_hold",
      fee_published_id: 117687,
      evidence: { action: "hold", actor_id: 7, actor: "James", reason: "Wrong category" },
    });
  });

  it("should_file_the_hold_against_the_stage_its_cause_names_with_the_fee_link_(#2057)", async () => {
    const withLink = { ...liveRow, source_url: "https://bank.example/fees.pdf" };
    const logged = async (cause?: Parameters<typeof holdPublishedFee>[4]) => {
      const { db, calls } = createDb((query) => (query.includes("UPDATE published_fee_records") ? [withLink] : [{ id: 1 }]));
      await holdPublishedFee(db, 117687, "Another bank's schedule", actor, cause);
      const log = calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"));
      return JSON.parse(String(log?.values[0]))[0];
    };
    // A wrong document goes to discover, which Magellan's stale-link search reads by bank.
    expect(await logged("wrong_document")).toMatchObject({ about_stage: "discover", source_url: "https://bank.example/fees.pdf", evidence: { cause: "wrong_document" } });
    expect((await logged("wrong_amount")).about_stage).toBe("extract");
    expect((await logged("text_lost")).about_stage).toBe("read");
    expect((await logged("verify_missed")).about_stage).toBe("verify");
    // No answer is "not sure", filed against publishing as before.
    expect(await logged()).toMatchObject({ about_stage: "publish", evidence: { cause: "not_sure" } });
  });

  it("should_refuse_a_fee_that_is_not_live_or_already_held_and_write_nothing_else", async () => {
    const { db, calls } = createDb(() => []);
    const result = await holdPublishedFee(db, 117687, "Wrong category", actor);

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.query.includes("INSERT INTO pipeline_feedback"))).toBe(false);
  });

  it("should_release_only_an_admin_hold_and_log_the_release", async () => {
    const held = { ...liveRow, quarantine_reason: `${ADMIN_HOLD_PREFIX} Wrong category` };
    const { db, calls } = createDb((query) => (query.includes("UPDATE published_fee_records") ? [held] : [{ id: 2 }]));
    const result = await releasePublishedFee(db, 117687, actor);

    expect(result).toEqual({ ok: true, feePublishedId: 117687, institutionId: 809, indexRefreshed: false, runId: 2 });
    expect(calls.find((call) => call.query.includes("INSERT INTO agent_runs"))?.values).toContain("admin.fee_release");
    const update = calls.find((call) => call.query.includes("UPDATE published_fee_records"));
    expect(update?.query).toContain("left(fp.quarantine_reason");
    expect(update?.values).toContain(ADMIN_HOLD_PREFIX);
    const logged = JSON.parse(String(calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"))?.values[0]))[0];
    expect(logged).toMatchObject({ kind: "admin_release", signal: "restored", evidence: { action: "release", reason: "Wrong category" } });
  });

  it("should_not_release_an_agent_quarantine", async () => {
    const { db, calls } = createDb(() => []);
    expect((await releasePublishedFee(db, 121442, actor)).ok).toBe(false);
    expect(calls.some((call) => call.query.includes("INSERT INTO pipeline_feedback"))).toBe(false);
  });

  it("should_list_held_fees_with_their_reason_and_holder", async () => {
    const { db } = createDb(() => [{
      ...liveRow,
      quarantined_at: new Date("2026-10-12T01:40:00Z"),
      quarantine_reason: `${ADMIN_HOLD_PREFIX} Wrong category`,
      held_by: "James",
      closed_by_check: false,
    }]);
    expect(await getHeldFees(db, 809)).toEqual([{
      feePublishedId: 117687,
      institutionId: 809,
      feeName: "Escheat processing fee",
      amount: 50,
      canonicalFeeKey: "safe_deposit_box",
      heldAt: "2026-10-12T01:40:00.000Z",
      reason: "Wrong category",
      heldBy: "James",
      closedByCheck: false,
    }]);
  });

  it("should_read_back_only_admin_hold_reasons", () => {
    expect(readHoldReason(`${ADMIN_HOLD_PREFIX} Wrong category`)).toBe("Wrong category");
    expect(readHoldReason("pinnacle_unscoped_audience")).toBeNull();
    expect(readHoldReason(null)).toBeNull();
  });
});
