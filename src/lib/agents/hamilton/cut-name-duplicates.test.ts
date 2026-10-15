import { describe, expect, it, vi } from "vitest";
import { applyCutNameDuplicates, CUT_NAME_DUPLICATES, planCutNameDuplicates, type LiveFeeRow } from "./cut-name-duplicates";
import { HAND_REFILES, planHandRefiles } from "./taxonomy-fold";

// Live rows on prod, read-only, Oct 15 (published_fee_records with their verified row).
const LIVE: LiveFeeRow[] = [
  { fee_published_id: 9647, lineage_ref: 3039, institution_id: 303, canonical_fee_key: "early_closure", fee_name: "Account closing fee", amount: "25.00" },
  { fee_published_id: 143045, lineage_ref: 66051, institution_id: 303, canonical_fee_key: "early_closure", fee_name: "00 Account closing fee", amount: "25.00" },
  { fee_published_id: 83198, lineage_ref: 92776, institution_id: 6710, canonical_fee_key: "od_protection_transfer", fee_name: "Overdraft transfer service", amount: "0.50" },
  { fee_published_id: 118050, lineage_ref: 12889, institution_id: 6710, canonical_fee_key: "od_protection_transfer", fee_name: "19 | Overdraft transfer service", amount: "0.50" },
  { fee_published_id: 83201, lineage_ref: 92779, institution_id: 6710, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing domestic wire transfer", amount: "15.00" },
  { fee_published_id: 118051, lineage_ref: 12892, institution_id: 6710, canonical_fee_key: "wire_domestic_outgoing", fee_name: "13 | Outgoing domestic wire transfer", amount: "15.00" },
  { fee_published_id: 141769, lineage_ref: 168259, institution_id: 7517, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire Transfer – Outgoing Domestic", amount: "20.00" },
  { fee_published_id: 143044, lineage_ref: 27072, institution_id: 7517, canonical_fee_key: "wire_domestic_outgoing", fee_name: "00 Wire Transfer – Outgoing Domestic", amount: "20.00" },
  { fee_published_id: 141770, lineage_ref: 168267, institution_id: 7517, canonical_fee_key: "check_image", fee_name: "Copy of Draft", amount: "2.00" },
  { fee_published_id: 143046, lineage_ref: 103970, institution_id: 7517, canonical_fee_key: "check_image", fee_name: "00 Copy of Draft", amount: "2.00" },
];

// The 13 rows renamed in place (HAND_REFILES, #1196 group 2), as they read live on Oct 15.
const RENAME_ROWS = [
  { fee_published_id: 99578, fee_verified_id: 110151, institution_id: 162, canonical_fee_key: "paper_statement", fee_name: "13 Account will default to a mailed statement and a monthly", amount: "2.00" },
  { fee_published_id: 97539, fee_verified_id: 110555, institution_id: 223, canonical_fee_key: "safe_deposit_box", fee_name: "12 consecutive months of: Key Replacement", amount: "30.00" },
  { fee_published_id: 65410, fee_verified_id: 70284, institution_id: 390, canonical_fee_key: "cashiers_check", fee_name: "36 months, 48 months, 60 months: Official Bank Check", amount: "5.00" },
  { fee_published_id: 65411, fee_verified_id: 70285, institution_id: 390, canonical_fee_key: "stop_payment", fee_name: "18 Month Variable Rate IRA CD: Money Order Stop Payment", amount: "25.00" },
  { fee_published_id: 53490, fee_verified_id: 56766, institution_id: 472, canonical_fee_key: "dormant_account", fee_name: "11 Inactive Account Inactive Account", amount: "5.00" },
  { fee_published_id: 68521, fee_verified_id: 81667, institution_id: 4610, canonical_fee_key: "check_image", fee_name: "12 posted and settled debit card transactions: Draft Photocopies", amount: "3.00" },
  { fee_published_id: 88066, fee_verified_id: 97986, institution_id: 4613, canonical_fee_key: "account_verification", fee_name: "16 Verification of Deposit", amount: "10.00" },
  { fee_published_id: 88067, fee_verified_id: 97987, institution_id: 4613, canonical_fee_key: "garnishment_levy", fee_name: "17 Processing Levies, Garnishments, Attachments, and other Legal Liens", amount: "75.00" },
  { fee_published_id: 88068, fee_verified_id: 97988, institution_id: 4613, canonical_fee_key: "counter_check", fee_name: "18 Starter/Temporary Checks – 2 Pages", amount: "0.00" },
  { fee_published_id: 57548, fee_verified_id: 42056, institution_id: 5113, canonical_fee_key: "money_order", fee_name: "12 Money Order Fee for First Step Accounts", amount: "1.70" },
  { fee_published_id: 108912, fee_verified_id: 126425, institution_id: 7697, canonical_fee_key: "dormant_account", fee_name: "31 Days of Interest: Dormant Account (after first 12 months)", amount: "12.00" },
  { fee_published_id: 131129, fee_verified_id: 150786, institution_id: 5100, canonical_fee_key: "atm_non_network", fee_name: "15 free ATM transactions per month and 15 free balance inquiries per month; then", amount: "2.00" },
  { fee_published_id: 70319, fee_verified_id: 84116, institution_id: 986, canonical_fee_key: "dormant_account", fee_name: "12 Months of Inactivity", amount: "2.95" },
].map((row) => ({ ...row, source_document_id: null }));

describe("#1196 cut-name duplicates", () => {
  it("takes down each listed cut row and keeps the clean row it repeats", () => {
    const plan = planCutNameDuplicates(LIVE);
    expect(plan.skipped).toEqual([]);
    expect(plan.takenDown).toEqual([
      { feePublishedId: 143045, feeVerifiedId: 66051, keepFeePublishedId: 9647 },
      { feePublishedId: 118050, feeVerifiedId: 12889, keepFeePublishedId: 83198 },
      { feePublishedId: 118051, feeVerifiedId: 12892, keepFeePublishedId: 83201 },
      { feePublishedId: 143044, feeVerifiedId: 27072, keepFeePublishedId: 141769 },
      { feePublishedId: 143046, feeVerifiedId: 103970, keepFeePublishedId: 141770 },
    ]);
    expect(CUT_NAME_DUPLICATES).toHaveLength(5);
  });

  it("leaves a row alone once it is down, changed, or its clean twin is gone", () => {
    const withoutCut = LIVE.filter((row) => Number(row.fee_published_id) !== 143045);
    expect(planCutNameDuplicates(withoutCut).skipped).toContainEqual({ feePublishedId: 143045, reason: "not live" });
    const renamed = LIVE.map((row) => (Number(row.fee_published_id) === 118050 ? { ...row, fee_name: "Overdraft transfer service" } : row));
    expect(planCutNameDuplicates(renamed).skipped).toContainEqual({ feePublishedId: 118050, reason: "changed since labelling" });
    const twinGone = LIVE.filter((row) => Number(row.fee_published_id) !== 141770);
    expect(planCutNameDuplicates(twinGone).skipped).toContainEqual({ feePublishedId: 143046, reason: "kept row not live as labelled" });
    expect(planCutNameDuplicates(twinGone).takenDown.map((item) => item.feePublishedId)).not.toContain(143046);
  });

  it("writes nothing on a dry run", async () => {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return Promise.resolve(strings.join("?").includes("SELECT fp.fee_published_id") ? LIVE : []);
    }) as unknown as Parameters<typeof applyCutNameDuplicates>[0];
    Object.assign(db, { unsafe: vi.fn(() => Promise.resolve([])) });
    const result = await applyCutNameDuplicates(db, { runId: 1, batchId: "agentic-run-1", dryRun: true });
    expect(result.takenDown).toHaveLength(5);
    expect(calls.some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });
});

describe("#1196 hand renames", () => {
  it("renames each of the 13 rows in place, keeping its category and price", () => {
    const moves = planHandRefiles(RENAME_ROWS);
    expect(moves.map((move) => [move.refile.feePublishedId, move.refile.from, move.refile.to, move.refile.name])).toEqual([
      [99578, "paper_statement", "paper_statement", "Mailed statement service charge"],
      [97539, "safe_deposit_box", "safe_deposit_box", "Key Replacement"],
      [65410, "cashiers_check", "cashiers_check", "Official Bank Check"],
      [65411, "stop_payment", "stop_payment", "Money Order Stop Payment"],
      [53490, "dormant_account", "dormant_account", "Inactive Account"],
      [68521, "check_image", "check_image", "Draft Photocopies"],
      [88066, "account_verification", "account_verification", "Verification of Deposit"],
      [88067, "garnishment_levy", "garnishment_levy", "Processing Levies, Garnishments, Attachments, and other Legal Liens"],
      [88068, "counter_check", "counter_check", "Starter/Temporary Checks – 2 Pages"],
      [57548, "money_order", "money_order", "Money Order Fee for First Step Accounts"],
      [108912, "dormant_account", "dormant_account", "Dormant Account (after first 12 months)"],
      [131129, "atm_non_network", "atm_non_network", "ATM Transactions at DFCU ATM (Local ATM)"],
      [70319, "dormant_account", "dormant_account", "VISA Gift Card Inactivity Fee"],
    ]);
    // Done once: a row already carrying its new name is not moved again.
    const done = RENAME_ROWS.map((row) => ({ ...row, fee_name: HAND_REFILES.find((refile) => refile.feePublishedId === row.fee_published_id)!.name }));
    expect(planHandRefiles(done)).toEqual([]);
  });
});
