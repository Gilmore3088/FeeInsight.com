import { describe, expect, it, vi } from "vitest";

import { DARWIN_RECHECK_CHECK, DARWIN_RECHECK_OLDER_LIVE, DARWIN_RECHECK_SECOND_LOOK_LIVE, DARWIN_RECHECK_SAME_STEP_TAKEDOWN, DARWIN_RECHECK_STRATEGY, recheckVerifiedFees } from "./verified-recheck";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const TEXT = [
  "Bill Pay - FREE with E-Statements and Debit Card | $6.95 per Month",
  "Monthly fee for balance of $500 & over | FREE",
  "Overdraft fee $35.00",
].join("\n");

const verifiedRow = {
  review_status: "verified",
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.9",
  frequency: null,
  source_document_id: 55,
  amount_kind: null,
  rate_percent: null,
};

function dbWith(
  rows: Array<Record<string, unknown>>,
  older: Array<Record<string, unknown>> = [],
  due: Array<Record<string, unknown>> = [],
  firstLooks: Array<Record<string, unknown>> = [],
): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    // Live rows whose first look is due its second (#1397), and the second look's own read of the flags.
    if (text.includes("JOIN published_fee_records p ON f.dedupe_key")) return Promise.resolve(due);
    if (text.includes("SELECT fee_published_id, kind, evidence")) return Promise.resolve(firstLooks);
    // Live rows verified under an older verify version (#1568).
    if (text.includes("JOIN LATERAL")) return Promise.resolve(older);
    if (text.includes("FROM verified_fee_observations v")) return Promise.resolve(rows);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([{ source_document_id: 55, normalized_text: TEXT }]);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 7001 }]);
    return Promise.resolve([]);
  }) as DbMock;
  return db;
}

describe("Darwin verified re-check", () => {
  it("rejects an unpublished conditional $0 row, archives a live one in the same step, passes a good row", async () => {
    const db = dbWith([
      { ...verifiedRow, fee_verified_id: 120552, fee_raw_id: 217716, canonical_fee_key: "bill_pay", verified_amount: "0.00", fee_name: "Bill Pay", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: "excerpt=\"Bill Pay - FREE\"", fee_published_id: 7001 },
      { ...verifiedRow, fee_verified_id: 120907, fee_raw_id: 233082, canonical_fee_key: "monthly_maintenance", verified_amount: "0.00", fee_name: "Monthly fee for balance of & over", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: null, fee_published_id: null },
      { ...verifiedRow, fee_verified_id: 120920, fee_raw_id: 251150, canonical_fee_key: "estatement_fee", verified_amount: "0.00", fee_name: "Includes: Bill Pay E-Statement Mobile Access", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: null, fee_published_id: null },
      { ...verifiedRow, fee_verified_id: 120999, fee_raw_id: 251135, canonical_fee_key: "overdraft", verified_amount: "35.00", fee_name: "Overdraft fee", amount: "35.00", outlier_flags: [], conditions: null, fee_published_id: 7002 },
    ]);

    const result = await recheckVerifiedFees(db as never, { runId: 500, stepId: 9, sameStepTakedown: true });

    expect(result.checked).toBe(4);
    expect(result.passed).toBe(1);
    expect(result.rejected).toEqual([
      { feeVerifiedId: 120907, code: "conditional_zero" },
      { feeVerifiedId: 120920, code: "retired_category" },
    ]);
    // The live row is archived now (James: no 12-hour wait), with the reason on the record.
    expect(result.takenDown).toEqual([7001]);
    const sqlText = db.mock.calls.map((call) => templateText(call[0]));
    const rollback = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(rollback?.slice(1)).toEqual(expect.arrayContaining(["darwin-recheck-500", [7001], ["darwin_recheck:conditional_zero"]]));
    expect(sqlText.filter((text) => text.includes("rolled_back_at IS NULL") && !text.includes("JOIN LATERAL") && !text.includes("FROM pipeline_feedback f"))).toHaveLength(2);
    const rejects = db.mock.calls.filter((call) => templateText(call[0]).includes("UPDATE verified_fee_observations"));
    expect(rejects).toHaveLength(3);
    expect(rejects[0].slice(1)).toContain(JSON.stringify(["darwin_recheck:conditional_zero"]));
    const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempts).toHaveLength(4);
    expect(attempts[0].slice(1)).toEqual(expect.arrayContaining([DARWIN_RECHECK_STRATEGY.strategy, "verified:120552", "evidence_mismatch"]));
  });

  it("with the switch off (the default) flags a failing live row for the 12-hour second look instead", async () => {
    expect(DARWIN_RECHECK_SAME_STEP_TAKEDOWN).toBe(false);
    const db = dbWith([
      { ...verifiedRow, fee_verified_id: 120552, fee_raw_id: 217716, canonical_fee_key: "bill_pay", verified_amount: "0.00", fee_name: "Bill Pay", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: "excerpt=\"Bill Pay - FREE\"", fee_published_id: 7001 },
    ]);

    const result = await recheckVerifiedFees(db as never, { runId: 502 });

    expect(result).toMatchObject({ checked: 1, passed: 0, flagged: 1, takenDown: [] });
    const sqlText = db.mock.calls.map((call) => templateText(call[0]));
    expect(sqlText.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(sqlText.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(false);
    const feedback = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_feedback"));
    expect(JSON.stringify(feedback.map((call) => call.slice(1)))).toContain(DARWIN_RECHECK_CHECK);
    const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(JSON.stringify(attempts[0].slice(1))).toContain("second_look");
  });

  it("restores a row an earlier version rejected when it passes now, and leaves a still-failing one rejected", async () => {
    const db = dbWith([
      { ...verifiedRow, review_status: "rejected", fee_verified_id: 119878, fee_raw_id: 468414, source_document_id: 56, canonical_fee_key: "bill_pay", verified_amount: "0.00", fee_name: "Bill Pay", amount: "0.00", outlier_flags: ["knox_review:zero", "darwin_recheck:conditional_zero"], conditions: "excerpt=\"FREE Debit Card, FREE Bill Pay, FREE eStatements, Buy back of unused checks up to $10 within 30 days\"", fee_published_id: null },
      { ...verifiedRow, review_status: "rejected", fee_verified_id: 119842, fee_raw_id: 230322, canonical_fee_key: "monthly_maintenance", verified_amount: "0.00", fee_name: "Monthly Fee", amount: "0.00", outlier_flags: ["darwin_recheck:conditional_zero"], conditions: "excerpt=\"Monthly Fee: $0 with $100 minimum daily balance OR $2.50/month\"", fee_published_id: null },
    ]);

    const result = await recheckVerifiedFees(db as never, { runId: 503 });

    expect(result).toMatchObject({ checked: 2, passed: 0, restored: [119878], rejected: [], takenDown: [] });
    const restores = db.mock.calls.filter((call) => templateText(call[0]).includes("SET review_status = 'verified'"));
    expect(restores).toHaveLength(1);
    expect(restores[0].slice(1)).toContain(119878);
    const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(JSON.stringify(attempts[0].slice(1))).toContain("restored");
    expect(JSON.stringify(attempts[1].slice(1))).toContain("still_rejected");
  });

  it("does nothing when every verified row has been re-checked under this version", async () => {
    const db = dbWith([]);
    const result = await recheckVerifiedFees(db as never, { runId: 501 });
    expect(result).toMatchObject({ checked: 0, passed: 0, takenDown: [] });
  });

  it("flags an already verified $0 from a tier's own schedule, live or not (v3, #1397)", async () => {
    const premium = { ...verifiedRow, source_url: "https://www.examplebank.com/agreements-disclosures/truth-in-savings/premium-account-fees" };
    const db = dbWith([
      { ...premium, fee_verified_id: 130001, fee_raw_id: 300001, canonical_fee_key: "stop_payment", verified_amount: "0.00", fee_name: "Stop Payment", amount: "0.00", outlier_flags: [], conditions: null, fee_published_id: 7101 },
      { ...premium, fee_verified_id: 130002, fee_raw_id: 300002, canonical_fee_key: "wire_transfer_incoming", verified_amount: "0.00", fee_name: "Incoming Wire", amount: "0.00", outlier_flags: [], conditions: null, fee_published_id: null },
      { ...premium, fee_verified_id: 130003, fee_raw_id: 300003, canonical_fee_key: "overdraft", verified_amount: "35.00", fee_name: "Overdraft fee", amount: "35.00", outlier_flags: [], conditions: null, fee_published_id: null },
    ]);

    const result = await recheckVerifiedFees(db as never, { runId: 503 });

    expect(DARWIN_RECHECK_STRATEGY.version).toBe(3);
    expect(result).toMatchObject({ checked: 3, passed: 1, flagged: 1, rejected: [{ feeVerifiedId: 130002, code: "tier_perk_zero" }] });
    const rejects = db.mock.calls.filter((call) => templateText(call[0]).includes("UPDATE verified_fee_observations"));
    expect(rejects).toHaveLength(1);
    expect(rejects[0].slice(1)).toContain(JSON.stringify(["darwin_recheck:tier_perk_zero"]));
    expect(rejects[0].slice(1)).toContain(130002);
  });

  describe("live rows verified under an older verify version (#1568)", () => {
    const premium = { ...verifiedRow, source_url: "https://www.examplebank.com/agreements-disclosures/truth-in-savings/premium-account-fees" };
    const older = [
      { ...premium, fee_verified_id: 140001, fee_raw_id: 400001, canonical_fee_key: "overdraft", verified_amount: "0.00", fee_name: "Overdraft", amount: "0.00", outlier_flags: [], conditions: null, fee_published_id: 142869 },
      { ...premium, fee_verified_id: 140002, fee_raw_id: 400002, canonical_fee_key: "overdraft", verified_amount: "35.00", fee_name: "Overdraft fee", amount: "35.00", outlier_flags: [], conditions: null, fee_published_id: 142899 },
    ];

    it("off (the default): reports what the recheck would do and writes nothing for them", async () => {
      const db = dbWith([], older);
      const result = await recheckVerifiedFees(db as never, { runId: 600 });

      expect(DARWIN_RECHECK_OLDER_LIVE).toBe(false);
      expect(result).toMatchObject({ checked: 0, flagged: 0, takenDown: [] });
      expect(result.olderLive).toMatchObject({ read: 2, wouldFail: { tier_perk_zero: 1 } });
      expect(result.olderLive?.samples).toEqual([expect.objectContaining({ feePublishedId: 142869, code: "tier_perk_zero" })]);
      const writes = db.mock.calls.map((call) => templateText(call[0])).filter((text) => /\b(?:UPDATE|INSERT)\b/.test(text));
      expect(writes).toEqual([]);
      // A sample reads up from a random id; other runs skip the report.
      const lateral = db.mock.calls.find((call) => templateText(call[0]).includes("JOIN LATERAL"));
      expect(templateText(lateral?.[0])).toContain("random()");
      const skipped = await recheckVerifiedFees(dbWith([], older) as never, { runId: 601 });
      expect(skipped.olderLive).toBeUndefined();
    });

    it("on: they join the recheck, and a failing live one goes to the second look", async () => {
      const db = dbWith([], older);
      const result = await recheckVerifiedFees(db as never, { runId: 602, olderLive: true });

      expect(result.olderLive).toBeUndefined();
      expect(result).toMatchObject({ checked: 2, passed: 1, flagged: 1 });
      const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
      expect(attempts).toHaveLength(2);
    });
  });

  describe("first looks that are due their second look (#1397)", () => {
    const premium = { ...verifiedRow, source_url: "https://www.examplebank.com/agreements-disclosures/truth-in-savings/premium-account-fees" };
    const due = [
      { ...premium, fee_verified_id: 172159, fee_raw_id: 679667, canonical_fee_key: "overdraft", verified_amount: "0.00", fee_name: "Overdraft", amount: "0.00", outlier_flags: [], conditions: null, fee_published_id: 142869 },
      { ...verifiedRow, fee_verified_id: 172160, fee_raw_id: 679668, canonical_fee_key: "overdraft", verified_amount: "35.00", fee_name: "Overdraft fee", amount: "35.00", outlier_flags: [], conditions: null, fee_published_id: 142870 },
    ];
    const flagged = [142869, 142870].map((id) => ({
      fee_published_id: id,
      kind: "takedown_pending",
      evidence: { flag_run_id: 6715, flagged_at: "2026-10-15T08:35:53Z", reason: "darwin_recheck:tier_perk_zero" },
    }));

    it("off (the default): reports what the second looks would do and writes nothing", async () => {
      const db = dbWith([], [], due, flagged);
      const result = await recheckVerifiedFees(db as never, { runId: 701 });

      expect(DARWIN_RECHECK_SECOND_LOOK_LIVE).toBe(false);
      expect(result).toMatchObject({ checked: 0, takenDown: [] });
      expect(result.dueSecondLooks).toMatchObject({ due: 2, wouldConfirm: { tier_perk_zero: 1 }, wouldClear: 1 });
      const writes = db.mock.calls.map((call) => templateText(call[0])).filter((text) => /\b(?:UPDATE|INSERT)\b/.test(text));
      expect(writes).toEqual([]);
    });

    it("on: a still-failing row is confirmed and archived; a passing one is cleared", async () => {
      const db = dbWith([], [], due, flagged);
      const result = await recheckVerifiedFees(db as never, { runId: 702, secondLooks: true, now: new Date("2026-10-16T01:00:00Z") });

      expect(result.dueSecondLooks).toBeUndefined();
      expect(result).toMatchObject({ checked: 2, passed: 1, cleared: 1, flagged: 0, waiting: 0 });
      // The confirmed row is archived with its reason (the mock's UPDATE answers for another id).
      const rollback = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
      expect(rollback?.slice(1)).toEqual(expect.arrayContaining([[142869], ["darwin_recheck:tier_perk_zero"]]));
    });
  });
});
