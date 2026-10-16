import { describe, expect, it, vi } from "vitest";

import { businessScheduleFeesSql, footnoteMarksBusiness, pageFootnotes, restoreBusinessScheduleTakedowns, retireBusinessScheduleFees } from "./business-schedule";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const rows = [
  // A business fee beside the bank's consumer fee in the same category.
  { fee_published_id: 1, fee_verified_id: 11, institution_id: 7, source_document_id: 4, document_url: "https://bank.test/Business-Fee-Schedule.pdf", canonical_fee_key: "monthly_maintenance", amount: "20.00", consumer_fee_id: 9 },
  // No consumer fee beside it: stays live.
  { fee_published_id: 2, fee_verified_id: 12, institution_id: 7, source_document_id: 4, document_url: "https://bank.test/Business-Fee-Schedule.pdf", canonical_fee_key: "wire_domestic_outgoing", amount: "30.00", consumer_fee_id: null },
];

let footnoteRows: Array<Record<string, unknown>> = [];
const mainQuery = (db: { unsafe: ReturnType<typeof vi.fn> }) =>
  String(db.unsafe.mock.calls.map((call) => call[0]).find((text) => !String(text).includes("FROM agent_source_texts")));

function createDb(
  pendingFlag: { flag_run_id: number; flagged_at: string } | null,
  restorable: Array<Record<string, unknown>> = [],
  liveRows: Array<Record<string, unknown>> = rows,
) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 1, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "business" } }] : []);
    }
    if (text.includes("SELECT fp.fee_published_id, fp.lineage_ref")) return Promise.resolve(restorable);
    if (text.includes("SET rolled_back_at = NULL")) return Promise.resolve(restorable);
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 1 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn((text: string) => Promise.resolve(text.includes("FROM agent_source_texts") ? footnoteRows : liveRows));
  return db as unknown as Parameters<typeof retireBusinessScheduleFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 5, batchId: "agentic-run-5", dryRun: false };

describe("retireBusinessScheduleFees", () => {
  it("only logs a business fee beside a consumer fee the first time, keeping it live", async () => {
    const db = createDb(null);
    const result = await retireBusinessScheduleFees(db, options);
    expect(result).toMatchObject({ businessFees: 2, withConsumerFee: 1, flagged: 1, rolledBack: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_pending");
  });

  it("archives it on its second look, rejects the verified row and teaches Magellan, not Knox", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireBusinessScheduleFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[1, "business_schedule: consumer fee #9"]]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.business_schedule:doc:4");
    expect(calls).toContain("wrong_document");
    expect(calls).toContain('\\"discover\\"');
    expect(writes(db).some((text) => text.includes("hamilton.business_schedule_rolled_back"))).toBe(true);
  });

  it("archives a business-named fee from a mixed schedule without blaming the link (Prosperity 101925)", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() }, [], [
      { ...rows[0], document_url: "https://bank.test/disclosures/fee-schedule.pdf", canonical_fee_key: "atm_foreign", amount: "2.50", business_document: false },
    ]);
    const result = await retireBusinessScheduleFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.businessDocument])).toEqual([[1, false]]);
    expect(JSON.stringify(db.mock.calls)).not.toContain("wrong_document");
    const query = mainQuery(db);
    expect(query).toContain("fp.fee_name ~* '^\\s*(business|commercial)\\M[^|:]*$'");
    expect(query).toContain("fp.fee_name !~* '^\\s*business\\s+days?\\M'");
    expect(query).toBe(businessScheduleFeesSql(false));
  });

  it("reads verified rows about to publish against the bank's live consumer fees, with the sweep's own rule (#1069 step 2)", () => {
    const verified = businessScheduleFeesSql("verified");
    expect(verified).toContain("fv.fee_verified_id = ANY($1::bigint[])");
    expect(verified).toContain("fv.fee_name ~* '^\\s*(business|commercial)\\M[^|:]*$'");
    expect(verified).toContain("COALESCE(fv.fee_audience, 'unknown') = 'unknown'");
    // The consumer side is the bank's live fees, footnoted ones passed as $2.
    expect(verified).toContain("fp.fee_published_id = ANY($2::bigint[])");
    expect(verified).toContain("fp.institution_id IN (SELECT institution_id FROM candidates)");
    expect(verified).toContain("FROM candidates b");
    expect(businessScheduleFeesSql(true)).toContain("fp.institution_id = $1");
    expect(businessScheduleFeesSql(true)).toContain("ANY($2::bigint[])");
    expect(businessScheduleFeesSql(false)).toContain("ANY($1::bigint[])");
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireBusinessScheduleFees(db, { ...options, dryRun: true });
    expect(result.rolledBack).toHaveLength(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
  });
});

describe("restoreBusinessScheduleTakedowns", () => {
  it("brings back a takedown whose consumer fee is no longer live", async () => {
    const db = createDb(null, [{ fee_published_id: 1, lineage_ref: 11 }]);
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 5, dryRun: true })).toBe(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 5, dryRun: false })).toBe(1);
    expect(writes(db).some((text) => text.includes("hamilton.business_schedule_restored"))).toBe(true);
  });
});

type FeeRow = { fee_published_id: number; lineage_ref: number; institution_id: number; canonical_fee_key: string; amount: number; fee_name: string; source_url: string; rolled_back_reason: string | null };

/**
 * A bank's fee rows, with the restore's SELECT evaluated against them: a business-schedule
 * takedown comes back unless another row in its category is live, or (when the query says so)
 * held by the account type hold. The held-counts-as-present clause is read off the query itself.
 */
function bankDb(fees: FeeRow[]) {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("SELECT fp.fee_published_id, fp.lineage_ref")) {
      const heldCounts = text.includes("OR live.rolled_back_reason LIKE") && values.includes("account_type_hold:%");
      const present = (fee: FeeRow) => fee.rolled_back_reason == null || (heldCounts && fee.rolled_back_reason.startsWith("account_type_hold:"));
      return Promise.resolve(fees.filter((fee) =>
        fee.rolled_back_reason?.startsWith("business_schedule:") && fee.rolled_back_reason !== "business_schedule: business-only footnote" &&
        !fees.some((other) => other !== fee && present(other) && other.institution_id === fee.institution_id && other.canonical_fee_key === fee.canonical_fee_key)));
    }
    if (text.includes("SET rolled_back_at = NULL")) {
      const ids = values.find(Array.isArray) as number[];
      return Promise.resolve(fees.filter((fee) => ids.includes(fee.fee_published_id)).map((fee) => ({ ...fee, taken_down_for: fee.rolled_back_reason })));
    }
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve([]));
  return db as unknown as Parameters<typeof restoreBusinessScheduleTakedowns>[0] & typeof db;
}

const FAB = 1176;
const fabFee = (id: number, amount: number, name: string, reason: string | null): FeeRow => ({
  fee_published_id: id, lineage_ref: id + 1_000_000, institution_id: FAB, canonical_fee_key: "monthly_maintenance",
  amount, fee_name: name, source_url: `https://bank.test/${id}.pdf`, rolled_back_reason: reason,
});

describe("restoreBusinessScheduleTakedowns and the account type hold (#1100, First American Bank 16 Oct)", () => {
  it("keeps the business fees down when the hold took the bank's last consumer monthly fee", async () => {
    const db = bankDb([
      fabFee(500, 5, "Statement Savings monthly fee", "account_type_hold: savings (#1100)"),
      fabFee(111321, 15, "Monthly maintenance fee", "business_schedule: consumer fee #500"),
      fabFee(111322, 25, "Monthly maintenance fee", "business_schedule: consumer fee #500"),
      fabFee(111353, 10, "Monthly service charge", "business_schedule: consumer fee #500"),
    ]);
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 7249, dryRun: true })).toBe(0);
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 7249, dryRun: false })).toBe(0);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
  });

  it("still restores when the bank has no consumer fee in the category, live or held, and names what came back", async () => {
    const db = bankDb([
      // A live fee in another category does not keep it down.
      { ...fabFee(600, 30, "Outgoing domestic wire", null), canonical_fee_key: "wire_domestic_outgoing" },
      fabFee(111321, 15, "Monthly maintenance fee", "business_schedule: consumer fee #500"),
      // A consumer fee taken down for another reason is not there: the restore fires.
      fabFee(500, 5, "Monthly fee", "source_mismatch: #1496"),
    ]);
    db.mockClear();
    expect(await restoreBusinessScheduleTakedowns(db, { runId: 7300, dryRun: false })).toBe(1);
    const calls = JSON.stringify(db.mock.calls);
    expect(writes(db).some((text) => text.includes("hamilton.business_schedule_restored"))).toBe(true);
    expect(calls).toContain('\\"fee_published_ids\\":[111321]');
    // One weight-0 feedback row per restored fee, keyed to the run.
    expect(calls).toContain("hamilton.business_schedule:restored:pub:111321:run:7300");
    expect(calls).toContain("business_schedule_restored");
    expect(calls).toContain("business_schedule: consumer fee #500");
  });
});

const CONNECTONE = [
  "Overdraft - Insufficient Funds / Uncollected2 $40.00",
  "Redeposit/Return Item Charge $15.00",
  "1 The dormant fee does not apply to the Totally Free Checking Account",
  "2 Created by check, in-person withdrawal, ATM withdrawal, or other electronic means. Only applicable to business accounts. This",
  "fee is not charged to consumer accounts.",
  "3 Charged per statement, or image (check or deposit)",
].join("\n");

describe("restoreBusinessScheduleTakedowns and footnotes", () => {
  it("never restores a business-only footnote takedown for want of a consumer fee", async () => {
    const db = createDb(null);
    await restoreBusinessScheduleTakedowns(db, { runId: 5, dryRun: true });
    expect(JSON.stringify(db.mock.calls)).toContain("business_schedule: business-only footnote");
  });
});

describe("business-only footnotes (ConnectOne 103490, 9 Oct)", () => {
  it("treats a line marked with a business-only footnote as business", () => {
    expect(footnoteMarksBusiness(CONNECTONE, "Overdraft - Insufficient Funds / Uncollected")).toBe(true);
    expect(footnoteMarksBusiness(CONNECTONE, "Redeposit/Return Item Charge")).toBe(false);
  });

  it("leaves notes that also cover everyone, or several notes on one line", () => {
    const allAccounts = "Overdraft Charge** | $30.00 per item\n** Return Item Charge and Overdraft Charge includes all items. Charges apply to all checking and savings accounts. Continuous overdraft charge applies to commercial accounts only.";
    expect(footnoteMarksBusiness(allAccounts, "Overdraft Charge")).toBe(false);
    const runTogether = "Overdraft Protection transfer1 | $10\n1Call us to sign up; 2Subject to credit approval. 3Overdraft Protection Line of Credit is only available to business account holders.";
    expect(footnoteMarksBusiness(runTogether, "Overdraft Protection transfer")).toBe(false);
  });

  it("reads a mark as the first footnote with that mark after the line", () => {
    const sections = [
      "Overdraft Fee4 | $35.00",
      "4 A maximum of 3 Overdraft Fees will be assessed per day on consumer accounts.",
      "Transfer Charge4 | $10.00",
      "4 For business accounts only. A $10 fee for each transfer.",
    ].join("\n");
    expect(pageFootnotes(sections).map((note) => [note.mark, note.businessOnly])).toEqual([["4", false], ["4", true]]);
    expect(footnoteMarksBusiness(sections, "Overdraft Fee")).toBe(false);
    expect(footnoteMarksBusiness(sections, "Transfer Charge")).toBe(true);
  });

  it("marks the fee business in the check, so it goes through flag, second look and archive", async () => {
    footnoteRows = [{ fee_published_id: 103490, fee_name: "Overdraft - Insufficient Funds / Uncollected", normalized_text: CONNECTONE }];
    const footnoteRow = { fee_published_id: 103490, fee_verified_id: 98000, institution_id: 135, source_document_id: 23733, document_url: "https://bank.test/Miscellaneous-Bank-Fees.pdf", canonical_fee_key: "overdraft", amount: "40.00", consumer_fee_id: null, business_document: false };
    const db = createDb(null, [], [...rows, footnoteRow]);
    const result = await retireBusinessScheduleFees(db, options);
    // Flagged with no consumer overdraft beside it; the second business fee with none stays live.
    expect(result).toMatchObject({ withConsumerFee: 2, flagged: 2 });
    expect(JSON.stringify(db.mock.calls)).toContain("business-only footnote");
    const [query, params] = db.unsafe.mock.calls.find((call) => !String(call[0]).includes("FROM agent_source_texts")) as [string, unknown[]];
    expect(query).toContain("fp.fee_published_id = ANY($1::bigint[])");
    expect(params).toEqual([[103490]]);
    footnoteRows = [];
  });
});
