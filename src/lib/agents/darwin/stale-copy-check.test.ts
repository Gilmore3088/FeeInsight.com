import { describe, expect, it } from "vitest";
import {
  STALE_COPY_DROPPED_REASON_PREFIX,
  STALE_COPY_RETIRE_LIVE,
  STALE_COPY_TWIN_REASON_PREFIX,
  judgeStaleCopyDocument,
  staleCopyFindings,
  type StaleCopyFeeRow,
  type StaleCopyTwinRow,
} from "./stale-copy-check";

// Citizens Savings Bank (IA, institution 3416): the stored text of its fee page (excerpt, document
// 38158, the current copy; the February copy 1048 has the same text).
const CSB = `Account Research or Balancing- $25.00 per hour*-$25.00 minimum

Check Copies- $1.00 per check*

Dormant Account Fee- $3.00 per month (after 24 months of inactivity and applies to all accounts)

Stop Payment - all items- $15.00 per item*

Stop Payment - lost checkbook- $30.00*

Wire Transfer (incoming)- $10.00

Wire Transfer (outgoing - domestic)- $20.00

Overdraft Policy

All items returned for non-sufficient funds (NSF) will be charged $25.00 per presentment returned. An overdraft charge of $25.00 per presentment with a maximum of $125.00 per day. AT THE DISCRETION OF THE BANK, IF YOUR ACCOUNT IS CONTINUALLY OVERDRAWN FOR ANY LENGTH OF TIME, WE RESERVE THE RIGHT TO CLOSE YOUR ACCOUNT AND RETURN ALL CHECKS.
`;

function fee(overrides: Partial<StaleCopyFeeRow>): StaleCopyFeeRow {
  return {
    fee_published_id: 1,
    fee_verified_id: 11,
    institution_id: 3416,
    older_document_id: 1048,
    current_document_id: 38158,
    canonical_fee_key: "overdraft",
    fee_name: "Overdraft Fee",
    amount: 25,
    product_name: null,
    fee_audience: null,
    fee_read_version: null,
    current_read_version: 104,
    ...overrides,
  };
}

function twin(overrides: Partial<StaleCopyTwinRow>): StaleCopyTwinRow {
  return {
    fee_published_id: 16570,
    current_document_id: 38158,
    canonical_fee_key: "overdraft",
    fee_name: "Overdraft charge",
    amount: 25,
    product_name: null,
    fee_audience: null,
    ...overrides,
  };
}

describe("stale copy check", () => {
  it("ships switched off", () => {
    expect(STALE_COPY_RETIRE_LIVE).toBe(false);
  });

  it("retires the February copy's Overdraft Fee $25 beside the current copy's Overdraft charge $25 (3416)", () => {
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ fee_published_id: 12449, fee_verified_id: 4649 })],
      twins: [twin({})],
      rawRows: [],
      currentText: CSB,
      olderText: CSB,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("twin");
    expect(judged.keptFeePublishedId).toBe(16570);
    expect(judged.reason).toBe(`${STALE_COPY_TWIN_REASON_PREFIX}16570 (#1048 -> #38158)`);
  });

  it("keeps a stale fee the current copy still prints when no live twin carries it (3416's daily cap)", () => {
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ fee_published_id: 12347, canonical_fee_key: "od_daily_cap", fee_name: "Overdraft Daily Cap", amount: 125 })],
      twins: [twin({})],
      rawRows: [],
      currentText: CSB,
      olderText: CSB,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("stated");
  });

  it("keeps a stale fee that traces to a line of its own, not the twin's", () => {
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ canonical_fee_key: "stop_payment", fee_name: "Stop Payment - lost checkbook", amount: 30 })],
      twins: [twin({ canonical_fee_key: "stop_payment", fee_name: "Lost Safe Deposit Box Key", amount: 30 })],
      rawRows: [],
      currentText: `${CSB}\nLost Safe Deposit Box Key- $30.00\n`,
      olderText: CSB,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("stated");
  });

  it("takes no same-price fee on another line for a twin", () => {
    const text = `${CSB}\nChecking Dormant Charges- $5.00 per month\n`;
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ canonical_fee_key: "dormant_account", fee_name: "Savings Dormant Charges", amount: 5 })],
      twins: [twin({ canonical_fee_key: "dormant_account", fee_name: "Checking Dormant Charges", amount: 5 })],
      rawRows: [],
      currentText: text,
      olderText: `${text}\nSavings Dormant Charges- $5.00 per month\n`,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("waiting_reread");
  });

  // Prod dry run sample (stored texts, read-only, Nov 2), as excerpts.
  it("retires a stale fee whose twin reads the same row under the heading's name (fee 1378)", () => {
    const text = "r prior month - $25.00/month\n\nResearching account activity - $20.00/hour\n\nReturn Item - $20.00/each\n\nStop Payments - $30.00/each\n";
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ fee_published_id: 1378, canonical_fee_key: "account_research", fee_name: "Researching Account Activity", amount: 20 })],
      twins: [twin({ fee_published_id: 154320, canonical_fee_key: "account_research", fee_name: "Reconciliation fees: Researching account activity", amount: 20 })],
      rawRows: [],
      currentText: text,
      olderText: text,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("twin");
    expect(judged.keptFeePublishedId).toBe(154320);
  });

  it("keeps two rows at one price apart (fee 118079, cashier's check first and after one a day)", () => {
    const text = "Description | Fee | Waiver*\n\nCashierʼs check, first 1 per day | $3 each\n\nCashierʼs check, after 1 per day | $3 each\n\nPrint account history | $3\n";
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ fee_published_id: 118079, canonical_fee_key: "cashiers_check", fee_name: "Cashierʼs check, first 1 per day", amount: 3 })],
      twins: [twin({ fee_published_id: 111580, canonical_fee_key: "cashiers_check", fee_name: "Cashierʼs check, after 1 per day", amount: 3 })],
      rawRows: [],
      currentText: text,
      olderText: text,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("stated");
  });

  it("keeps Savings Dormant Charges beside a live Checking Dormant Charges (fee 40421)", () => {
    const text = "Checking Dormant Charges | $5.00 monthly if balance is below $100.\n\nSavings Dormant Charges | $5.00 quarterly if balance is below $100.\n\nStop Payment | $20.00\n";
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ fee_published_id: 40421, canonical_fee_key: "dormant_account", fee_name: "Savings Dormant Charges", amount: 5 })],
      twins: [twin({ fee_published_id: 85084, canonical_fee_key: "dormant_account", fee_name: "Checking Dormant Charges", amount: 5 })],
      rawRows: [],
      currentText: text,
      olderText: text,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("stated");
  });

  it("needs a twin of the same audience and product", () => {
    const [judged] = judgeStaleCopyDocument({
      fees: [fee({ fee_audience: "business" })],
      twins: [twin({ fee_audience: "consumer" })],
      rawRows: [],
      currentText: CSB,
      olderText: CSB,
      knoxVersion: 156,
    });
    expect(judged.verdict).toBe("stated");
  });

  const older = `${CSB}\nEscrow Services- $100.00 per request\n`;
  const fees = [
    fee({ fee_published_id: 1, canonical_fee_key: "escrow", fee_name: "Escrow Services", amount: 100, fee_read_version: 150 }),
    fee({ fee_published_id: 2, canonical_fee_key: "stop_payment", fee_name: "Stop Payment - all items", amount: 15, fee_read_version: 150 }),
    fee({ fee_published_id: 3, canonical_fee_key: "wire_domestic_incoming", fee_name: "Wire Transfer (incoming)", amount: 10, fee_read_version: 150 }),
  ];

  it("retires a fee the current copy dropped once Knox read the current text at the current rules version", () => {
    const judged = judgeStaleCopyDocument({ fees: fees.map((row) => ({ ...row, current_read_version: 156 })), twins: [], rawRows: [], currentText: CSB, olderText: older, knoxVersion: 156 });
    expect(judged.map((row) => row.verdict)).toEqual(["dropped", "stated", "stated"]);
    expect(judged[0].reason).toBe(`${STALE_COPY_DROPPED_REASON_PREFIX}38158 (Knox v156; read from #1048)`);
    const findings = staleCopyFindings(judged);
    expect(findings.matched).toBe(1);
    expect(findings.byVerdict).toMatchObject({ dropped: 1, stated: 2 });
  });

  it("waits for a current-version Knox read before reading Knox's silence", () => {
    const judged = judgeStaleCopyDocument({ fees: fees.map((row) => ({ ...row, current_read_version: 155 })), twins: [], rawRows: [], currentText: CSB, olderText: older, knoxVersion: 156 });
    expect(judged[0].verdict).toBe("waiting_reread");
  });

  it("never reads a current copy Knox read below the fee's own read version", () => {
    const judged = judgeStaleCopyDocument({
      fees: fees.map((row) => ({ ...row, fee_read_version: 160, current_read_version: 156 })), twins: [], rawRows: [], currentText: CSB, olderText: older, knoxVersion: 156,
    });
    expect(judged[0].verdict).toBe("waiting_reread");
  });

  it("keeps a fee Knox still reads from the current copy under its own name", () => {
    const judged = judgeStaleCopyDocument({
      fees: fees.map((row) => ({ ...row, current_read_version: 156 })),
      twins: [],
      rawRows: [{ current_document_id: 38158, fee_name: "Escrow  services", amount: "100.00" }],
      currentText: CSB,
      olderText: older,
      knoxVersion: 156,
    });
    expect(judged[0].verdict).toBe("knox_reads_it");
  });

  it("leaves a fee the older copy's text does not state either (the matcher's miss)", () => {
    const judged = judgeStaleCopyDocument({ fees: fees.map((row) => ({ ...row, current_read_version: 156 })), twins: [], rawRows: [], currentText: CSB, olderText: CSB, knoxVersion: 156 });
    expect(judged[0].verdict).toBe("unproven");
  });

  it("reads no drop from a current copy that is not recognizably the same schedule", () => {
    const judged = judgeStaleCopyDocument({
      fees: fees.map((row) => ({ ...row, current_read_version: 156 })),
      twins: [],
      rawRows: [],
      currentText: "Page not found. Return to the home page.",
      olderText: older,
      knoxVersion: 156,
    });
    expect(judged.map((row) => row.verdict)).toEqual(["not_same_schedule", "not_same_schedule", "not_same_schedule"]);
    expect(staleCopyFindings(judged).matched).toBe(0);
  });

  it("judges nothing without the current copy's text", () => {
    const [judged] = judgeStaleCopyDocument({ fees: [fee({})], twins: [twin({})], rawRows: [], currentText: null, olderText: CSB, knoxVersion: 156 });
    expect(judged.verdict).toBe("no_text");
  });
});
