import { describe, expect, it } from "vitest";
import { KNOX_STALE_READ_BELOW_VERSION } from "@/lib/agents/knox/extract";
import {
  STALE_COPY_DROPPED_LINE_LIVE,
  STALE_COPY_DROPPED_REASON_PREFIX,
  STALE_COPY_RETIRE_LIVE,
  STALE_COPY_SETTLED_READ_FLOOR,
  pageTextOverlap,
  requiredCurrentReadVersion,
  samePageUrl,
  stillNamedAndPriced,
  STALE_COPY_TWIN_REASON_PREFIX,
  judgeStaleCopyDocument,
  printsAmount,
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
    older_url: "https://www.csbiowa.example/fees",
    current_url: "https://csbiowa.example/fees/",
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
  it("ships switched on (Nov 2 dry run: 57 twins, 20 of 20 sampled right)", () => {
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
      // Off, so the fee waits on Knox; on, the same-category, same-price live read keeps it live (`restated`). Neither is a twin.
      droppedLine: false,
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

  it("with the dropped-line switch off, waits for a current-version Knox read before reading Knox's silence", () => {
    const judge = (droppedLine: boolean) => judgeStaleCopyDocument({
      fees: fees.map((row) => ({ ...row, current_read_version: 155 })), twins: [], rawRows: [], currentText: CSB, olderText: older, knoxVersion: 156, droppedLine,
    });
    expect(judge(false)[0].verdict).toBe("waiting_reread");
    // On (the shipped setting), a read at or above the stale-read floor and the fee's own read version counts.
    expect(judge(true)[0].verdict).toBe("dropped");
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

  it("counts a fee a guard keeps live on the dropped side of the same-schedule count (review of #2950)", () => {
    // Two fees still stated, one restated by a live read of the current copy, two gone: 2 of 5 carried
    // is not the same schedule, so the two gone fees stay live, as they did before the guards.
    const olderPlus = `${CSB}\nEscrow Services- $100.00 per request\nCourier Fee- $40.00 per package\nNotary Fee- $12.00 per signature\n`;
    const five = [
      ...fees,
      fee({ fee_published_id: 4, canonical_fee_key: "courier", fee_name: "Courier Fee", amount: 40, fee_read_version: 150 }),
      fee({ fee_published_id: 5, canonical_fee_key: "notary", fee_name: "Notary Fee", amount: 12, fee_read_version: 150 }),
    ].map((row) => ({ ...row, current_read_version: 163 }));
    const judged = judgeStaleCopyDocument({
      fees: five,
      twins: [twin({ fee_published_id: 300001, canonical_fee_key: "notary", fee_name: "Notarization", amount: 12 })],
      rawRows: [],
      currentText: CSB,
      olderText: olderPlus,
      knoxVersion: 163,
      // The fee-count test alone: with the switch on, this same-address page is also recognized by its text.
      droppedLine: false,
    });
    const byId = Object.fromEntries(judged.map((row) => [row.feePublishedId, row.verdict]));
    expect(byId[5]).toBe("restated");
    expect([byId[2], byId[3]]).toEqual(["stated", "stated"]);
    expect([byId[1], byId[4]]).toEqual(["not_same_schedule", "not_same_schedule"]);
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

    it("a card section's own row inside whose text the stale row's name sits (institution 6137, copy 31119)", () => {
      const text = "Inquiries at All ATMs | $1.00\n\nGeneral Fees\n\nLoan Late Payment | $25.00 Flat Fee\n\nWire Transfers (Domestic Outgoing) | $20.00\n\nMoney Orders | $2.50\n\nCashier's Checks | $5.00\n\nVisa Credit Cards\n\nVisa Credit Card Annual Fee | None\n\nLost Card Replacement | $5.00\n\nCopy of Credit Card Sales Draft | $5.00\n\nReturn Check | $30.00\n\nLate Payment | $25.00\n\nVisa Gift Card | $3.00\n";
      const judged = pair("Loan Late Payment", "Late Payment", 25, "late_payment", text);
      expect(judged.verdict).not.toBe("twin");
      expect(judged.keptFeePublishedId).toBeNull();
    });

    it("reads a row's price with or without the dollar sign, never a whole number or a rate", () => {
      expect(printsAmount("Overdraft Fee (paid item) 35.00", 35)).toBe(true);
      expect(printsAmount("Overdraft Fee | $35", 35)).toBe(true);
      expect(printsAmount("Same Day ACH | $.50", 0.5)).toBe(true);
      expect(printsAmount("No more than 35 items a day", 35)).toBe(false);
      expect(printsAmount("APR 35.00%", 35)).toBe(false);
      expect(printsAmount("Item 1,035.00", 35)).toBe(false);
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

  // Live-site audit draw 275762: Olympia Federal (institution 1020) dropped its HELOC third-party fee
  // estimates from olyfed.com/rates/ between the Oct 9 copy (23786) and the Nov 2 copy (41830); fee
  // 103684 "Tax Registration" $81 stayed live. Excerpts of both stored texts.
  const OLYFED_SHARED = `Home Equity Line of Credit (HELOC)

HELOC Type | Interest Rate | Annual Percentage Rate (APR) | Loan Fee

The value of the index is based on the Wall Street Journal Prime Rate.

*Maximum Loan Amount is $400,000.

FEES AND CHARGES. To open and maintain a line of credit, you must pay the following fees to us:

Maintenance: $50.00 (due annually). Note that some fees may only apply upon the occurrence of an event.

Olympia Federal Savings reserves the right to charge the customer a fee, as allowed by law, for any check tendered that is not honored.

Personal Loan Type | Annual Percentage Rate (APR) | Terms | Comments

Share Secured Loan | 2.00% above share rate | Up to 60 months

Overdraft Fee | $30.00 per item, maximum for OD charges $125.00 per day

Certificates of Deposit (CD) | Minimum to Open | Annual Percentage Yield (APY)

Consumer Account Type | Minimum to Open | Minimum to Earn APY | Compounding Method

Rates are subject to change without notice. Fees may reduce earnings.

Equal Housing Lender`;
  const OLYFED_OCT = `${OLYFED_SHARED}

You must also pay certain fees to third parties. These fees generally total $1,473.00 to $3,418.00.

The following are an estimate of third-party fees:

Recording Fees: $350.00

Escrow Fee: $500.00

E-Recording Fee: $10.00

Flood Determination: $17.00

Tax Registration: $81.00

Foreclosure Prevention Fee: $80.00`;
  const OLYFED_NOV = `${OLYFED_SHARED}

You must also pay certain fees to third parties. These fees generally total between $1,487 and $3,432.`;
  const olyfed = (id: number, name: string, amount: number, key = "other_lending_fee") =>
    fee({
      fee_published_id: id, institution_id: 1020, older_document_id: 23786, current_document_id: 41830, canonical_fee_key: key, fee_name: name, amount,
      fee_read_version: 65, current_read_version: 120, older_url: "https://www.olyfed.com/rates/", current_url: "https://www.olyfed.com/rates/",
    });
  const olyfedFees = [
    olyfed(103670, "Maintenance", 50, "heloc_annual_fee"),
    olyfed(103667, "Maximum for OD charges", 125, "od_daily_cap"),
    olyfed(103680, "Recording Fees", 350),
    olyfed(103681, "Escrow Fee", 500),
    olyfed(103682, "E-Recording Fee", 10),
    olyfed(103683, "Flood Determination", 17),
    olyfed(103684, "Tax Registration", 81),
    olyfed(103685, "Foreclosure Prevention Fee", 80),
  ];
  const judgeOlyfed = (droppedLine: boolean, currentReadVersion: number | null = 120) =>
    judgeStaleCopyDocument({
      fees: olyfedFees.map((row) => ({ ...row, current_read_version: currentReadVersion })),
      twins: [], rawRows: [], currentText: OLYFED_NOV, olderText: OLYFED_OCT, knoxVersion: 163, droppedLine,
    });

  describe("dropped line (STALE_COPY_DROPPED_LINE_LIVE)", () => {
    it("ships switched on (Nov 2 re-run: 15 drops at 11 institutions, all absent from the current copy)", () => {
      expect(STALE_COPY_DROPPED_LINE_LIVE).toBe(true);
    });

    it("counts a Knox read from Knox's own stale-read floor, never below the fee's read version", () => {
      expect(STALE_COPY_SETTLED_READ_FLOOR).toBe(KNOX_STALE_READ_BELOW_VERSION);
      expect(requiredCurrentReadVersion(65, 163, false)).toBe(163);
      expect(requiredCurrentReadVersion(65, 163, true)).toBe(STALE_COPY_SETTLED_READ_FLOOR);
      expect(requiredCurrentReadVersion(150, 163, true)).toBe(150);
      expect(requiredCurrentReadVersion(null, 163, true)).toBe(STALE_COPY_SETTLED_READ_FLOOR);
    });

    it("off: Olympia Federal's dropped HELOC lines wait on a v163 read the backlog had not reached (draw 275762)", () => {
      expect(judgeOlyfed(false).map((row) => row.verdict)).toEqual(["stated", "stated", ...Array(6).fill("waiting_reread")]);
    });

    it("on: the six lines the Nov 2 copy no longer prints come down, fee 103684 among them", () => {
      const judged = judgeOlyfed(true);
      expect(judged.map((row) => row.verdict)).toEqual(["stated", "stated", ...Array(6).fill("dropped")]);
      const tax = judged.find((row) => row.feePublishedId === 103684);
      expect(tax?.reason).toBe(`${STALE_COPY_DROPPED_REASON_PREFIX}41830 (Knox v120; read from #23786)`);
    });

    it("on: still waits while Knox has not read the current copy at all", () => {
      expect(judgeOlyfed(true, null).slice(2).every((row) => row.verdict === "waiting_reread")).toBe(true);
    });

    it("on: a copy from another address, or whose text mostly changed, is not the same page", () => {
      const moved = judgeStaleCopyDocument({
        fees: olyfedFees.map((row) => ({ ...row, current_url: "https://www.olyfed.com/heloc/" })),
        twins: [], rawRows: [], currentText: OLYFED_NOV, olderText: OLYFED_OCT, knoxVersion: 163, droppedLine: true,
      });
      expect(moved.slice(2).map((row) => row.verdict)).toEqual(Array(6).fill("not_same_page"));
      const rewritten = judgeStaleCopyDocument({
        fees: olyfedFees.map((row) => ({ ...row, current_read_version: 120 })),
        twins: [], rawRows: [],
        currentText: "Maintenance: $50.00 (due annually).\n\nMaximum for OD charges $125.00 per day.\n\nA new page about something else entirely.",
        olderText: OLYFED_OCT, knoxVersion: 163, droppedLine: true,
      });
      expect(rewritten.slice(2).map((row) => row.verdict)).toEqual(Array(6).fill("not_same_schedule"));
    });

    it("measures the page's lines carried over", () => {
      expect(pageTextOverlap(OLYFED_OCT, OLYFED_NOV)).toBeGreaterThanOrEqual(0.6);
      expect(pageTextOverlap(OLYFED_OCT, "Page not found.")).toBe(0);
      expect(samePageUrl("https://www.olyfed.com/rates/", "http://olyfed.com/rates?utm=x")).toBe(true);
      expect(samePageUrl("https://www.regions.com/virtualDocuments/Checking-Pricing-Schedule.pdf",
        "https://www.regions.com/-/media/pdfs/pricing-schedules/Checking-Pricing-Schedule.pdf")).toBe(false);
      expect(samePageUrl(null, null)).toBe(false);
    });
  });

  // Nov 2 dry run of the dropped line: would-be drops whose current copy still prints the fee.
  describe("keeps a fee the current copy still names and prices", () => {
    it.each([
      ["a price a two-column layout put above the name", "Account Reconciliation fee", 10, "CARDS | $10.00 per hour /\nAccount Reconciliation fee\n$5.00 minimum"],
      ["an interleaved table", "ACCOUNT RESEARCH (1 hour minimum)", 20, "to Open | to Obtain APY | ACCOUNT RESEARCH (1 hour minimum)\n31-day | $1,000 | $1,000 | At Maturity | $20 per hour and $ 50 per copy"],
      ["a name stored with an HTML entity", "Levy &amp; Garnishment", 100, "Paper Statement Fee | $3.00 per statement\n\nLevy & Garnishment | $100.00"],
      ["a name glued to its neighbour's words", "processing Fee varies IRA transfer fee to another financial institution", 30, "- Without eStatements $2 per month\nIRA transfer fee to another financial institution $30 each"],
      ["a table flattened column by column", "Monthly fee", 25, "Interest bearing\n\nMonthly fee\n\nBusiness Solutions\nChecking w/ Interest2\n\nNo\n\n$25\n\nEarnings credit"],
      ["one part of a slash-joined name", "Paid Overdraft Item/Returned Item Fee", 36, "Paid Overdraft Item Fee 3 . . . . . . . . . . $36.00"],
    ])("%s", (_label, name, amount, text) => {
      expect(stillNamedAndPriced(text, name, amount)).toBe(true);
    });

    it("but not one whose price or name is gone", () => {
      expect(stillNamedAndPriced("Statement copy fee | $5.00 per statement", "Statement copy fee", 2.5)).toBe(false);
      expect(stillNamedAndPriced("Check Cashing | $5.00\nCopy of Cleared Check | $5.00 per copy", "Certified Checks/Credit Union Checks/Telephone Check", 5)).toBe(false);
    });

    it("judges such a fee named_and_priced, and a same-category live read at its amount restated", () => {
      // A two-column layout put the price on the row above the name (institution 5103's current copy).
      const text = `${OLYFED_NOV}\n\nTitle insurance and recording estimates\nCOUNTY | $81.00 per filing /\nTax Registration\n$5.00 minimum`;
      const named = judgeStaleCopyDocument({
        fees: olyfedFees, twins: [], rawRows: [], currentText: text, olderText: OLYFED_OCT, knoxVersion: 163, droppedLine: true,
      }).find((row) => row.feePublishedId === 103684);
      expect(named?.verdict).toBe("named_and_priced");
      const restated = judgeStaleCopyDocument({
        fees: olyfedFees,
        twins: [twin({ fee_published_id: 200001, current_document_id: 41830, canonical_fee_key: "other_lending_fee", fee_name: "County tax registration", amount: 81 })],
        rawRows: [], currentText: OLYFED_NOV, olderText: OLYFED_OCT, knoxVersion: 163, droppedLine: true,
      }).find((row) => row.feePublishedId === 103684);
      expect(restated?.verdict).toBe("restated");
    });
  });
});
