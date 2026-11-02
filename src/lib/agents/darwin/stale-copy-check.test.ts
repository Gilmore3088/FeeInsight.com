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
  it("ships switched on (Nov 2 dry run: 59 twins, 20 of 20 sampled right)", () => {
    expect(STALE_COPY_RETIRE_LIVE).toBe(true);
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

  it("lets one twin stand for one old fee: one retires, the other stays live", () => {
    // Two live $25 overdraft fees read from the same line of the February copy and one live
    // current-copy read of that line. Only one of them can be its twin (both match the line, so the
    // lower fee id); the other is kept live, not retired against the same twin.
    const judged = judgeStaleCopyDocument({
      fees: [
        fee({ fee_published_id: 500, fee_name: "Overdraft charge", amount: 25 }),
        fee({ fee_published_id: 12449, fee_name: "Overdraft Fee", amount: 25 }),
      ],
      twins: [twin({})],
      rawRows: [],
      currentText: CSB,
      olderText: CSB,
      knoxVersion: 156,
    });
    const byId = new Map(judged.map((row) => [row.feePublishedId, row]));
    expect([...byId.values()].filter((row) => row.verdict === "twin")).toHaveLength(1);
    expect(byId.get(500)?.verdict).toBe("twin");
    expect(byId.get(500)?.keptFeePublishedId).toBe(16570);
    expect(byId.get(12449)?.verdict).toBe("unproven");
  });

  it("pairs two old fees with two twins one to one", () => {
    const judged = judgeStaleCopyDocument({
      fees: [
        fee({ fee_published_id: 500, fee_name: "Overdraft charge" }),
        fee({ fee_published_id: 12449, fee_name: "Overdraft Fee" }),
      ],
      twins: [twin({}), twin({ fee_published_id: 16571, fee_name: "Overdraft Fee" })],
      rawRows: [],
      currentText: CSB,
      olderText: CSB,
      knoxVersion: 156,
    });
    const kept = judged.filter((row) => row.verdict === "twin").map((row) => row.keptFeePublishedId).sort();
    expect(kept).toEqual([16570, 16571]);
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

  // v2 (Nov 2 dry run over every superseded copy on prod): pairs v1 retired that are different rows.
  describe("keeps a same-price fee on another row live", () => {
    const pair = (staleName: string, twinName: string, amount: number, key: string, text: string, product: string | null = null) =>
      judgeStaleCopyDocument({
        fees: [fee({ fee_name: staleName, amount, canonical_fee_key: key, product_name: product })],
        twins: [twin({ fee_name: twinName, amount, canonical_fee_key: key, product_name: product })],
        rawRows: [],
        currentText: text,
        olderText: text,
        knoxVersion: 156,
      })[0];

    it("the stale fee's own name labels another row at the amount (institution 7477, copy 19634)", () => {
      const text = "Item cleared/Deposit pending\n\n$5.00\n\nBelow minimum balance/per day\n\n$3.00\n\nShare Accounts\n\nBelow minimum fee/each occurrence\n\n$3.00\n\nDormant accts./3 yrs. dormant/balance below $2500\n\n$2.00 / month\n";
      const judged = pair("Below minimum fee/each occurrence", "Below minimum balance/per day", 3, "minimum_balance", text);
      expect(judged.verdict).not.toBe("twin");
      expect(judged.keptFeePublishedId).toBeNull();
    });

    it("the business section's own row of the same price (institution 1263, copy 37383)", () => {
      const text = "Photocopies (Per Page) | $.25\n\nResearch/Account Reconcilement (Per Hour) | $25\n\nReturned Deposit Item | $10\n\nLost Night Depository Bag or Key Replacement | $25\n\nPhoto Copy Service | $.25\n\nAccount Reconciliation Per Hour | $25\n";
      const judged = pair("Account Reconciliation Per Hour", "Research/Account Reconcilement (Per Hour)", 25, "account_research", text);
      expect(judged.verdict).not.toBe("twin");
    });

    it("two fees in two cells of one row (institution 8640, copy 13955)", () => {
      const text = "Account History (since last statement) | $5.00 | Mailed Paper Statement Fee | $5.00\n";
      const judged = pair("Account History (since last statement)", "Mailed Paper Statement Fee", 5, "paper_statement", text);
      expect(judged.verdict).not.toBe("twin");
    });

    it("a qualifier the twin's row does not print (institution 655, copy 41100)", () => {
      const text = "*Processing Fee of $95.00 is charged on all personal savings secured loans.\n\nPersonal Unsecured Loans\n\n*Processing Fee of $95.00 is charged on all consumer personal unsecured loans.\n";
      const judged = pair("Processing Fee (personal unsecured loans)", "Processing Fee (personal savings secured loans)", 95, "loan_origination", text);
      expect(judged.verdict).not.toBe("twin");
      expect(judged.keptFeePublishedId).toBeNull();
    });

    it("two long rows at one price that the matcher reads as one sentence (institution 1606, copy 38976)", () => {
      const text = "Online Cash Management for Commercial Customers (no charge for basic service)\n\nOverdraft Fee (Per item covering overdrafts created by check, in-person withdrawal, ACH or other electronic means. No more than six (6) Overdraft/Return Item Fees (Fee) may be charged against your account per day. Additionally, Overdraft/Return Item Fees will be waived if a Non-sufficient Funds (NSF) item is less than the Fee amount; if an NSF item is re-presented and was previously charged the Fee; or if an NSF item overdraws the account by less than $20.)\u00a0 $35.00\n\nOverdraft Fee under Bounce Protection (Per item for returned items or debits created by check, ACH or other electronic means. No more than six (6) Overdraft/Return Items Fees (Fee) may be charged against your account per day. Additionally, Overdraft/Return Item Fees will be waived if a Non-sufficient Funds (NSF) item is less than the Fee amount; if an NSF item is re-presented and was previously charged the Fee; or if an NSF item overdraws the account by less that $20.) Refer to Bounce Protection Overdraft Disclosure.)\u00a0 $35.00\n";
      const judged = pair("Refer to Bounce Protection Overdraft Disclosure", "Overdraft Fee", 35, "overdraft", text);
      expect(judged.verdict).not.toBe("twin");
      expect(judged.keptFeePublishedId).toBeNull();
    });

    it("still retires a twin whose qualifier is its product (institution 2415, copy 36355)", () => {
      const text = "Regular Checking\n\nxClose dialog\n\n$7.00 Monthly Service Charge\n(To avoid the service charge, maintain an average daily balance of $300.00 or more)\n$50.00 Minimum Deposit to Open Account\nFDIC Insured\n";
      const judged = pair("Regular Checking Monthly Service Charge", "Monthly Service Charge", 7, "monthly_maintenance", text, "Regular Checking");
      expect(judged.verdict).toBe("twin");
      expect(judged.keptFeePublishedId).toBe(16570);
    });
  });

  it("judges nothing without the current copy's text", () => {
    const [judged] = judgeStaleCopyDocument({ fees: [fee({})], twins: [twin({})], rawRows: [], currentText: null, olderText: CSB, knoxVersion: 156 });
    expect(judged.verdict).toBe("no_text");
  });
});
