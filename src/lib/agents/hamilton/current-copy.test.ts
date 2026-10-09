import { describe, expect, it, vi } from "vitest";

import { currentCopyVerdict, judgeAgainstCurrentCopy, secondLookFeesNotOnCurrentCopy, type CurrentCopyFeeRow } from "./current-copy";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const OLDER = "Fee Schedule\nOverdraft Fee $35.00\nStop Payment $30.00\nWire Transfer Outgoing $25.00\nPaper Statement $3.00";
// The bank's current page: same schedule, a new stop payment price, no paper statement line.
const CURRENT = "Fee Schedule\nOverdraft Fee $35.00\nStop Payment $35.00\nWire Transfer Outgoing $25.00";

function fee(id: number, name: string, amount: string, extra: Partial<CurrentCopyFeeRow> = {}): CurrentCopyFeeRow {
  return {
    fee_published_id: id,
    fee_verified_id: id + 100,
    institution_id: 7,
    older_document_id: 40,
    current_document_id: 41,
    canonical_fee_key: "fee",
    fee_name: name,
    amount,
    restated_row: false,
    ...extra,
  };
}

const fees = [
  fee(1, "Overdraft Fee", "35.00"),
  fee(2, "Stop Payment", "30.00"),
  fee(3, "Wire Transfer Outgoing", "25.00", { restated_row: true }),
  fee(4, "Paper Statement", "3.00"),
];

describe("judgeAgainstCurrentCopy", () => {
  it("passes fees the current copy restates and suspects ones it names at another price or dropped", () => {
    const doc = judgeAgainstCurrentCopy(fees, CURRENT, OLDER);
    expect(doc.recognized).toBe(true);
    expect(doc.stated).toBe(2);
    expect(doc.passing).toEqual([1]);
    expect(doc.failing.map((candidate) => [candidate.feePublishedId, candidate.verdict, candidate.reason])).toEqual([
      [2, "still_named", "not_on_current_copy:#41"],
      [4, "dropped", "not_on_current_copy:#41"],
    ]);
  });

  it("suspects nothing when the current copy is not recognizably the same schedule", () => {
    const doc = judgeAgainstCurrentCopy(fees.map((row) => ({ ...row, restated_row: false })), "Page not found", OLDER);
    expect(doc.recognized).toBe(false);
    expect(doc.failing).toEqual([]);
  });

  it("never suspects a fee the older copy's own text does not state", () => {
    const doc = judgeAgainstCurrentCopy([...fees, fee(5, "Coin Counting", "9.00")], CURRENT, OLDER);
    expect(doc.unproven).toBe(1);
    expect(doc.failing.map((candidate) => candidate.feePublishedId)).not.toContain(5);
  });
});

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("WITH stale AS MATERIALIZED")) return Promise.resolve(fees);
    if (text.includes("FROM agent_source_texts")) {
      return Promise.resolve([
        { source_document_id: 40, normalized_text: OLDER },
        { source_document_id: 41, normalized_text: CURRENT },
      ]);
    }
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(
        pendingFlag
          ? [2, 4].map((id) => ({ fee_published_id: id, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "not_on_current_copy:#41" } }))
          : [],
      );
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 2 }, { fee_published_id: 4 }]);
    return Promise.resolve([]);
  };
  return vi.fn(query) as unknown as Parameters<typeof secondLookFeesNotOnCurrentCopy>[0] & ReturnType<typeof vi.fn>;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 9, batchId: "agentic-run-9", dryRun: false };
const due = { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() };

describe("secondLookFeesNotOnCurrentCopy", () => {
  it("only flags fees the current copy does not restate the first time, keeping them live", async () => {
    const db = createDb(null);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: true });
    expect(result).toMatchObject({ documentsChecked: 1, stated: 2, failing: 2, flagged: 2, takenDown: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_pending");
    expect(writes(db).some((text) => text.includes("hamilton.current_copy_check"))).toBe(true);
  });

  it("confirms nothing while confirmations are off, even when the second look is due", async () => {
    const db = createDb(due);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: false });
    expect(result).toMatchObject({ failing: 2, waiting: 2, takenDown: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("archives on the second look once confirmations are on, with the verified row rejected", async () => {
    const db = createDb(due);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: true });
    expect(result.takenDown.map((candidate) => [candidate.feePublishedId, candidate.reason])).toEqual([
      [2, "not_on_current_copy:#41"],
      [4, "not_on_current_copy:#41"],
    ]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb(due);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, dryRun: true, confirmLive: true });
    expect(result.takenDown).toHaveLength(2);
    expect(writes(db).some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });
});

describe("currentCopyVerdict (first hand check, 7 Oct)", () => {
  // Current-page lines that still state first-look fees (prod, 7 Oct 19:00 UTC).
  const cases: Array<[string, string, string, string]> = [
    ["wire_domestic_outgoing", "Wire transfer fee - domestic", "15.00", "Wire transfer fee\n$15.00 domestic$35.00 international\n"],
    ["wire_intl_outgoing", "Wire Transfer (Outgoing): International", "50.00", "Wire Transfer (Outgoing) | Domestic - $20.00/Transfer, International - $50.00/Transfer\n"],
    ["wire_domestic_incoming", "Domestic wire: Incoming", "10.00", "Domestic wire | Outgoing = $20 Incoming = $10\n"],
    ["stop_payment", "Stop Payment (each item, whether check or ACH)", "30.00", "Stop Payment\n(each item, whether check or ACH)\n$30 each\n"],
    ["wire_intl_outgoing", "Outgoing Business Foreign Wire Transfer fee", "50.00", "Outgoing Business Domestic Wire Transfer fee $15.00 Outgoing Business Foreign Wire Transfer fee $50.00 Outgoing Consumer Foreign\n"],
  ];
  // The older copy stated each on a row of its own; the current page lays it out differently.
  it.each(cases)("still states %s on the current page", (key, name, amount, text) => {
    const verdict = currentCopyVerdict(fee(1, name, amount, { canonical_fee_key: key }), text, `Fee Schedule\n${name} $${amount}`);
    expect(verdict).toBe("still_stated");
  });

  it("never judges a $0 row", () => {
    expect(currentCopyVerdict(fee(1, "Notary (customers only)", "0.00"), "Notary\n(customers only)\nFREE", "Notary $0.00")).toBe("unproven");
  });

  it("still suspects a fee the current page prices differently", () => {
    expect(currentCopyVerdict(fee(2, "Stop Payment", "30.00", { canonical_fee_key: "stop_payment" }), CURRENT, OLDER)).toBe("still_named");
  });
});

describe("currentCopyVerdict (second hand check, 9 Oct)", () => {
  // Tampa Bay FCU's current service-fees page (prod, document 14095).
  const TAMPA = "Checking Accounts\nFresh Start Checking\n$9.95/month\nRewards Checking      (Waived with $1,500 combined savings and checking balance or $15,000 loan balances)\n$5.95/month\nDocuments &amp; Research\n";
  const older = "Checking Accounts\nFresh Start Checking | $9.95/month\nRewards Checking (Waived with $1,500 combined savings and checking balance or $15,000 loan balances) | $5.95/month\n";

  it("reads a name Hamilton gave its account heading without the fee words", () => {
    const verdict = currentCopyVerdict(fee(1, "Fresh Start Checking Monthly Maintenance Fee", "9.95", { canonical_fee_key: "monthly_maintenance" }), TAMPA, older);
    expect(verdict).toBe("still_stated");
  });

  it("reads past a waiver condition in parentheses", () => {
    const verdict = currentCopyVerdict(fee(2, "Rewards Checking Monthly Maintenance Fee", "5.95", { canonical_fee_key: "monthly_maintenance" }), TAMPA, older);
    expect(verdict).toBe("still_stated");
  });

  it("still suspects the account fee at a new price", () => {
    const raised = TAMPA.replace("$9.95/month", "$12.95/month");
    const verdict = currentCopyVerdict(fee(1, "Fresh Start Checking Monthly Maintenance Fee", "9.95", { canonical_fee_key: "monthly_maintenance" }), raised, older);
    expect(verdict).not.toBe("still_stated");
  });
});
