import { describe, expect, it } from "vitest";

import { perEventPeriodCheck } from "./fee-frequency";

// Live NSF and overdraft fees stored with a period on Oct 13 (#1196): id, key, name, amount, stated, line.
const LIVE: Array<[number, string, string, number, string, string]> = [
  [19381, "overdraft", "Courtesy pay fee", 10, "monthly", "Courtesy pay fee / $10 monthly for optional coverage"],
  [19556, "nsf", "NSF Can make up to 6 w/ds only 3 by check", 30, "monthly", "Checks Written on Money Market Account (If balance falls below $1000 there is a $5 monthly service charge) | $30 NSF Can make up to 6 w/ds only 3 by check | $30 NSF Can make up to "],
  [21571, "overdraft", "Overdraft Fee 1", 27, "annual", "Overdraft Fee 1 | $27.00 | 10x15 (per year) | $200.00"],
  [21594, "nsf", "Returned Item Special Handling Item", 10, "annual", "3x10 (per year) | $50.00 | Returned Item Special Handling Item | $10.00"],
  [23072, "nsf", "Returned ACH", 5, "monthly", "Undeliverable Mail | $5.00 per month | Returned ACH | $5.00 each"],
  [24188, "nsf", "00 per month Nonsufficient funds", 35, "monthly", "Dormant accounts | $15 00 per month Nonsufficient funds | $35 00"],
  [27383, "overdraft", "OVERDRAFT PAID, PER ITEM", 30, "monthly", "OVERDRAFT PAID, PER ITEM* $30.00 MONTHLY"],
  [40094, "nsf", "Returned Items Special Handling Service Fee (Business)", 30, "monthly", "Returned Items Special Handling Service Fee1 (Business) | $30.00 | Per Month"],
  [40310, "nsf", "Insufficient Funds for Annual Fee", 35, "annual", "Insufficient Funds for Annual Fee $35"],
  [48631, "nsf", "Non-Sufficient Funds (NSF)", 25, "monthly", "Non-Sufficient Funds (NSF)............................................................................................$25.00 | Inactive Membership (Monthly Fee)...................."],
  [49874, "nsf", "NSF/Returned Item", 30, "monthly", "NSF/Returned Item | $30.00 | Excessive Withdrawal | (6) per month"],
  [52302, "nsf", "Returned Items (from 6-10 per year)", 34, "annual", "Returned Items (from 6-10 per year) – $34.00"],
  [57024, "overdraft", "Overdraft Privilege Fee", 30, "monthly", "Inactive/Dormant Account Fee (per month) | $5 | Overdraft Privilege Fee (created by check, in-person withdrawal, | $30"],
  [57951, "nsf", "MONTHLY SERVICE FEES Returned Share Draft/ACH Debit - NSF", 30, "monthly", "MONTHLY SERVICE FEES Returned Share Draft/ACH Debit - NSF $30 2nd Trust Deed $75"],
  [58623, "nsf", "NSF Drafts", 34, "monthly", "Service for production and delivering a Monthly Paper Statement Fee | NSF Drafts .................................................................................... $34.00 per ite"],
  [61724, "nsf", "Insufficient Funds (NSF)", 25, "monthly", "Insufficient Funds (NSF)* ................................................ $25.00 | Monthly Service Charge ...................................................... None"],
  [61883, "nsf", "NSF", 23, "monthly", "NSF | $23.00/Month"],
  [64720, "overdraft", "Two overdraft fees automatically reversed", 25, "monthly", "Two overdraft fees automatically reversed3 / $25 Monthly Maintenance Fee"],
  [64721, "overdraft", "Manage money confidently with TD Overdraft Relief", 15, "monthly", "Manage money confidently with TD Overdraft Relief / $15 Monthly Maintenance Fee"],
  [65874, "overdraft", "Two overdraft fees automatically reversed", 25, "monthly", "Two overdraft fees automatically reversed3 / $25 Monthly Maintenance Fee"],
  [65875, "overdraft", "Manage money confidently with TD Overdraft Relief", 15, "monthly", "Manage money confidently with TD Overdraft Relief / $15 Monthly Maintenance Fee"],
  [67915, "nsf", "NSF, RTN, ATM", 20, "monthly", "Monthly Service Fee Checking $7.50 / month Overdraft fees -NSF, RTN, ATM - $20"],
  [70692, "nsf", "Return Item (Per Item)", 35, "monthly", "Return Item (Per Item) | $35.00 | (Per Month, Per Account)"],
  [76864, "overdraft", "Overdraft Item/s Fee Per Item", 30, "annual", "Overdraft Item/s Fee Per Item | $30.00 | Annual Rent – 4 x 10 | $85.00"],
  [78982, "nsf", "per month Insufficient Funds (NFS) Ea. Item . . . . .", 30, "monthly", "Return Deposited Items (3rd Party) . . $30 Check Photocopy Fee (Ea.) . . . . . . . . . . . $2 Reprint Statement (Ea.) . . . .$2 per month Insufficient Funds (NFS) Ea. Item . . . . "],
  [79931, "overdraft", "If you overdraft seven or more times within a month, you are charged", 25, "monthly", "If you overdraft seven or more times within a month, you are charged $25.00 for every transfer that has to be made to cover overdrafts."],
  [85938, "nsf", "Return Item Special Handling", 30, "monthly", "Return Item Special Handling: $30.00/month"],
  [86029, "nsf", "Return Item NSF", 24, "annual", "Return Item NSF $24 This fee incurs when a check or electronic payment | Size | Annual Fee"],
  [89240, "nsf", "Nonsufficient Funds (of annual renewal fee)", 24, "annual", "Nonsufficient Funds (of annual renewal fee) | $24.00"],
  [92248, "overdraft", "Enhanced Overdraft Privilege Fee (per month)", 5, "monthly", "Enhanced Overdraft Privilege Fee (per month) | $5.00"],
  [92746, "overdraft", "Overdraft Boost", 30, "monthly", "(Fee will be charged if qualifications of Direct Deposit of at least $500, | Overdraft Boost .........................................$30.00 per month"],
  [93096, "nsf", "Due to Non-Sufficient Funds (NSF)", 27.5, "annual", "● Due to Non-Sufficient Funds (NSF) $27.50 ● Less than Minimum Balance Fee $10.00/year"],
  [96151, "nsf", "Returned Item", 14, "annual", "SAFE DEPOSIT BOX (ANNUAL) | CURRENCY / COIN | Returned Item: $14"],
  [110157, "overdraft", "Courtesy Pay/Premium OD2", 10, "monthly", "| Courtesy Pay/Premium OD2 | $10 | Per item over $10, up to 4 per day | Reimburse 1 per month | Reimburse 2 per month | $0 |"],
  [112803, "overdraft", "About Bounce Protection", 9, "monthly", "About Bounce Protection / $9 Monthly Fee"],
  [124252, "nsf", "Returned Check Fee", 7, "monthly", "Monthly Service Charge if below MDB | $2.00 | Returned Check Fee: | $7.00 | Drill due to lost keys | $350.00"],
  [128968, "nsf", "Non-Sufficient Funds", 5, "monthly", "$5.00/Month | Non-Sufficient Funds"],
  [130684, "overdraft", "Overdraft Trans. (After 3rd trans. per mo.)", 5, "monthly", "Overdraft Trans. (After 3rd trans. per mo.) | $5.00"],
  [133339, "overdraft", "Courtesy Pay charge due to NSF/Uncollected funds", 25, "annual", "Courtesy Pay charge due to NSF/Uncollected funds | $25.00 (1 waived per year.)"],
  [133378, "nsf", "Bill Pay NSF Fee", 25, "annual", "Bill Pay NSF Fee | $25.00 (1 waived per year.)"],
  [135108, "nsf", "ACH Automatic Transaction Insufficient Funds Return", 32, "monthly", "*Abandoned/**Dormant Account (Per Month) | $5.00 | ACH Automatic Transaction Insufficient Funds Return | $32.00"],
  [135426, "nsf", "Returned Check", 25, "monthly", "ATM Transactions Exceeds 15 per month | $1.00 | Duplicate Mortgage Satisfaction | $5.00 | Merchant Return | $20.00 | Returned Check | $25.00/ Presentment | Travel Card Purchase | $"],
  [136503, "overdraft", "With Advanced Overdraft, pay", 10, "monthly", "With Advanced Overdraft, pay a $10 monthly fee per account to cover up to two overdraft fees. Enroll to receive refunds for up to two overdraft or return item fees per month, total"],
  [138839, "overdraft", "Courtesy Pay fee (if applicable)", 34, "annual", "annual percentage yield of .25%. | Courtesy Pay fee (if applicable) $34.00"],
  [139466, "nsf", "Internet Bill Pay Insufficient Funds", 30, "monthly", "Monthly/Quarterly Paper Statement* | Internet Bill Pay Insufficient Funds | $30"],
  [139964, "nsf", "Collection Items (Replacing NSF Checks)", 5, "annual", "current offering rate for the same original term is currently | Collection Items (Replacing NSF Checks) ................. $5.00 | Annual Percentage Yield for our other accounts is "],
  [140170, "overdraft", "One overdraft fee", 25, "monthly", "One overdraft fee of $25 will be waived per statement cycle."],
  [140198, "nsf", "Free monthly paper statements; returned checks available for additional", 5, "monthly", "Free monthly paper statements; returned checks available for additional $5.00 monthly"],
  [140928, "overdraft", "Non-Sufficient Funds – Overdraft (Per Paid Item)", 25, "annual", "Non-Sufficient Funds – Overdraft (Per Paid Item) | $25.00 | $25.00 | First 3 Wavied Annually | First 3 Wavied Annually | $25.00 | $25.00"],
  [140929, "nsf", "Non-Sufficient Funds – Return (Per Returned Item)", 15, "annual", "Non-Sufficient Funds – Return (Per Returned Item) | $15.00 | $15.00 | First 3 Wavied Annually | First 3 Wavied Annually | $15.00 | $15.00"],
];

// Read by hand against each line: overdraft programs the bank sells by the month keep it; a period
// the fee's own price states is held; a neighbour's or an allowance's period is cleared.
const KEEP = new Set([19381, 92248, 92746, 112803, 136503]);
const HOLD = new Set([27383, 40094, 61883, 64720, 64721, 65874, 65875, 85938, 128968, 140198]);

describe("perEventPeriodCheck on the live rows of Oct 13 (#1196)", () => {
  it.each(LIVE)("%i %s", (id, key, name, amount, stated, line) => {
    const check = perEventPeriodCheck(key, stated, line, amount, name);
    if (KEEP.has(id)) expect(check).toEqual({ action: "keep", frequency: stated });
    else if (HOLD.has(id)) expect(check?.action).toBe("hold");
    else if (stated === "annual" && key === "overdraft") expect(check).toBeNull();
    else expect(check).toEqual({ action: "correct", frequency: null });
  });

  it("checks the 35 stored as monthly (5 kept, 10 held, 20 cleared) and, from v12, the 10 NSF stored as annual (cleared); the 5 overdraft annual wait", () => {
    const checks = LIVE.map(([, key, name, amount, stated, line]) => perEventPeriodCheck(key, stated, line, amount, name)?.action ?? "none");
    expect(LIVE.filter((fee) => fee[4] === "monthly")).toHaveLength(35);
    expect(checks.filter((action) => action === "keep")).toHaveLength(5);
    expect(checks.filter((action) => action === "hold")).toHaveLength(10);
    expect(checks.filter((action) => action === "correct")).toHaveLength(30);
    expect(checks.filter((action) => action === "none")).toHaveLength(5);
  });
});

// v12 (#1301): live NSF fees stored as daily on Oct 14, by their own lines. A daily cap prices each
// item, so the period goes; a daily price with no cap is held for a person.
describe("perEventPeriodCheck on NSF fees stored as daily (#1301)", () => {
  it.each([
    ["NSF Returned Item Fee $30.00 (max $180.00 daily)", 30, "correct"], // 36057
    ["InsufficientFunds (NSF) *Max4 per day | $32.00 Per ttem/Per", 32, "correct"], // 50906
    ["9. NSF Fees: You will be assessed an NSF fee of $25 for items presented over $10, not to exceed 5 fees charged per day.", 25, "correct"], // 113638
    ["Returned checks, each: $30.00 (No maximum per day)", 30, "correct"], // 135141
    ["NSF/UCF Fee $30 Per Day", 30, "hold"], // 55006
    ["Daily NSF Fee ...................................................................................................................... $5.00", 5, "hold"], // 93271
    ["Returned Check/Item | $30.00 per day, per account", 30, "hold"], // 117212
    ["(Per Day) | $10", 10, "hold"], // 67011
  ])("%s", (line, amount, action) => {
    expect(perEventPeriodCheck("nsf", "daily", line, amount, "NSF")?.action).toBe(action);
  });
});

describe("perEventPeriodCheck", () => {
  it("leaves other categories and frequencies alone", () => {
    expect(perEventPeriodCheck("monthly_maintenance", "monthly", "Maintenance | $5.00 per month", 5, "Maintenance")).toBeNull();
    expect(perEventPeriodCheck("nsf", "per_item", "NSF | $30.00 each", 30, "NSF")).toBeNull();
    expect(perEventPeriodCheck("nsf", null, "NSF | $30.00", 30, "NSF")).toBeNull();
    expect(perEventPeriodCheck("overdraft", "annual", "Overdraft Fee | $25.00 (1 waived per year.)", 25, "Overdraft Fee")).toBeNull();
  });

  it("gives a cleared period the line's per-item reading", () => {
    expect(perEventPeriodCheck("nsf", "monthly", "Dormant | $5.00 per month | NSF Item | $30.00 per item", 30, "NSF Item"))
      .toEqual({ action: "correct", frequency: "per_item" });
  });

  it("reads a waiver as no period", () => {
    expect(perEventPeriodCheck("overdraft", "monthly", "One overdraft fee of $25 will be waived per statement cycle.", 25, "One overdraft fee"))
      .toEqual({ action: "correct", frequency: null });
  });
});
