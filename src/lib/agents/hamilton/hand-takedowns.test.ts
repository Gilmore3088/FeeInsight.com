import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

import {
  applyHandAudienceFixes, applyHandTakedowns, HAND_AUDIENCE_FIXES, HAND_TAKEDOWN_BATCH_LIMIT, HAND_TAKEDOWNS, handAudienceEvidence,
  handTakedownBatchSizes, planHandAudienceFixes, planHandTakedowns, type LiveAudienceRow, type LiveTakedownRow,
} from "./hand-takedowns";

// #1659: U.S. Bank's Bank Smartly row, live at $10 now; the hand amount correction makes it $12.
const US_BANK_SMARTLY_LIVE: LiveTakedownRow = {
  fee_published_id: 102971, lineage_ref: 117576, institution_id: 5, canonical_fee_key: "monthly_maintenance",
  fee_name: "Maintenance Fee waived on every U.S. Bank Smartly® Checking account", amount: "10.00",
};
const US_BANK_SMARTLY_CORRECTED: LiveTakedownRow = { ...US_BANK_SMARTLY_LIVE, fee_name: "Bank Smartly Checking Monthly Maintenance Fee", amount: "12.00" };
// #1664: FNB Alaska's Direct Deposit Checking $7 from its checking page (doc 33839), live on prod, read-only, Oct 16.
const FNB_ALASKA_DD_LIVE: LiveTakedownRow = {
  fee_published_id: 125197, lineage_ref: 145367, institution_id: 281, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Fees", amount: "7.00",
};

// #1661: Beacon Community FCU's current garnishment fee (doc 35662), live on prod, read-only, Oct 16.
const BEACON_GARNISHMENT_LIVE: LiveTakedownRow = {
  fee_published_id: 112876, lineage_ref: 179813, institution_id: 7204, canonical_fee_key: "garnishment_levy", fee_name: "Judicial Attachment (Garnishment)", amount: "36.00",
};

// #1668: Beacon's rows from its 2022 PDF (30627), 2025 PDF (30629) and an Oct 10 page copy (25830), live on prod, read-only, Oct 16.
const BEACON_STALE_1668: LiveTakedownRow[] = [
  { fee_published_id: 138828, lineage_ref: 162442, institution_id: 7204, canonical_fee_key: "deposited_item_return", fee_name: "Return Deposit Item (1 party)", amount: "34.00" },
  { fee_published_id: 138832, lineage_ref: 162448, institution_id: 7204, canonical_fee_key: "nsf", fee_name: "NSF DRAFT, NSF ACH item, or NSF Bill Pay", amount: "34.00" },
  { fee_published_id: 138833, lineage_ref: 162450, institution_id: 7204, canonical_fee_key: "nsf", fee_name: "NSF/Overdrawn ATM Withdrawal", amount: "34.00" },
  { fee_published_id: 138839, lineage_ref: 162459, institution_id: 7204, canonical_fee_key: "overdraft", fee_name: "Courtesy Pay fee (if applicable)", amount: "34.00" },
  { fee_published_id: 138827, lineage_ref: 162441, institution_id: 7204, canonical_fee_key: "deposited_item_return", fee_name: "Return Deposit Item", amount: "34.00" },
  { fee_published_id: 138834, lineage_ref: 162451, institution_id: 7204, canonical_fee_key: "card_replacement", fee_name: "Fees: Replacement Card", amount: "10.00" },
  { fee_published_id: 138841, lineage_ref: 162462, institution_id: 7204, canonical_fee_key: "counter_check", fee_name: "Starter/Temporary Checks", amount: "3.00" },
  { fee_published_id: 148352, lineage_ref: 132704, institution_id: 7204, canonical_fee_key: "counter_check", fee_name: "Starter/Temporary Checks", amount: "3.00" },
  { fee_published_id: 138831, lineage_ref: 162445, institution_id: 7204, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire Transfer Out fee", amount: "20.00" },
  { fee_published_id: 138830, lineage_ref: 162444, institution_id: 7204, canonical_fee_key: "document_reproduction", fee_name: "Minimum Balance Requirements: 3 months’ dividends on the deposit; on certificates of greater than: Document Copy", amount: "4.00" },
  { fee_published_id: 138848, lineage_ref: 162472, institution_id: 7204, canonical_fee_key: "atm_non_network", fee_name: "ATM SERVICE FEESInitial CardNSF/Overdrawn ATM Withdrawal", amount: "3.00" },
  { fee_published_id: 138849, lineage_ref: 162473, institution_id: 7204, canonical_fee_key: "cashiers_check", fee_name: "Paper statement feeSAVINGS SERVICESCertified Checks/Official Checks-MembersCertified Checks/Official Checks-Non-MembersV", amount: "3.00" },
  { fee_published_id: 138850, lineage_ref: 162474, institution_id: 7204, canonical_fee_key: "deposited_item_return", fee_name: "Return Deposit Item (2 party)Return Deposit Item (1 party)", amount: "3.00" },
  { fee_published_id: 138851, lineage_ref: 162478, institution_id: 7204, canonical_fee_key: "deposited_item_return", fee_name: "Return Deposit Item from Shared Branch", amount: "3.00" },
];
// The current fee schedule page's rows (doc 35662) each one waits on, live on prod, read-only, Oct 16.
const BEACON_CURRENT_1668: LiveTakedownRow[] = [
  { fee_published_id: 112893, lineage_ref: 179812, institution_id: 7204, canonical_fee_key: "deposited_item_return", fee_name: "Return Deposit Item (1 party)", amount: "36.00" },
  { fee_published_id: 112881, lineage_ref: 179820, institution_id: 7204, canonical_fee_key: "nsf", fee_name: "NSF Draft, NSF ACH item or NSF Bill Pay item", amount: "36.00" },
  { fee_published_id: 112915, lineage_ref: 179827, institution_id: 7204, canonical_fee_key: "nsf", fee_name: "NSF/Overdrawn ATM Withdrawal", amount: "36.00" },
  { fee_published_id: 112887, lineage_ref: 179821, institution_id: 7204, canonical_fee_key: "overdraft", fee_name: "Courtesy Pay Fee (if applicable)", amount: "36.00" },
  { fee_published_id: 112892, lineage_ref: 179811, institution_id: 7204, canonical_fee_key: "deposited_item_return", fee_name: "Return Deposit Item (2 party)", amount: "15.00" },
  { fee_published_id: 112883, lineage_ref: 179828, institution_id: 7204, canonical_fee_key: "card_replacement", fee_name: "Replacement Card", amount: "10.00" },
  { fee_published_id: 112895, lineage_ref: 179824, institution_id: 7204, canonical_fee_key: "counter_check", fee_name: "Starter/Temporary Checks", amount: "3.00" },
  { fee_published_id: 112877, lineage_ref: 179816, institution_id: 7204, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire transfer (domestic) Outgoing", amount: "20.00" },
  { fee_published_id: 112894, lineage_ref: 179815, institution_id: 7204, canonical_fee_key: "document_reproduction", fee_name: "Document Copy", amount: "4.00" },
];

// The two #1496 rows as they read live on prod, read-only, Oct 16.
const LIVE: LiveTakedownRow[] = [
  { fee_published_id: 80423, lineage_ref: 90425, institution_id: 5433, canonical_fee_key: "document_reproduction", fee_name: "Fax (Local)", amount: "15.00" },
  { fee_published_id: 102440, lineage_ref: 116687, institution_id: 5433, canonical_fee_key: "document_reproduction", fee_name: "Fax (Long Distance) Minimum Balance", amount: "2.00" },
  // #1549 and #1512 rows as they read live, read-only, Oct 16 (lineage refs are test values).
  { fee_published_id: 83118, lineage_ref: 1, institution_id: 33, canonical_fee_key: "overdraft", fee_name: "we may use Overdraft Protection Coverage to pay the remaining", amount: "20.00" },
  { fee_published_id: 45619, lineage_ref: 2, institution_id: 7229, canonical_fee_key: "check_printing", fee_name: "Check printing…………………………………………………......…...…(varies by style) | Domestic", amount: "20.00" },
  // #1370's two held subordination rows as they read live on prod, read-only, Oct 16.
  { fee_published_id: 116720, lineage_ref: 138129, institution_id: 8459, canonical_fee_key: "other_lending_fee", fee_name: "SUBORDINATION REQUEST & PARTIAL: WIRE TRANSFER", amount: "20.00" },
  { fee_published_id: 134129, lineage_ref: 154983, institution_id: 4815, canonical_fee_key: "other_lending_fee", fee_name: "Subordination Fee: Business", amount: "10.00" },
  // The #1534 review's three loan-payment rows, as they read live, read-only, Oct 16.
  { fee_published_id: 48113, lineage_ref: 53370, institution_id: 7483, canonical_fee_key: "safe_deposit_box", fee_name: "Returned loan payment", amount: "25.00" },
  { fee_published_id: 87307, lineage_ref: 96812, institution_id: 5054, canonical_fee_key: "ach_return", fee_name: "Returned Loan Payment (check or ACH returned unpaid; per item)", amount: "25.00" },
  { fee_published_id: 134962, lineage_ref: 156021, institution_id: 8566, canonical_fee_key: "account_research", fee_name: "Loan Payment with Debit Card - Chargeback", amount: "29.50" },
  // The #1571 /bin/bash rows as listed (read-only, Oct 16; lineage refs are test values).
  ...HAND_TAKEDOWNS.filter((entry) => entry.issue === 1571).map((entry, index) => ({
    fee_published_id: entry.feePublishedId, lineage_ref: 100 + index, institution_id: entry.institutionId,
    canonical_fee_key: entry.canonicalFeeKey, fee_name: entry.feeName, amount: "0.00",
  })),
  // #1512's joined courtesy pay row as it reads live on prod, read-only, Oct 16.
  { fee_published_id: 142965, lineage_ref: 172523, institution_id: 4965, canonical_fee_key: "overdraft", fee_name: "Courtesy Pay Fee (per transaction) Research & Reconcilement (per hour)", amount: "10.00" },
  // #1302's leftovers as they read live on prod, read-only, Oct 16.
  { fee_published_id: 13188, lineage_ref: 5161, institution_id: 44, canonical_fee_key: "gift_card_purchase", fee_name: "Visa Gift Card", amount: "4.25" },
  { fee_published_id: 144352, lineage_ref: 174382, institution_id: 6152, canonical_fee_key: "late_payment", fee_name: "Late payment fees", amount: "35.00" },
  { fee_published_id: 114273, lineage_ref: 101242, institution_id: 6152, canonical_fee_key: "late_payment", fee_name: "Late payment fees", amount: "35.00" },
  { fee_published_id: 114270, lineage_ref: 174295, institution_id: 6152, canonical_fee_key: "late_payment", fee_name: "Late payment fee", amount: "35.00" },
  // #1655's two overdraft guide rows as they read live on prod, read-only, Oct 16.
  { fee_published_id: 5827, lineage_ref: 1717, institution_id: 1968, canonical_fee_key: "od_daily_cap", fee_name: "Continuous Overdraft Charge Daily Cap", amount: "3.29" },
  { fee_published_id: 84637, lineage_ref: 93864, institution_id: 97, canonical_fee_key: "overdraft", fee_name: "Overdraft or Returned Item fee (business accounts)", amount: "10.00" },
  // #1659's four rows as they read live on prod, read-only, Oct 16.
  { fee_published_id: 104565, lineage_ref: 173293, institution_id: 5, canonical_fee_key: "nsf", fee_name: "Returned check", amount: "30.00" },
  { fee_published_id: 104566, lineage_ref: 173294, institution_id: 5, canonical_fee_key: "stop_payment", fee_name: "Stop payment", amount: "25.00" },
  { fee_published_id: 102973, lineage_ref: 117579, institution_id: 5, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly maintenance fee", amount: "12.00" },
  { fee_published_id: 15727, lineage_ref: 9064, institution_id: 4956, canonical_fee_key: "atm_non_network", fee_name: "plus ATM owner fees", amount: "1.00" },
  // 102971 as it reads once its hand amount correction has run (102973 waits on it).
  US_BANK_SMARTLY_CORRECTED,
  // #1664's waiver-line $0 as it reads live on prod, read-only, Oct 16, and the $7 copy it waits on.
  { fee_published_id: 67859, lineage_ref: 79647, institution_id: 281, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Fee with 1 direct deposit per", amount: "0.00" },
  FNB_ALASKA_DD_LIVE,
  // #1661's stale $34 garnishment row and the current $36 row it waits on, live on prod, read-only, Oct 16.
  { fee_published_id: 138829, lineage_ref: 162443, institution_id: 7204, canonical_fee_key: "garnishment_levy", fee_name: "Judicial Attachment (Garnishment)", amount: "34.00" },
  BEACON_GARNISHMENT_LIVE,
  // #1196's two rows with no home among the 50, live on prod, read-only, Oct 16.
  { fee_published_id: 131129, lineage_ref: 150786, institution_id: 5100, canonical_fee_key: "atm_non_network", fee_name: "ATM Transactions at DFCU ATM (Local ATM)", amount: "2.00" },
  { fee_published_id: 70319, lineage_ref: 84116, institution_id: 986, canonical_fee_key: "dormant_account", fee_name: "VISA Gift Card Inactivity Fee", amount: "2.95" },
  // #1666's run-together North Central row, live on prod, read-only, Oct 16.
  { fee_published_id: 140689, lineage_ref: 166209, institution_id: 7363, canonical_fee_key: "od_protection_transfer",
    fee_name: "See How to avoid them next to the listed fee.Checking AccountsAutomatic Overdraft TransferCopy of DraftCourtesy PayForei", amount: "10.00" },
  ...BEACON_STALE_1668,
  ...BEACON_CURRENT_1668,
  // #1671's business-schedule monthly fees the account type hold brought back, live on prod, read-only, Oct 16.
  { fee_published_id: 42961, lineage_ref: 35153, institution_id: 436, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly fee", amount: "7.00" },
  { fee_published_id: 86536, lineage_ref: 96124, institution_id: 891, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly maintenance fee", amount: "5.00" },
  { fee_published_id: 66721, lineage_ref: 75768, institution_id: 1689, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly service charge", amount: "5.00" },
  { fee_published_id: 66722, lineage_ref: 75769, institution_id: 1689, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly service charge", amount: "10.00" },
  // The #1549 follow-ups (Flagstar's older-form overdraft, two Pinnacle transfer lines), as they read live, read-only, Oct 16.
  { fee_published_id: 83125, lineage_ref: 92572, institution_id: 33, canonical_fee_key: "overdraft", fee_name: "Overdraft Charge (each)", amount: "10.00" },
  { fee_published_id: 97335, lineage_ref: 110368, institution_id: 184, canonical_fee_key: "od_protection_transfer", fee_name: "OVERDRAFT TRANSFER", amount: "10.00" },
  { fee_published_id: 97904, lineage_ref: 111117, institution_id: 850, canonical_fee_key: "od_protection_transfer", fee_name: "overdrawn. Features of Overdraft Transfer include", amount: "32.00" },
  // #1436's waiver-sentence $0 and the $7.95 ePLUS fee it waits on, and #1389's balance requirement, live on prod, read-only, Oct 17.
  { fee_published_id: 58414, lineage_ref: 55074, institution_id: 5314, canonical_fee_key: "monthly_maintenance", fee_name: "or take advantage of both options to reduce your monthly fee to", amount: "0.00" },
  { fee_published_id: 95264, lineage_ref: 107365, institution_id: 5314, canonical_fee_key: "monthly_maintenance", fee_name: "ePLUS Checking Monthly service charge", amount: "7.95" },
  { fee_published_id: 106021, lineage_ref: 121345, institution_id: 4589, canonical_fee_key: "minimum_balance", fee_name: "Minimum Balance", amount: "25.00" },
  // #1735's nine rows, as they read live on prod, read-only, Oct 17.
  { fee_published_id: 33705, lineage_ref: 44428, institution_id: 349, canonical_fee_key: "overdraft", fee_name: "BankOn Checking Account Overdraft Fee for items", amount: "0.00" },
  { fee_published_id: 149143, lineage_ref: 180933, institution_id: 6720, canonical_fee_key: "other_lending_fee", fee_name: "Loan Payments by Phone", amount: "5.00" },
  { fee_published_id: 149806, lineage_ref: 182084, institution_id: 4628, canonical_fee_key: "money_order", fee_name: "Par Value: Par value of one share", amount: "5.00" },
  { fee_published_id: 137241, lineage_ref: 159635, institution_id: 7438, canonical_fee_key: "atm_non_network", fee_name: "Ten (10) free nationwide ATM withdrawals per year", amount: "5.00" },
  { fee_published_id: 68335, lineage_ref: 50030, institution_id: 199, canonical_fee_key: "cash_advance", fee_name: "3% (of the amount of each cash advance, minimum fee", amount: "10.00" },
  { fee_published_id: 79402, lineage_ref: 89542, institution_id: 1842, canonical_fee_key: "account_research", fee_name: "MMDA Excess Transaction Fee (per item charge)", amount: "5.00" },
  { fee_published_id: 74149, lineage_ref: 86595, institution_id: 576, canonical_fee_key: "safe_deposit_box", fee_name: "Safe Deposit Box Drilling Fee: Cost of Drilling +", amount: "25.00" },
  { fee_published_id: 49817, lineage_ref: 50458, institution_id: 6110, canonical_fee_key: "cashiers_check", fee_name: "UT bank check (after 90 days)", amount: "5.00" },
  { fee_published_id: 125584, lineage_ref: 177190, institution_id: 5008, canonical_fee_key: "atm_non_network", fee_name: "ATM Surcharge Fee on WWFCU machines (non-credit union cards only)", amount: "3.50" },
];
const CONDITIONAL_ZERO = [43512, 54014, 61335, 68893, 70121, 73737, 77121, 77122, 77618, 84553, 87079, 87461, 88213, 91505, 120559];
const IDS = [80423, 102440, 83118, 45619, 116720, 134129, 48113, 87307, 134962, ...CONDITIONAL_ZERO, 142965, 13188, 144352, 114273, 114270, 5827, 84637, 104565, 104566, 102973, 15727, 67859, 138829, 131129, 70319, 140689, 138828, 138832, 138833, 138839, 138827, 138834, 138841, 148352, 138831, 138830, 138848, 138849, 138850, 138851, 42961, 86536, 66721, 66722, 83125, 97335, 97904, 58414, 106021, 33705, 149143, 149806, 137241, 68335, 79402, 74149, 49817, 125584];

function fakeDb(live: LiveTakedownRow[], failOn?: string) {
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
    if (text.includes("SELECT fp.fee_published_id")) return live;
    writes.push({ text, values });
    if (text.includes("UPDATE published_fee_records")) return [{ fee_published_id: values.find((value) => typeof value === "number") }];
    return [];
  });
  return { db, writes };
}

describe("hand takedowns (James, Oct 16)", () => {
  it("lists each confirmed-wrong fee with its reason and evidence", () => {
    expect(HAND_TAKEDOWNS.map((entry) => [entry.feePublishedId, entry.reason])).toEqual([
      [80423, "source_mismatch: #1496"],
      [102440, "source_mismatch: #1496"],
      [83118, "source_mismatch: #1549"],
      [45619, "source_mismatch: #1512"],
      [116720, "source_mismatch: #1370"],
      [134129, "source_mismatch: #1370"],
      [48113, "source_mismatch: #1534"],
      [87307, "source_mismatch: #1534"],
      [134962, "source_mismatch: #1534"],
      ...CONDITIONAL_ZERO.map((id) => [id, "source_mismatch: #1571"]),
      [142965, "source_mismatch: #1512"],
      [13188, "duplicate of #103400 (#1302)"],
      [144352, "source_mismatch: #1302"],
      [114273, "source_mismatch: #1302"],
      [114270, "source_mismatch: #1302"],
      [5827, "duplicate of #43265 (#1655)"],
      [84637, "source_mismatch: #1655"],
      [104565, "source_mismatch: #1659"],
      [104566, "source_mismatch: #1659"],
      [102973, "duplicate of #102971 (#1659)"],
      [15727, "source_mismatch: #1659"],
      [67859, "duplicate of #125197 (#1664)"],
      [138829, "duplicate of #112876 (#1661)"],
      [131129, "source_mismatch: #1196"],
      [70319, "source_mismatch: #1196"],
      [140689, "source_mismatch: #1666"],
      [138828, "duplicate of #112893 (#1668)"],
      [138832, "duplicate of #112881 (#1668)"],
      [138833, "duplicate of #112915 (#1668)"],
      [138839, "duplicate of #112887 (#1668)"],
      [138827, "source_mismatch: #1668"],
      [138834, "duplicate of #112883 (#1668)"],
      [138841, "duplicate of #112895 (#1668)"],
      [148352, "duplicate of #112895 (#1668)"],
      [138831, "duplicate of #112877 (#1668)"],
      [138830, "duplicate of #112894 (#1668)"],
      [138848, "source_mismatch: #1668"],
      [138849, "source_mismatch: #1668"],
      [138850, "source_mismatch: #1668"],
      [138851, "source_mismatch: #1668"],
      [42961, "source_mismatch: #1671"],
      [86536, "source_mismatch: #1671"],
      [66721, "source_mismatch: #1671"],
      [66722, "source_mismatch: #1671"],
      [83125, "source_mismatch: #1549"],
      [97335, "source_mismatch: #1549"],
      [97904, "source_mismatch: #1549"],
      [58414, "source_mismatch: #1436"],
      [106021, "source_mismatch: #1389"],
      [33705, "source_mismatch: #1735"],
      [149143, "source_mismatch: #1735"],
      [149806, "source_mismatch: #1735"],
      [137241, "source_mismatch: #1735"],
      [68335, "source_mismatch: #1735"],
      [79402, "source_mismatch: #1735"],
      [74149, "source_mismatch: #1735"],
      [49817, "source_mismatch: #1735"],
      [125584, "source_mismatch: #1735"],
    ]);
    // A wrong read names its issue; a second read of one printed fee names the live copy it repeats too.
    expect(HAND_TAKEDOWNS.every((entry) => entry.evidence.length > 0 && (entry.kind === "duplicate"
      ? /^duplicate of #\d+ \(#\d+\)$/.test(entry.reason) && entry.reason.endsWith(`(#${entry.issue})`)
      : entry.reason === `source_mismatch: #${entry.issue}`))).toBe(true);
    // James, Oct 16 03:37 UTC: fewer than 20 fees per batch (one issue) go this way; a bigger batch goes to him.
    expect(HAND_TAKEDOWN_BATCH_LIMIT).toBeLessThan(20);
    expect(handTakedownBatchSizes()[0]).toEqual({ issue: 1571, entries: 15 });
    expect(handTakedownBatchSizes().every((batch) => batch.entries <= HAND_TAKEDOWN_BATCH_LIMIT)).toBe(true);
  });

  it("takes a row down only while it still reads as listed", () => {
    expect(planHandTakedowns(LIVE)).toEqual({
      takenDown: [
        { feePublishedId: 80423, feeVerifiedId: 90425, reason: "source_mismatch: #1496" },
        { feePublishedId: 102440, feeVerifiedId: 116687, reason: "source_mismatch: #1496" },
        { feePublishedId: 83118, feeVerifiedId: 1, reason: "source_mismatch: #1549" },
        { feePublishedId: 45619, feeVerifiedId: 2, reason: "source_mismatch: #1512" },
        { feePublishedId: 116720, feeVerifiedId: 138129, reason: "source_mismatch: #1370" },
        { feePublishedId: 134129, feeVerifiedId: 154983, reason: "source_mismatch: #1370" },
        { feePublishedId: 48113, feeVerifiedId: 53370, reason: "source_mismatch: #1534" },
        { feePublishedId: 87307, feeVerifiedId: 96812, reason: "source_mismatch: #1534" },
        { feePublishedId: 134962, feeVerifiedId: 156021, reason: "source_mismatch: #1534" },
        ...CONDITIONAL_ZERO.map((id, index) => ({ feePublishedId: id, feeVerifiedId: 100 + index, reason: "source_mismatch: #1571" })),
        { feePublishedId: 142965, feeVerifiedId: 172523, reason: "source_mismatch: #1512" },
        { feePublishedId: 13188, feeVerifiedId: 5161, reason: "duplicate of #103400 (#1302)" },
        { feePublishedId: 144352, feeVerifiedId: 174382, reason: "source_mismatch: #1302" },
        { feePublishedId: 114273, feeVerifiedId: 101242, reason: "source_mismatch: #1302" },
        { feePublishedId: 114270, feeVerifiedId: 174295, reason: "source_mismatch: #1302" },
        { feePublishedId: 5827, feeVerifiedId: 1717, reason: "duplicate of #43265 (#1655)" },
        { feePublishedId: 84637, feeVerifiedId: 93864, reason: "source_mismatch: #1655" },
        { feePublishedId: 104565, feeVerifiedId: 173293, reason: "source_mismatch: #1659" },
        { feePublishedId: 104566, feeVerifiedId: 173294, reason: "source_mismatch: #1659" },
        { feePublishedId: 102973, feeVerifiedId: 117579, reason: "duplicate of #102971 (#1659)" },
        { feePublishedId: 15727, feeVerifiedId: 9064, reason: "source_mismatch: #1659" },
        { feePublishedId: 67859, feeVerifiedId: 79647, reason: "duplicate of #125197 (#1664)" },
        { feePublishedId: 138829, feeVerifiedId: 162443, reason: "duplicate of #112876 (#1661)" },
        { feePublishedId: 131129, feeVerifiedId: 150786, reason: "source_mismatch: #1196" },
        { feePublishedId: 70319, feeVerifiedId: 84116, reason: "source_mismatch: #1196" },
        { feePublishedId: 140689, feeVerifiedId: 166209, reason: "source_mismatch: #1666" },
        { feePublishedId: 138828, feeVerifiedId: 162442, reason: "duplicate of #112893 (#1668)" },
        { feePublishedId: 138832, feeVerifiedId: 162448, reason: "duplicate of #112881 (#1668)" },
        { feePublishedId: 138833, feeVerifiedId: 162450, reason: "duplicate of #112915 (#1668)" },
        { feePublishedId: 138839, feeVerifiedId: 162459, reason: "duplicate of #112887 (#1668)" },
        { feePublishedId: 138827, feeVerifiedId: 162441, reason: "source_mismatch: #1668" },
        { feePublishedId: 138834, feeVerifiedId: 162451, reason: "duplicate of #112883 (#1668)" },
        { feePublishedId: 138841, feeVerifiedId: 162462, reason: "duplicate of #112895 (#1668)" },
        { feePublishedId: 148352, feeVerifiedId: 132704, reason: "duplicate of #112895 (#1668)" },
        { feePublishedId: 138831, feeVerifiedId: 162445, reason: "duplicate of #112877 (#1668)" },
        { feePublishedId: 138830, feeVerifiedId: 162444, reason: "duplicate of #112894 (#1668)" },
        { feePublishedId: 138848, feeVerifiedId: 162472, reason: "source_mismatch: #1668" },
        { feePublishedId: 138849, feeVerifiedId: 162473, reason: "source_mismatch: #1668" },
        { feePublishedId: 138850, feeVerifiedId: 162474, reason: "source_mismatch: #1668" },
        { feePublishedId: 138851, feeVerifiedId: 162478, reason: "source_mismatch: #1668" },
        { feePublishedId: 42961, feeVerifiedId: 35153, reason: "source_mismatch: #1671" },
        { feePublishedId: 86536, feeVerifiedId: 96124, reason: "source_mismatch: #1671" },
        { feePublishedId: 66721, feeVerifiedId: 75768, reason: "source_mismatch: #1671" },
        { feePublishedId: 66722, feeVerifiedId: 75769, reason: "source_mismatch: #1671" },
        { feePublishedId: 83125, feeVerifiedId: 92572, reason: "source_mismatch: #1549" },
        { feePublishedId: 97335, feeVerifiedId: 110368, reason: "source_mismatch: #1549" },
        { feePublishedId: 97904, feeVerifiedId: 111117, reason: "source_mismatch: #1549" },
        { feePublishedId: 58414, feeVerifiedId: 55074, reason: "source_mismatch: #1436" },
        { feePublishedId: 106021, feeVerifiedId: 121345, reason: "source_mismatch: #1389" },
        { feePublishedId: 33705, feeVerifiedId: 44428, reason: "source_mismatch: #1735" },
        { feePublishedId: 149143, feeVerifiedId: 180933, reason: "source_mismatch: #1735" },
        { feePublishedId: 149806, feeVerifiedId: 182084, reason: "source_mismatch: #1735" },
        { feePublishedId: 137241, feeVerifiedId: 159635, reason: "source_mismatch: #1735" },
        { feePublishedId: 68335, feeVerifiedId: 50030, reason: "source_mismatch: #1735" },
        { feePublishedId: 79402, feeVerifiedId: 89542, reason: "source_mismatch: #1735" },
        { feePublishedId: 74149, feeVerifiedId: 86595, reason: "source_mismatch: #1735" },
        { feePublishedId: 49817, feeVerifiedId: 50458, reason: "source_mismatch: #1735" },
        { feePublishedId: 125584, feeVerifiedId: 177190, reason: "source_mismatch: #1735" },
      ],
      skipped: [],
    });
    const changed = [{ ...LIVE[0], amount: "5.00" }, { ...LIVE[1], fee_name: "Fax (Long Distance)" }];
    expect(planHandTakedowns(changed, HAND_TAKEDOWNS.slice(0, 2))).toEqual({
      takenDown: [],
      skipped: [
        { feePublishedId: 80423, reason: "changed since listed" },
        { feePublishedId: 102440, reason: "changed since listed" },
      ],
    });
    expect(planHandTakedowns([]).skipped.map((row) => row.reason)).toEqual(IDS.map(() => "not live"));
    // #1659: the student page's copy waits until 102971 reads as corrected ($12, the account's name).
    const studentCopy = HAND_TAKEDOWNS.filter((entry) => entry.feePublishedId === 102973);
    const student = LIVE.find((row) => row.fee_published_id === 102973)!;
    expect(planHandTakedowns([student, US_BANK_SMARTLY_LIVE], studentCopy)).toEqual({
      takenDown: [], skipped: [{ feePublishedId: 102973, reason: "waiting on #102971" }],
    });
    expect(planHandTakedowns([student], studentCopy).skipped).toEqual([{ feePublishedId: 102973, reason: "waiting on #102971" }]);
    expect(planHandTakedowns([student, US_BANK_SMARTLY_CORRECTED], studentCopy)).toEqual({
      takenDown: [{ feePublishedId: 102973, feeVerifiedId: 117579, reason: "duplicate of #102971 (#1659)" }], skipped: [],
    });
    // #1664: FNB Alaska's $0 comes down only while the $7 copy (125197) is live as listed.
    const fnbCopy = HAND_TAKEDOWNS.filter((entry) => entry.feePublishedId === 67859);
    const fnbZero = LIVE.find((row) => row.fee_published_id === 67859)!;
    expect(fnbCopy[0].requiresLive).toEqual({ feePublishedId: 125197, amount: 7, feeName: "Monthly Service Fees" });
    expect(planHandTakedowns([fnbZero], fnbCopy).skipped).toEqual([{ feePublishedId: 67859, reason: "waiting on #125197" }]);
    expect(planHandTakedowns([fnbZero, { ...FNB_ALASKA_DD_LIVE, amount: "5.00" }], fnbCopy).skipped).toEqual([{ feePublishedId: 67859, reason: "waiting on #125197" }]);
    expect(planHandTakedowns([fnbZero, FNB_ALASKA_DD_LIVE], fnbCopy)).toEqual({
      takenDown: [{ feePublishedId: 67859, feeVerifiedId: 79647, reason: "duplicate of #125197 (#1664)" }], skipped: [],
    });
    // #1661: the 2022 PDF's $34 comes down only while the fee schedule page's $36 (112876) is live as listed.
    const beaconCopy = HAND_TAKEDOWNS.filter((entry) => entry.feePublishedId === 138829);
    const beaconStale = LIVE.find((row) => row.fee_published_id === 138829)!;
    expect(beaconCopy[0].requiresLive).toEqual({ feePublishedId: 112876, amount: 36, feeName: "Judicial Attachment (Garnishment)" });
    expect(planHandTakedowns([beaconStale], beaconCopy).skipped).toEqual([{ feePublishedId: 138829, reason: "waiting on #112876" }]);
    expect(planHandTakedowns([beaconStale, { ...BEACON_GARNISHMENT_LIVE, amount: "34.00" }], beaconCopy).skipped).toEqual([{ feePublishedId: 138829, reason: "waiting on #112876" }]);
    expect(planHandTakedowns([beaconStale, BEACON_GARNISHMENT_LIVE], beaconCopy)).toEqual({
      takenDown: [{ feePublishedId: 138829, feeVerifiedId: 162443, reason: "duplicate of #112876 (#1661)" }], skipped: [],
    });
    // #1668: each Beacon copy waits on the current page's row it repeats; none comes down without it.
    const beacon1668 = HAND_TAKEDOWNS.filter((entry) => entry.issue === 1668);
    expect(beacon1668).toHaveLength(14);
    expect(beacon1668.filter((entry) => entry.requiresLive).map((entry) => entry.requiresLive!.feePublishedId)).toEqual(
      [112893, 112881, 112915, 112887, 112892, 112883, 112895, 112895, 112877, 112894]);
    const waiting = planHandTakedowns(BEACON_STALE_1668, beacon1668);
    expect(waiting.takenDown.map((item) => item.feePublishedId)).toEqual([138848, 138849, 138850, 138851]);
    expect(waiting.skipped).toEqual(beacon1668.filter((entry) => entry.requiresLive)
      .map((entry) => ({ feePublishedId: entry.feePublishedId, reason: `waiting on #${entry.requiresLive!.feePublishedId}` })));
    // A current row re-priced since (the NSF back at $34) holds its copy back.
    const repriced = BEACON_CURRENT_1668.map((row) => (row.fee_published_id === 112881 ? { ...row, amount: "34.00" } : row));
    expect(planHandTakedowns([...BEACON_STALE_1668, ...repriced], beacon1668).skipped).toEqual([{ feePublishedId: 138832, reason: "waiting on #112881" }]);
    expect(planHandTakedowns([...BEACON_STALE_1668, ...BEACON_CURRENT_1668], beacon1668)).toEqual({
      takenDown: BEACON_STALE_1668.map((row) => ({ feePublishedId: row.fee_published_id, feeVerifiedId: row.lineage_ref, reason: beacon1668.find((entry) => entry.feePublishedId === row.fee_published_id)!.reason })),
      skipped: [],
    });
    // Another institution or category at the same id, name and price is not the listed row.
    const moved = [{ ...LIVE[4], institution_id: 1 }, { ...LIVE[5], canonical_fee_key: "legal_process" }];
    expect(planHandTakedowns(moved, HAND_TAKEDOWNS.slice(4, 6)).skipped.map((row) => row.reason)).toEqual(["changed since listed", "changed since listed"]);
  });

  it("#1735: Gate City's BankOn $0 comes down and its $0 NSF stays; the $32 does not trace under its printed name", () => {
    const batch = HAND_TAKEDOWNS.filter((entry) => entry.issue === 1735);
    expect(batch).toHaveLength(9);
    expect(batch.map((entry) => entry.feePublishedId)).not.toContain(33701);
    // Text 503 (doc 13087, read-only, Oct 17), its overdraft and NSF lines.
    const gateCity = "Overdraft Fees\nOverdraft fee for items paid resulting in a negative\nbalance.\nMaximum of 4 fees per calendar day.\n$32 per item\n" +
      "If your account is charged more than four overdraft\nOverdraft /Non-Sufficient Funds (NSF) | fees per day, the additional fees will be refunded\n" +
      "within 48 hours. The date the fee is charged is used\nto calculate the number of fees charged per day.\nBankOn Checking Account Overdraft Fee for items\n$0 per item\n" +
      "paid resulting in a negative balance.\nReturned Item/Non-Sufficient Funds\n(NSF) Third parties or other banks may impose | Non-Sufficient Funds (NSF) Fee for items returned. $0 per item\n";
    // The $0 traces only to the BankOn account's own line; the NSF $0 is the bank's printed price.
    expect(checkFeeAgainstSource(gateCity, "BankOn Checking Account Overdraft Fee for items", 0, ".", "overdraft"))
      .toEqual({ ok: true, sourceLine: "BankOn Checking Account Overdraft Fee for items | $0 per item" });
    expect(checkFeeAgainstSource(gateCity, "Non-Sufficient Funds (NSF) Fee for items returned", 0, ".", "nsf").ok).toBe(true);
    // The standard $32 sits below a note line, so the shared check does not trace it under the
    // printed name yet: it has to come from a re-read once the reader can (#1735), not from here.
    expect(checkFeeAgainstSource(gateCity, "Overdraft fee for items paid resulting in a negative balance", 32, ".", "overdraft"))
      .toEqual({ ok: false, reason: "amount_not_the_fee" });
  });

  it("archives the row, rejects its verified row, records feedback and one run event", async () => {
    const { db, writes } = fakeDb(LIVE);
    const result = await applyHandTakedowns(db as never, { runId: 9, stepId: 90, batchId: "agentic-run-9", dryRun: false });
    expect(result.takenDown.map((item) => item.feePublishedId)).toEqual(IDS);
    expect(result.error).toBeNull();
    const takedowns = writes.filter((write) => write.text.includes("UPDATE published_fee_records"));
    expect(takedowns).toHaveLength(IDS.length);
    // The UPDATE repeats every listed field, so a row changed after the read is left alone.
    expect(takedowns[0].text).toContain("AND rolled_back_at IS NULL");
    expect(takedowns[0].text).toContain("AND institution_id = ?");
    expect(takedowns[0].text).toContain("AND canonical_fee_key = ?");
    expect(takedowns[0].text).toContain("AND fee_name = ?");
    expect(takedowns[0].values).toEqual(expect.arrayContaining(["agentic-run-9", "source_mismatch: #1496", 80423, 5433, "document_reproduction", "Fax (Local)", 15]));
    expect(takedowns[5].values).toEqual(expect.arrayContaining(["source_mismatch: #1370", 134129, 4815, "other_lending_fee", "Subordination Fee: Business", 10]));
    // Flagstar's $10 overdraft comes down; its current $30 (83117) is not listed and stays live.
    expect(takedowns[IDS.indexOf(83125)].values).toEqual(expect.arrayContaining(["source_mismatch: #1549", 83125, 33, "overdraft", "Overdraft Charge (each)", 10]));
    expect(HAND_TAKEDOWNS.some((entry) => entry.feePublishedId === 83117)).toBe(false);
    expect(writes.filter((write) => write.text.includes("UPDATE verified_fee_observations"))).toHaveLength(IDS.length);
    expect(writes.some((write) => write.text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    const events = writes.filter((write) => write.text.includes("INSERT INTO agent_run_events"));
    expect(events).toHaveLength(1);
    // The event names the publish step it ran in (run 7117's had none, #1605).
    expect(events[0].text).toContain("(agent_run_id, step_id, event_type");
    expect(events[0].values.slice(0, 2)).toEqual([9, 90]);
    expect(writes.some((write) => /\bDELETE\b/i.test(write.text))).toBe(false);
  });

  it("reads the rows an entry waits on along with the listed rows (#1659)", async () => {
    const { db } = fakeDb(LIVE);
    await applyHandTakedowns(db as never, { runId: 5, batchId: "b", dryRun: true });
    const read = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("SELECT fp.fee_published_id"));
    expect(read?.[1]).toEqual(expect.arrayContaining([102973, 102971]));
  });

  it("writes nothing on a dry run, and nothing again once the rows are down", async () => {
    const dry = fakeDb(LIVE);
    const planned = await applyHandTakedowns(dry.db as never, { runId: 1, batchId: "b", dryRun: true });
    expect(planned.takenDown).toHaveLength(IDS.length);
    expect(dry.writes).toHaveLength(0);

    const again = fakeDb([]);
    const result = await applyHandTakedowns(again.db as never, { runId: 2, batchId: "b", dryRun: false });
    expect(result.takenDown).toEqual([]);
    expect(again.writes).toHaveLength(0);
  });

  it("puts a failed read or write in the run ledger instead of failing the publish", async () => {
    const read = fakeDb(LIVE, "SELECT fp.fee_published_id");
    const readResult = await applyHandTakedowns(read.db as never, { runId: 3, stepId: 30, batchId: "b", dryRun: false });
    expect(readResult).toMatchObject({ takenDown: [], error: "boom: SELECT fp.fee_published_id" });
    expect(read.writes).toHaveLength(1);
    expect(read.writes[0].text).toContain("INSERT INTO agent_run_events");
    expect(read.writes[0].values).toEqual(expect.arrayContaining([3, 30, "Hand takedowns read failed, nothing written: boom: SELECT fp.fee_published_id"]));

    const write = fakeDb(LIVE, "UPDATE verified_fee_observations");
    const writeResult = await applyHandTakedowns(write.db as never, { runId: 4, stepId: 40, batchId: "b", dryRun: false });
    expect(writeResult.takenDown).toEqual([]);
    expect(writeResult.error).toBe("boom: UPDATE verified_fee_observations");
    const warning = write.writes.find((entry) => entry.text.includes("'step.warning'"));
    expect(warning?.values).toEqual(expect.arrayContaining([4, 40]));
    expect(String(warning?.values.at(-1))).toContain("hamilton.hand_takedown");
  });
});

// 55401 as it reads live on prod with its verified row 45477 joined, read-only, Oct 16.
const AUDIENCE_LIVE: LiveAudienceRow[] = [
  { fee_published_id: 55401, lineage_ref: 45477, institution_id: 8652, canonical_fee_key: "gift_card_purchase", fee_name: "Gift Cards", amount: "5.00", fee_audience: "unknown", audience_evidence: null },
];
// #1655's two Mechanics Bank business rows as they read live on prod with their verified rows joined, read-only, Oct 16.
const AUDIENCE_LIVE_1655: LiveAudienceRow[] = [
  { fee_published_id: 67110, lineage_ref: 77129, institution_id: 97, canonical_fee_key: "od_daily_cap", fee_name: "Maximum daily Overdraft or Returned Item fees (per day, business accounts)", amount: "350.00", fee_audience: "unknown", audience_evidence: null },
  { fee_published_id: 125484, lineage_ref: 93865, institution_id: 97, canonical_fee_key: "overdraft", fee_name: "Overdraft or Returned Item fee (business accounts)", amount: "35.00", fee_audience: "unknown", audience_evidence: null },
];
// #1664's two Bank Iowa ag-account rows (doc 31875) as they read live on prod with their verified rows joined, read-only, Oct 16.
const AUDIENCE_LIVE_1664: LiveAudienceRow[] = [
  { fee_published_id: 141041, lineage_ref: 166941, institution_id: 511, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly service charge", amount: "20.00", fee_audience: "unknown", audience_evidence: null },
  { fee_published_id: 141040, lineage_ref: 166940, institution_id: 511, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Charge", amount: "10.00", fee_audience: "unknown", audience_evidence: null },
];
const ONLY_55401 = HAND_AUDIENCE_FIXES.slice(0, 1);

function fakeAudienceDb(live: LiveAudienceRow[], failOn?: string) {
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
    if (text.includes("SELECT fp.fee_published_id")) return live;
    writes.push({ text, values });
    if (text.includes("UPDATE verified_fee_observations")) return [{ fee_verified_id: 45477 }];
    return [];
  });
  return { db, writes };
}

describe("hand audience fixes (#1302)", () => {
  it("lists each business fee, with darwin: evidence the audience trigger keeps", () => {
    expect(HAND_AUDIENCE_FIXES.map((fix) => [fix.feePublishedId, fix.from, fix.to])).toEqual([
      [55401, "unknown", "business"], [67110, "unknown", "business"], [125484, "unknown", "business"],
      [141041, "unknown", "business"], [141040, "unknown", "business"],
    ]);
    expect(HAND_AUDIENCE_FIXES.every((fix) => handAudienceEvidence(fix).startsWith(`darwin:hand_fix: #${fix.issue} `))).toBe(true);
    // A batch (one issue) of takedowns and audience fixes together stays under James's limit of 20.
    const batch1302 = HAND_AUDIENCE_FIXES.filter((fix) => fix.issue === 1302).length + HAND_TAKEDOWNS.filter((entry) => entry.issue === 1302).length;
    expect(batch1302).toBe(5);
    expect(batch1302).toBeLessThanOrEqual(HAND_TAKEDOWN_BATCH_LIMIT);
    // #1655: two takedowns and two audience fixes (5600 is an amount correction).
    const batch1655 = HAND_AUDIENCE_FIXES.filter((fix) => fix.issue === 1655).length + HAND_TAKEDOWNS.filter((entry) => entry.issue === 1655).length;
    expect(batch1655).toBe(4);
    // #1659: four takedowns (102971 is an amount correction, 102970 a rename).
    expect(HAND_TAKEDOWNS.filter((entry) => entry.issue === 1659)).toHaveLength(4);
    // #1664: two audience fixes and one takedown (60939 and 60940 are renames).
    const batch1664 = HAND_AUDIENCE_FIXES.filter((fix) => fix.issue === 1664).length + HAND_TAKEDOWNS.filter((entry) => entry.issue === 1664).length;
    expect(batch1664).toBe(3);
    expect(batch1664).toBeLessThanOrEqual(HAND_TAKEDOWN_BATCH_LIMIT);
  });

  it("fixes a row only while it still reads as listed, and once", () => {
    expect(planHandAudienceFixes([...AUDIENCE_LIVE, ...AUDIENCE_LIVE_1655, ...AUDIENCE_LIVE_1664])).toEqual({
      fixed: [
        { feePublishedId: 55401, feeVerifiedId: 45477, from: "unknown", fromEvidence: null, to: "business" },
        { feePublishedId: 67110, feeVerifiedId: 77129, from: "unknown", fromEvidence: null, to: "business" },
        { feePublishedId: 125484, feeVerifiedId: 93865, from: "unknown", fromEvidence: null, to: "business" },
        { feePublishedId: 141041, feeVerifiedId: 166941, from: "unknown", fromEvidence: null, to: "business" },
        { feePublishedId: 141040, feeVerifiedId: 166940, from: "unknown", fromEvidence: null, to: "business" },
      ],
      skipped: [],
    });
    expect(planHandAudienceFixes([]).skipped).toEqual([55401, 67110, 125484, 141041, 141040].map((feePublishedId) => ({ feePublishedId, reason: "not live" })));
    expect(planHandAudienceFixes([{ ...AUDIENCE_LIVE[0], fee_audience: "business" }], ONLY_55401).skipped).toEqual([{ feePublishedId: 55401, reason: "already fixed" }]);
    // Another audience, a newer verified row, or another name or price is not the listed row.
    for (const changed of [{ fee_audience: "consumer" }, { lineage_ref: 99 }, { amount: "4.00" }, { fee_name: "Gift Card" }]) {
      expect(planHandAudienceFixes([{ ...AUDIENCE_LIVE[0], ...changed }], ONLY_55401).skipped).toEqual([{ feePublishedId: 55401, reason: "changed since listed" }]);
    }
  });

  it("sets the verified audience, touches the live row, records the old value and one run event", async () => {
    const { db, writes } = fakeAudienceDb(AUDIENCE_LIVE);
    const result = await applyHandAudienceFixes(db as never, { runId: 9, stepId: 90, dryRun: false, list: ONLY_55401 });
    expect(result).toMatchObject({ fixed: [{ feePublishedId: 55401, to: "business" }], error: null });
    const verified = writes.find((write) => write.text.includes("UPDATE verified_fee_observations"));
    expect(verified?.text).toContain("AND fee_audience = ?");
    expect(verified?.values).toEqual(["business", handAudienceEvidence(HAND_AUDIENCE_FIXES[0]), 45477, "unknown"]);
    const touched = writes.find((write) => write.text.includes("UPDATE published_fee_records"));
    expect(touched?.text).toContain("SET fee_audience = fee_audience");
    expect(touched?.values).toEqual([55401]);
    expect(writes.some((write) => write.text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(writes.filter((write) => write.text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(writes.some((write) => /\bDELETE\b|rolled_back_at = NOW/i.test(write.text))).toBe(false);
  });

  it("writes nothing on a dry run or once fixed, and logs a failed write instead of failing the publish", async () => {
    const dry = fakeAudienceDb(AUDIENCE_LIVE);
    expect((await applyHandAudienceFixes(dry.db as never, { runId: 1, dryRun: true, list: ONLY_55401 })).fixed).toHaveLength(1);
    expect(dry.writes).toHaveLength(0);
    const done = fakeAudienceDb([{ ...AUDIENCE_LIVE[0], fee_audience: "business" }]);
    expect((await applyHandAudienceFixes(done.db as never, { runId: 2, dryRun: false, list: ONLY_55401 })).fixed).toEqual([]);
    expect(done.writes).toHaveLength(0);
    const failed = fakeAudienceDb(AUDIENCE_LIVE, "UPDATE verified_fee_observations");
    const result = await applyHandAudienceFixes(failed.db as never, { runId: 4, stepId: 40, dryRun: false, list: ONLY_55401 });
    expect(result).toMatchObject({ fixed: [], error: "boom: UPDATE verified_fee_observations" });
    expect(String(failed.writes.find((entry) => entry.text.includes("'step.warning'"))?.values.at(-1))).toContain("hamilton.hand_audience_fix");
  });
});
