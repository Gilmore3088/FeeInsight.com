import { describe, expect, it, vi } from "vitest";
import {
  SAME_LINE_READ_TAKEDOWN_LIVE,
  findSameLineReads,
  recheckSameLineReads,
  sameLineReadDetail,
  type SameLineReadRow,
} from "./same-line-read-check";

type Group = [institution: number, document: number, key: string, amount: number, audience: string, excerpt: string, prints: number,
  rows: Array<[id: number, name: string, frequency: string | null]>];

/** Groups from the prod dry run, 2026-10-26 (read-only, `SAME_LINE_READ_ROWS_SQL`): 10 that come down, 8 that stay. */
const PROD: Group[] = [
  // #1876: Access FCU's one line, a deterministic read and a paid read.
  [7235, 28555, "overdraft", 30, "consumer", "- $30.00 charge for each one-time debit overdraft.", 1, [[132908, "charge for each one-time debit overdraft", null], [137315, "One-time debit overdraft charge", "per_item"]]],
  [101, 11996, "atm_non_network", 2.5, "unknown", "$2.50* per atm transaction. in addition to our fee, the bank/atm you use to withdraw funds may charge you their own fee.", 1,
    [[23345, "per ATM transaction. In addition to our fee, the bank/ATM you use to withdraw funds may charge you their own fee.", null], [67479, "ATM transaction fee", "per_transaction"]]],
  [2211, 13970, "notary_fee", 0, "consumer", "notary service - customer | item | free", 1, [[53415, "Notary Service - Customer", null], [88235, "Notary Service - Customer: Item", null]]],
  [2603, 32822, "ira_termination", 25, "unknown", "effective july 15, 2008, there will be an ira transfer fee of $25.00", 1, [[132329, "Effective July 15, 2008, there will be an IRA transfer fee of", null], [132331, "IRA transfer fee", "one_time"]]],
  [75, 19575, "safe_deposit_box", 60, "consumer", "5 x 5: $60.00", 1, [[66235, "5 x 5", "annual"], [158225, "Safe Deposit Box 5 x 5", null]]],
  [35, 22562, "safe_deposit_box", 100, "consumer", "6x16 $100", 1, [[144418, "6x16", "annual"], [158331, "Safe Deposit Box 6x16", null]]],
  [5140, 16676, "safe_deposit_box", 65, "unknown", "10x10 | $65.00", 1, [[53859, "10x10", "annual"], [158412, "Safe Deposit Box 10x10", null]]],
  [211, 7629, "safe_deposit_box", 155, "unknown", "3 x 5 | $50 | 4 x 10 | $110 | 9 x 10 | $155 | an exceptional checking or an exceptional choice checking", 1, [[24535, "9 x 10", "annual"], [159095, "Safe Deposit Box 9 x 10", null]]],
  [965, 32498, "safe_deposit_box", 20, "consumer", "2\" x 5\" box | $20.00", 1, [[153881, "2\" x 5\" Box", null], [158902, "Safe Deposit Box 2\" x 5\"", "annual"]]],
  [4484, 1977, "overdraft", 29, "consumer", "balance, your account will be assessed the overdraft fee of $29 according", 1, [[65292, "Overdraft fee", null], [82121, "Overdraft fee (overdrafts 2-5)", "per_item"]]],
  // Stay: two prices in one window, four account columns, a line printed more than once, frequencies that differ, names that share no reading.
  [6852, 3038, "overdraft", 31, "consumer", "average daily balance is not met, you will not earn the | • courtesy pay fee……………… $31.00/item | • ach overdraft fee ...................... ………$31.00/item", 1,
    [[30154, "ACH Overdraft Fee", "per_item"], [68305, "Courtesy Pay Fee", "per_item"]]],
  [5351, 22475, "paper_statement", 2, "consumer", "mailed paper statement fee fee assessed on the 1st day of the following month | $2 | $2 | $2 | $2", 1,
    [[96597, "Mailed Paper Statement Fee Fee assessed on the 1st day of the following month", null], [96654, "Mailed Paper Statement Fee", "monthly"]]],
  [5576, 20858, "nsf", 28, "consumer", "- nonsufficient funds fee of $28.00 per submission/resubmission of an item.", 4, [[85707, "Nonsufficient funds fee", "per_item"], [85709, "Nonsufficient funds fee (VISA ATM)", "per_item"]]],
  [2238, 24440, "early_closure", 20, "consumer", "$20 early closing fee if account is closed within 6 months of opening", 3,
    [[111144, "early closing fee if account is closed within 6 months of opening", null], [111145, "Early closing fee (RewardsPLUS Checking)", "one_time"]]],
  [2562, 28346, "minimum_balance", 1, "consumer", "there is a $2,500.00 minimum opening balance, a maintenance fee of $1.00 per withdrawal after 6 per statement cycle and $1.00 minimum balance fee if balance falls below $50.00 per", 1,
    [[152159, "Maintenance fee (balance falls below $50.00)", "per_transaction"], [152160, "Minimum balance fee (Bonus Savings)", "monthly"]]],
  [4484, 19230, "overdraft", 10, "consumer", "6th or more items $10.00", 1,
    [[65296, "One-Time Debit Transaction Overdraft Coverage: (6th or more items)", null], [65300, "Courtesy Pay overdraft fee (6th or more items)", "per_item"]]],
  [2854, 27034, "overdraft", 35, "unknown", "nsf fee: | nsf return item fee is $35.00 per item; nsf paid item fee is $35.00 per", 1, [[125145, "per item; NSF Paid Item Fee", "per_item"], [157271, "NSF Paid Item Fee", null]]],
  [575, 18816, "minimum_balance", 3, "unknown", "$3 per quarter charge if balance drops below $1", 1,
    [[64144, "Per quarter charge (balance drops below $1)", "quarterly"], [64145, "Quarterly charge if balance drops below $1", "quarterly"]]],
];

function rows(groups: Group[]): SameLineReadRow[] {
  return groups.flatMap(([institution, document, key, amount, audience, excerpt, prints, fees]) => fees.map(([id, name, frequency]) => ({
    fee_published_id: id, fee_verified_id: id + 1_000_000, institution_id: institution, fee_name: name, amount, canonical_fee_key: key,
    variant: "", frequency, audience, product_key: "", source_document_id: document, excerpt, line_prints: prints,
  })));
}

describe("findSameLineReads (#1876)", () => {
  it("takes down the second read of each printed line and keeps the read that states its frequency", () => {
    const found = findSameLineReads(rows(PROD));
    expect(found).toMatchObject({ checked: 36, groups: 18, matched: 10, institutions: 10 });
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId])).toEqual([
      [23345, 67479], [65292, 82121], [88235, 53415], [132329, 132331], [132908, 137315],
      [153881, 158902], [158225, 66235], [158331, 144418], [158412, 53859], [159095, 24535],
    ]);
    expect(found.matches.find((match) => match.feePublishedId === 132908)?.reason).toBe("same_line_duplicate: live fee #137315");
    expect(found.passing).toHaveLength(26);
    expect(found.passing).toEqual(expect.arrayContaining([137315, 30154, 68305, 96597, 85707, 111144, 152159, 152160, 65296, 125145, 64144]));
  });

  it("keeps the oldest of equal reads, and a fee alone on its line or with no line", () => {
    const found = findSameLineReads(rows([
      [1, 1, "stop_payment", 30, "consumer", "stop payment | $30", 1, [[9, "Stop Payment", null], [3, "Stop Payment Fee", null], [5, "Stop payment", null]]],
      [1, 2, "stop_payment", 30, "consumer", "stop payment | $30", 1, [[11, "Stop Payment", null]]],
      [1, 3, "stop_payment", 30, "consumer", "", 1, [[12, "Stop Payment", null], [13, "Stop Payment", null]]],
    ]));
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId])).toEqual([[5, 3], [9, 3]]);
    expect(found.passing).toEqual([3, 11]);
  });
});

describe("recheckSameLineReads", () => {
  type Db = Parameters<typeof recheckSameLineReads>[0] & ReturnType<typeof vi.fn>;
  function createDb(read: () => Promise<unknown>): Db {
    return Object.assign(vi.fn(() => Promise.resolve([])), { unsafe: vi.fn(read) }) as unknown as Db;
  }
  const writes = (db: Db) => db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join(" "));

  it("with its switch off, it reports the matches and takes nothing down (on since James's yes, 2026-10-26)", async () => {
    expect(SAME_LINE_READ_TAKEDOWN_LIVE).toBe(true);
    const db = createDb(() => Promise.resolve(rows(PROD)));
    const result = await recheckSameLineReads(db, { runId: 9, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, checked: 36, matched: 10, flagged: 0, takenDown: [] });
    expect(writes(db).some((text) => /UPDATE|pipeline_feedback/.test(text))).toBe(false);
    expect(writes(db).filter((text) => text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(sameLineReadDetail(result)).toMatchObject({ check: "darwin.same_line_read", version: 1, switch_live: false, matched: 10 });
  });

  it("writes nothing on a dry run, even with the switch on", async () => {
    const db = createDb(() => Promise.resolve(rows(PROD)));
    const result = await recheckSameLineReads(db, { runId: 9, dryRun: true, live: true });
    expect(result.matched).toBe(10);
    expect(db.mock.calls).toHaveLength(0);
  });

  it("reports nothing checked when the read fails", async () => {
    const db = createDb(() => Promise.reject(new Error("boom")));
    expect(await recheckSameLineReads(db, { runId: 9, dryRun: false })).toMatchObject({ checked: 0, matched: 0 });
  });
});
