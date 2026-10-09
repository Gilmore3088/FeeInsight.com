import { describe, expect, it, vi } from "vitest";

import { EVAL_CRITICAL_VERDICTS, HAND_CHECKED_VERDICTS, distinctPrices, evalVerdictFeesSql, flagFor, priceInName, retireEvalVerdictFees, ruleFor, verdictFor } from "./eval-verdicts";

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
  // A non-customer price: flagged, stays live (v3).
  { fee_published_id: 70100, fee_verified_id: 110002, institution_id: 9, source_document_id: 5, canonical_fee_key: "money_order", fee_name: "Money Orders (Non-Customer)", amount: "3.00", conditions: 'excerpt="Money Orders (Non-Customer) $3.00"' },
  // Two fees on one line: second look (v3).
  { fee_published_id: 70101, fee_verified_id: 110003, institution_id: 9, source_document_id: 5, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire Domestic In/Out", amount: "10.00", conditions: 'excerpt="Wire Domestic In/Out | $10/$20"' },
];

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("NOT EXISTS")) return Promise.resolve([]);
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

  it("reads a price the name presents as the fee's own, and not the amount, as a wrong amount (v4, UAT row 100439)", () => {
    expect(ruleFor("overdraft", "Courtesy Pay (Paid Overdraft) Fee .. . . .$35.005", 50)).toBe("price_in_name");
    expect(ruleFor("overdraft", "Courtesy Pay (Paid Overdraft) Fee…..…….…….….$35.005 | 3x10…………………………………", 50)).toBe("price_in_name");
    expect(ruleFor("stop_payment", "Stop Payment (per item) $30.00 Lost Key", 25)).toBe("price_in_name");
    expect(ruleFor("check_copy", "Check Copy Fee $2.00 per copy Pay Card Savings", 1)).toBe("price_in_name");
    // ADMIN's expected set from run 3232: glued two-item lines carrying the next item's price.
    expect(ruleFor("overdraft", "Courtesy Pay per debit as applicable $29.00 Inactivity Fee (first charged to checking then savings)", 10)).toBe("price_in_name");
    expect(ruleFor("wire_domestic_outgoing", "Wire Out (domestic) $25.00 5X10 Box Annually", 55)).toBe("price_in_name");
    expect(ruleFor("counter_check", "Counter Checks (per page) $0.50 Signature Validation Program (SVP)", 5)).toBe("price_in_name");
    expect(ruleFor("overdraft", "Overdraft (OD) or Non-sufficient Funds (NSF) item - account overdrawn more than $5.00 Fees for", 30)).toBeNull();
    expect(ruleFor("check_cashing", "Check Cashing / Non-Customer / On Us Only ≥$10.000", 100)).toBeNull();
    // The same price in the name is only glue; no price in the name says nothing.
    expect(ruleFor("overdraft", "Courtesy Pay Fee…..$35.005", 35)).toBeNull();
    expect(ruleFor("overdraft", "Courtesy Pay Fee", 50)).toBeNull();
    expect(priceInName("Fee $1,250.50 each")).toBe(1250.5);
    expect(priceInName("Stop Payment")).toBeNull();
    expect(evalVerdictFeesSql(false)).toContain("fp.fee_name ~ '\\$\\s?[0-9]'");
  });

  it("leaves a threshold, floor, cap, balance, range or second price in the name alone (v5, UAT 03:44)", () => {
    // v4's first run flagged 389 live fees; UAT read 18 of 20 as correct fees. These are theirs.
    expect(ruleFor("gift_card_purchase", "Gift Cards ($25 up to $500 Only)", 5)).toBeNull();
    expect(ruleFor("minimum_balance", "Minimum Balance (below $50 per month)", 5)).toBeNull();
    expect(ruleFor("stop_payment", "Stop Payment on CU Checks Fee (over $500, must purchase an Indemnity Bond)", 50)).toBeNull();
    expect(ruleFor("overdraft", "Overdraft Fee – Each overdraft paid over $5", 33)).toBeNull();
    expect(ruleFor("account_research", "Account Research - per hour ($20.00 minimum)", 30)).toBeNull();
    expect(ruleFor("account_research", "Research Fee ($5 min)", 20)).toBeNull();
    expect(ruleFor("account_research", "Research Fee (hourly fee; 15 minute minimum charge of $10.00)", 40)).toBeNull();
    expect(ruleFor("money_order", "Money Orders ($1,000 maximum)", 2)).toBeNull();
    expect(ruleFor("minimum_balance", "Service Fee (daily balance falls below $2,500)", 8)).toBeNull();
    expect(ruleFor("gift_card_purchase", "Visa Gift Cards $10.00-$500.00", 3.5)).toBeNull();
    expect(ruleFor("cashiers_check", "Cashier’s checks $1,000.00 or less per item", 5)).toBeNull();
    expect(ruleFor("cashiers_check", "Bank Checks: $1,000 and up", 5)).toBeNull();
    expect(ruleFor("stop_payment", "Stop Payment ($15.00 if initiated through on-line banking)", 25)).toBeNull();
    expect(ruleFor("card_replacement", "Debit / ATM Replacement Card (rush order $80.00)", 10)).toBeNull();
    expect(ruleFor("account_research", "Research Fee (plus $1.00 per copy) per hour", 50)).toBeNull();
    expect(ruleFor("safe_deposit_box", "Safe Deposit Box 3x5 $1,250 deductible", 25)).toBeNull();
    expect(ruleFor("check_cashing", "Check Cashing Fee (Non-Use of Account) $1,000.01 +", 10)).toBeNull();
    expect(ruleFor("nsf", "NSF Returned Item(s) Charge (NSF charge maximum of $100 per day)", 25)).toBeNull();
    // Fees holding a pending flag are read again so today's rule can clear them.
    expect(evalVerdictFeesSql(false)).toContain("pf.check_name = 'hamilton.eval_verdict' AND pf.kind = 'takedown_pending'");
  });

  it("clears a pending flag the current rule no longer supports and logs the lesson (v5)", async () => {
    // 62322 (a fee, no rule fails it) holds a pending flag from an earlier rule version.
    const query = (strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (text.includes("NOT EXISTS")) {
        // One clear made before the audit trail existed: its first look is rebuilt.
        return Promise.resolve([{ dedupe_key: "hamilton.second_look:hamilton.eval_verdict:pub:54772", fee_published_id: 54772, institution_id: 12, source_document_id: 99, canonical_fee_key: "gift_card_purchase", amount: "5.00", evidence: { flag_run_id: 3232, flagged_at: "2026-10-09T02:58:41.000Z", reason: "wrong_amount:price_in_name", cleared_run_id: 3240, cleared_at: "2026-10-09T04:21:57.000Z" } }]);
      }
      if (text.includes("FROM pipeline_feedback")) {
        return Promise.resolve([{ fee_published_id: 62322, kind: "takedown_pending", evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 3_600_000).toISOString(), reason: "wrong_amount:price_in_name" } }]);
      }
      if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 95816 }]);
      return Promise.resolve([]);
    };
    const db = vi.fn(query) as unknown as ReturnType<typeof createDb>;
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(rows));
    const result = await retireEvalVerdictFees(db, options);
    expect(result.cleared).toBe(1);
    expect(result.reconstructed).toBe(1);
    expect(result.rolledBack.map((fee) => fee.feePublishedId)).toEqual([95816]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("takedown_cleared");
    // The clear appends its own row and keeps the first look's run, time and reason.
    expect(calls).toContain("hamilton.second_look:hamilton.eval_verdict:pub:62322:cleared:5");
    expect(calls).toContain("flag_cleared");
    expect(calls).toContain("hamilton.second_look:hamilton.eval_verdict:pub:62322:flag:1");
    // The rebuilt first look names what it was rebuilt from and why it was cleared.
    expect(calls).toContain("hamilton.second_look:hamilton.eval_verdict:pub:54772:flag:3232");
    expect(calls).toContain("reconstructed_from");
    expect(calls).toContain("hamilton.eval_verdict:rule_revised:v5");
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
  });

  it("reads the eval's rows and the rule candidates, scoped to a bank when asked", () => {

    expect(evalVerdictFeesSql(false)).toContain("fp.fee_published_id = ANY($1::bigint[])");
    expect(evalVerdictFeesSql(false)).not.toContain("$2");
    expect(evalVerdictFeesSql(true)).toContain("fp.institution_id = $2");
    expect(evalVerdictFeesSql(false)).toContain("fp.amount = 0 AND");
    expect(evalVerdictFeesSql(false)).toContain("fr.conditions");
    expect(evalVerdictFeesSql(false)).toContain("non[- ]?(customer|member|account ?holder)s?");
    expect(evalVerdictFeesSql(false)).toContain("LIKE 'wire\\_%'");
  });

  it("archives an unchanged eval row on the first run and only flags a rule row", async () => {
    const db = createDb(null);
    const result = await retireEvalVerdictFees(db, options);
    expect(result).toMatchObject({ evalMatched: 1, evalChanged: 1, ruleFailing: 2, flagged: 3, flags: { non_customer_price: 1, wire_shared_line: 0 } });
    expect(result.flagSamples.map((fee) => [fee.feePublishedId, fee.flag])).toEqual([[70100, "non_customer_price"]]);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[95816, "eval_critical:not_a_fee"]]);
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(true);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("takedown_pending");
    expect(calls).toContain("hamilton.eval_verdict:pub:95816");
    expect(calls).toContain("hamilton.eval_verdict:flag:non_customer_price:pub:70100");
    // The first look's audit row, keyed by the run and never rewritten.
    expect(calls).toContain("flag_recorded");
    expect(calls).toContain("hamilton.second_look:hamilton.eval_verdict:pub:97905:flag:5");
    expect(calls).toContain("wrong_amount:two_fees_one_line");
    expect(writes(db).some((text) => text.includes("hamilton.eval_verdict_rolled_back"))).toBe(true);
  });

  it("archives a rule row once its second look confirms it", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireEvalVerdictFees(db, options);
    expect(result.rolledBack.map((fee) => fee.feePublishedId).sort()).toEqual([95816, 97905]);
    expect(result.rolledBack.find((fee) => fee.feePublishedId === 97905)?.reason).toBe("not_a_fee:rebate");
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("flag_confirmed");
    expect(calls).toContain("hamilton.second_look:hamilton.eval_verdict:pub:97905:confirmed:5");
  });

  it("reads the merchant's fee and two fees on one line as takedowns, and flags the rest (v3)", () => {
    expect(ruleFor("nsf", "Merchant presenting NSF check from member", 5)).toBe("merchant_payer");
    expect(ruleFor("nsf", "Returned item paid by the merchant", 5)).toBe("merchant_payer");
    expect(ruleFor("bill_pay", "Merchant Return (Bill Pay)", 25)).toBeNull();
    expect(ruleFor("wire_domestic_outgoing", "Wire Domestic In/Out", 10, "Wire Domestic In/Out | $10/$20")).toBe("two_fees_one_line");
    expect(ruleFor("wire_domestic_outgoing", "Outgoing Domestic / International Wire", 30, "Outgoing Domestic / International Wire $30 / $50 per wire")).toBe("two_fees_one_line");
    // One price for both directions is one fee.
    expect(ruleFor("wire_domestic_outgoing", "Wire Transfer In/Out", 25, "Wire Transfer In/Out $25")).toBeNull();
    expect(distinctPrices("$10/$20 and $10.00")).toBe(2);
    expect(flagFor("money_order", "Money Orders (Non-Customer)")).toBe("non_customer_price");
    expect(flagFor("account_research", "Fax: Nonmember")).toBe("non_customer_price");
    expect(flagFor("money_order", "Money Orders")).toBeNull();
    expect(flagFor("wire_domestic_incoming", "Incoming Wire", "$ 17.00 Incoming Wire | $ 25.00 Foreign Currency Sell")).toBe("wire_shared_line");
    expect(flagFor("wire_domestic_incoming", "Incoming Wire", "Incoming Wire | $17.00")).toBeNull();
    // A heading joined to another fee is the category guard's name_contradicts, not a flag here.
    expect(flagFor("early_closure", "Accounts closed within 90 days: International Wire")).toBeNull();
  });

  it("flags a hand-checked row for its second look, never takes it down on the first run (City National 76)", async () => {
    const handRows = [
      { fee_published_id: 100158, fee_verified_id: 113964, institution_id: 76, source_document_id: 23020, canonical_fee_key: "overdraft", fee_name: "Item Fees and the Paid Item Fee for the check/item in the amount of", amount: "17.00" },
      // Renamed since the check: left alone.
      { fee_published_id: 100162, fee_verified_id: 113969, institution_id: 76, source_document_id: 23020, canonical_fee_key: "wire_domestic_incoming", fee_name: "Incoming Wire Transfer", amount: "0.00" },
    ];
    const db = createDb(null);
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(handRows));
    const result = await retireEvalVerdictFees(db, options);
    expect(result).toMatchObject({ handMatched: 1, evalChanged: 1, flagged: 1 });
    expect(result.rolledBack).toEqual([]);
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("takedown_pending");
    expect(calls).toContain("not_a_fee:two_column_glue");
    expect(new Set(HAND_CHECKED_VERDICTS.map((entry) => entry.feePublishedId)).size).toBe(HAND_CHECKED_VERDICTS.length);
    expect(HAND_CHECKED_VERDICTS.some((entry) => EVAL_CRITICAL_VERDICTS.some((evalRow) => evalRow.feePublishedId === entry.feePublishedId))).toBe(false);
  });

  it("labels the Oct 9 hand-checked rows no live type fits, each only while it reads as labelled", () => {
    const ids = [36498, 90839, 15199, 17477, 76242, 104697, 87808, 88092, 88453, 19932, 77915, 50019, 50020, 86462, 59791];
    for (const id of ids) {
      const entry = HAND_CHECKED_VERDICTS.find((row) => row.feePublishedId === id);
      expect(entry, String(id)).toBeDefined();
      const row = { feePublishedId: id, feeName: entry!.feeName, amount: entry!.amount, canonicalFeeKey: entry!.canonicalFeeKey };
      expect(verdictFor(row, HAND_CHECKED_VERDICTS)?.verdict).toBe(entry!.verdict);
      // A re-filed or re-priced row is no longer the labelled record.
      expect(verdictFor({ ...row, canonicalFeeKey: "wire_intl_outgoing" }, HAND_CHECKED_VERDICTS)).toBeNull();
      expect(verdictFor({ ...row, amount: row.amount + 1 }, HAND_CHECKED_VERDICTS)).toBeNull();
    }
  });

  it("archives a hand-checked row once its second look confirms it, with the pattern in Knox's lesson", async () => {
    const handRow = { fee_published_id: 100161, fee_verified_id: 113967, institution_id: 76, source_document_id: 23020, canonical_fee_key: "cashiers_check", fee_name: "(APY) are available at any of City National Bank of Florida (CNB) banking: Cashier\u2019s Checks", amount: "0.00" };
    const query = (strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (text.includes("NOT EXISTS")) return Promise.resolve([]);
      if (text.includes("FROM pipeline_feedback")) {
        return Promise.resolve([{ fee_published_id: 100161, kind: "takedown_pending", evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: "wrong_amount:two_column_glue" } }]);
      }
      if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 100161 }]);
      return Promise.resolve([]);
    };
    const db = vi.fn(query) as unknown as ReturnType<typeof createDb>;
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve([handRow]));
    const result = await retireEvalVerdictFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason, fee.source])).toEqual([[100161, "wrong_amount:two_column_glue", "hand"]]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain('\\"pattern\\":\\"two_column_glue\\"');
    expect(calls).toContain("hand check against the bank's schedule");
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
  });

  it("reads a rate fee's floor or cap published as the fee as a wrong amount (UAT 103410)", () => {
    expect(ruleFor("cash_advance", "Signature Authorization Cash Advance Fee: 4% of transaction amount. Minimum", 4)).toBe("rate_bound");
    expect(ruleFor("cashiers_check", "Cashiers Check 1% of Check Amt Max", 5)).toBe("rate_bound");
    expect(ruleFor("check_cashing", "Check Cashing 2% or minimum", 5)).toBe("rate_bound");
    // A percent with the floor stated after it, or no percent at all, is not this shape.
    expect(ruleFor("check_cashing", "Check Cashing 2%, minimum $5", 5)).toBeNull();
    expect(ruleFor("account_research", "Research Fee minimum", 10)).toBeNull();
    expect(evalVerdictFeesSql(false)).toContain("(minimum|maximum|min|max)");
  });

  it("reads a balance-to-avoid label as not a fee at any amount (v7, Oct 9)", () => {
    expect(ruleFor("monthly_maintenance", "Minimum balance required to avoid service charge -", 50)).toBe("balance_threshold");
    expect(ruleFor("monthly_maintenance", "Minimum balance to avoid monthly service fee", 5)).toBe("balance_threshold");
    expect(ruleFor("monthly_maintenance", "Average Balance Required to Avoid Monthly Fee", 10)).toBe("balance_threshold");
    expect(ruleFor("monthly_maintenance", "minimum balance requirement to avoid the monthly maintenance fee. FAT CAT Share accounts can be opened with a", 5)).toBe("balance_threshold");
    // A $0 waiver keeps its earlier rule.
    expect(ruleFor("monthly_maintenance", "Minimum Balance to Avoid Monthly Fee", 0)).toBe("waiver_sentence");
    // A name that goes on to state the fee is the fee's own row.
    expect(ruleFor("monthly_maintenance", "Minimum balance to avoid imposition of fees - A service charge fee of", 15)).toBeNull();
    expect(ruleFor("minimum_balance", "Minimum balance to avoid imposition of fees - A club fee of", 8)).toBeNull();
    expect(ruleFor("monthly_maintenance", "average collected daily balance required to avoid monthly service charge of", 10)).toBeNull();
    expect(ruleFor("monthly_maintenance", "balance requirement to avoid the monthly service charge is met. Otherwise, a fee of", 2.5)).toBeNull();
    expect(ruleFor("nsf", "Minimum daily balance required to avoid maintenance | Bill Pay Return Item . . . .", 30)).toBeNull();
    expect(ruleFor("monthly_maintenance", "monthly fee can be avoided by keeping minimum daily balance", 8)).toBeNull();
    expect(ruleFor("minimum_balance", "Minimum Balance Fee", 10)).toBeNull();
    expect(evalVerdictFeesSql(false)).toContain("(minimum|average|min");
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb(null);
    const result = await retireEvalVerdictFees(db, { ...options, dryRun: true });
    expect(result.flags.non_customer_price).toBe(1);
    expect(result.rolledBack).toHaveLength(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
  });

  it("judges the name before a logged retidy too, so a rename alone does not clear a wrong row (v6, UAT 864)", async () => {
    const renamed = [
      // Hand-checked 100161: the retidy dropped the glued prefix; the $0 is still wrong.
      { fee_published_id: 100161, fee_verified_id: 113967, institution_id: 76, source_document_id: 23020, canonical_fee_key: "cashiers_check", fee_name: "Cashier\u2019s Checks", original_fee_name: "(APY) are available at any of City National Bank of Florida (CNB) banking: Cashier\u2019s Checks", amount: "0.00" },
      // A $0 waiver renamed to its fee's name (60387).
      { fee_published_id: 60387, fee_verified_id: 1, institution_id: 9, source_document_id: 5, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Charge", original_fee_name: "Monthly Service Charge if any of the following qualifications are met", amount: "0.00" },
      // A rebate renamed to "ATM fee" (13878).
      { fee_published_id: 13878, fee_verified_id: 2, institution_id: 9, source_document_id: 5, canonical_fee_key: "atm_non_network", fee_name: "ATM fee", original_fee_name: "ATM receipt must be presented for reimbursement of an individual ATM fee of", amount: "5.00" },
      // A rename of a right row stays live.
      { fee_published_id: 70200, fee_verified_id: 3, institution_id: 9, source_document_id: 5, canonical_fee_key: "stop_payment", fee_name: "Stop Payment", original_fee_name: "Stop Payment | per item", amount: "30.00" },
    ];
    const db = createDb(null);
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(renamed));
    const result = await retireEvalVerdictFees(db, options);
    expect(result).toMatchObject({ handMatched: 1, ruleFailing: 2, flagged: 3, evalChanged: 0 });
    expect(result.rolledBack).toEqual([]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("not_a_fee:waiver_sentence");
    expect(calls).toContain("not_a_fee:rebate");
    expect(calls).not.toContain("pub:70200");
    expect(verdictFor({ feePublishedId: 100161, feeName: "Cashier\u2019s Checks", amount: 30, canonicalFeeKey: "cashiers_check", originalFeeName: HAND_CHECKED_VERDICTS[2].feeName })).toBeNull();
    expect(evalVerdictFeesSql(false)).toContain("pf.check_name = 'knox.name_retidy' AND pf.kind = 'name_retidied'");
    expect(evalVerdictFeesSql(false)).toContain("OR retidy.old_name IS NOT NULL");
  });
});
