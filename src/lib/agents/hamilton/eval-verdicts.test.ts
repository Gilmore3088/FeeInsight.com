import { describe, expect, it, vi } from "vitest";

import { EVAL_CRITICAL_VERDICTS, evalVerdictFeesSql, retireEvalVerdictFees, ruleFor, verdictFor } from "./eval-verdicts";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const rows = [
  // Eval row 1 (Rockland Trust): still reads as labelled, comes down now.
  { fee_published_id: 95816, fee_verified_id: 106838, institution_id: 87, source_document_id: 17827, canonical_fee_key: "atm_non_network", fee_name: "Non Rockland Trust ATM AccessNo fee from Rockland Trust", amount: "10.00" },
  // Eval row 5 (Skyline) re-priced since labelling: left alone.
  { fee_published_id: 96379, fee_verified_id: 109129, institution_id: 4418, source_document_id: 21268, canonical_fee_key: "wire_domestic_incoming", fee_name: "Incoming Wire Fee", amount: "20.00" },
  // A rebate published as an ATM fee: second look.
  { fee_published_id: 97905, fee_verified_id: 110000, institution_id: 9, source_document_id: 5, canonical_fee_key: "atm_non_network", fee_name: "ATM Fee Reimbursement", amount: "10.00" },
  // A non-refundable set-up fee is a fee.
  { fee_published_id: 62322, fee_verified_id: 110001, institution_id: 9, source_document_id: 5, canonical_fee_key: "safe_deposit_box", fee_name: "Safe Deposit Non-Refundable Set-up Fee", amount: "25.00" },
];

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 97905, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "not_a_fee:rebate" } }] : []);
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 95816 }, { fee_published_id: 97905 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db as unknown as Parameters<typeof retireEvalVerdictFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 5, batchId: "agentic-run-5", dryRun: false };

describe("eval verdicts (Oct 8 complete-record eval)", () => {
  it("lists the 11 critical rows once each", () => {
    expect(EVAL_CRITICAL_VERDICTS).toHaveLength(11);
    expect(new Set(EVAL_CRITICAL_VERDICTS.map((entry) => entry.feePublishedId)).size).toBe(11);
  });

  it("matches a live record only while it still reads as labelled", () => {
    expect(verdictFor({ feePublishedId: 95951, feeName: "Merchant presenting NSF check from member", amount: 5, canonicalFeeKey: "nsf" })?.verdict).toBe("wrong_payer");
    expect(verdictFor({ feePublishedId: 95951, feeName: "Merchant presenting NSF check from member", amount: 5, canonicalFeeKey: "other" })).toBeNull();
    expect(verdictFor({ feePublishedId: 57064, feeName: "International Wire", amount: 45, canonicalFeeKey: "early_closure" })).toBeNull();
    expect(verdictFor({ feePublishedId: 1, feeName: "Stop Payment", amount: 30, canonicalFeeKey: "stop_payment" })).toBeNull();
  });

  it("reads a rebate as an ATM fee and a free-feature sentence as not a fee", () => {
    expect(ruleFor("atm_non_network", "ATM Fee Reimbursement")).toBe("rebate");
    expect(ruleFor("atm_non_network", "Three ATM Rebates per Month")).toBe("rebate");
    expect(ruleFor("atm_non_network", "ATM surcharge fee refunds")).toBe("rebate");
    expect(ruleFor("safe_deposit_box", "Safe Deposit Non-Refundable Set-up Fee")).toBeNull();
    expect(ruleFor("money_order", "Money Order Copy or Refund")).toBeNull();
    expect(ruleFor("stop_payment", "No Fee for Stop Payments")).toBe("no_fee_sentence");
    expect(ruleFor("money_order", "No fee for cashier’s checks or money orders No minimum balance requirement")).toBe("no_fee_sentence");
    // A table row priced "No Charge" is a fee.
    expect(ruleFor("monthly_maintenance", "Monthly Maintenance Fee…………………………………...….No Charge")).toBeNull();
    expect(ruleFor("counter_check", "Temporary counter checks (no charge with account opening)")).toBeNull();
  });

  it("reads a $0 waiver or threshold sentence as not a fee (v2, Chase 75915)", () => {
    expect(ruleFor("monthly_maintenance", "Monthly Service Fee when you have any ONE of the following during each monthly", 0)).toBe("waiver_sentence");
    expect(ruleFor("monthly_maintenance", "Monthly Service Charge if any of the following qualifications are met", 0)).toBe("waiver_sentence");
    expect(ruleFor("monthly_maintenance", "Minimum Balance Required to avoid service charge", 0)).toBe("waiver_sentence");
    expect(ruleFor("monthly_maintenance", "To avoid a monthly maintenance fee, most accounts have a stated minimum balance.", 0)).toBe("waiver_sentence");
    // The same wording at a price is the fee with its waiver; the name is for the retidy, not a takedown.
    expect(ruleFor("monthly_maintenance", "monthly service charge; waived if you maintain a daily balance", 5)).toBeNull();
    // A $0 fee that says it is waived is a fee.
    expect(ruleFor("monthly_maintenance", "Dividend Checking Monthly Fee - Waived", 0)).toBeNull();
    expect(ruleFor("monthly_maintenance", "Maintenance fee waived for students under age 25", 0)).toBeNull();
  });

  it("reads the eval's rows and the rule candidates, scoped to a bank when asked", () => {
    expect(evalVerdictFeesSql(false)).toContain("fp.fee_published_id = ANY($1::bigint[])");
    expect(evalVerdictFeesSql(false)).not.toContain("$2");
    expect(evalVerdictFeesSql(true)).toContain("fp.institution_id = $2");
    expect(evalVerdictFeesSql(false)).toContain("fp.amount = 0 AND");
  });

  it("archives an unchanged eval row on the first run and only flags a rule row", async () => {
    const db = createDb(null);
    const result = await retireEvalVerdictFees(db, options);
    expect(result).toMatchObject({ evalMatched: 1, evalChanged: 1, ruleFailing: 1, flagged: 2 });
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[95816, "eval_critical:not_a_fee"]]);
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(true);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("takedown_pending");
    expect(calls).toContain("hamilton.eval_verdict:pub:95816");
    expect(writes(db).some((text) => text.includes("hamilton.eval_verdict_rolled_back"))).toBe(true);
  });

  it("archives a rule row once its second look confirms it", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireEvalVerdictFees(db, options);
    expect(result.rolledBack.map((fee) => fee.feePublishedId).sort()).toEqual([95816, 97905]);
    expect(result.rolledBack.find((fee) => fee.feePublishedId === 97905)?.reason).toBe("not_a_fee:rebate");
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb(null);
    const result = await retireEvalVerdictFees(db, { ...options, dryRun: true });
    expect(result.rolledBack).toHaveLength(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
  });
});
