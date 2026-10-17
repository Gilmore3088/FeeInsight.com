import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

import docs from "@/lib/agents/knox/__fixtures__/cut-cents-docs-2026-10-15.json";
import {
  HAND_AMOUNT_CHECK,
  HAND_AMOUNT_CORRECTIONS,
  HAND_REJECTED_TWINS,
  applyHandAmountCorrections,
  planHandAmountCorrections,
  planTwinRejections,
} from "./hand-amount-corrections";

type Doc = { text_id: number; text: string; text_sha256: string };
const textOf = (doc: number) => (docs as unknown as Record<string, Doc>)[String(doc)].text;

/**
 * #1655: Primis's pricing guide as stored (text 20768, doc 23695, read-only, Oct 16), the section
 * that holds its overdraft line. The whole text is 262,691 characters; it has no "Overdraft Item"
 * line, and this is its only line naming an overdraft item fee.
 */
const PRIMIS_PRICING =
  "MANAGEMENT\nTelephone Transfer | No Fee | WIRES\nOverdraft Protection Transfer | No Fee | Incoming Domestic Wire | No Fee\n" +
  "Account Closing | No Fee | Incoming International Wire | No Fee\nDeposit Correction | No Fee\n" +
  "Stop Payment | $35 Per Request | Banking Center | Online\nReturned Deposited Item | $10 | Outgoing Domestic Wire | $30 Per Wire | $10 Per Wire\nPer Item\n" +
  "Outgoing International Wire | $55 Per Wire | $40 Per Wire\nForeign Collection Item,\nCanadian or Other | $50 Per Item, Plus Third-Party Fees\n" +
  "International Wire Research | $50 Per Request\nDormant Account | $10 Per Month\nReturned Wire | $10 Per Wire\n" +
  "Overdraft or Returned-Item Fee | $35 Per Item\nWire Reversal | $10 Per Wire\n";
/** The same text's overdraft disclosure (lines 1138-1148), which the shared check matches "Overdraft Item Fee" at $0 to. */
const PRIMIS_DISCLOSURE =
  "DISCRETIONARY OVERDRAFT SERVICES DISCLOSURE\nWhat You Need to Know About Overdrafts and Overdraft Fees\n" +
  "Primis offers the following services to help manage overdrafts:\n1. Account Transfer Service: You may establish an automatic transfer from an eligible Primis deposit account\n" +
  "to cover overdrafts. There is no fee for this service.\n";
/**
 * #1659: U.S. Bank's checking-accounts page as stored (text 20686, doc 23628, read-only, Oct 16),
 * lines 445-503 and 543-579 in order (some lines between left out). The first "$10" anywhere in the
 * text is the Elite Money Market line at the end.
 */
const USBANK_CHECKING = "SMARTER BANKING + REWARDS\n\nBank Smartly Checking\n\n$12 Monthly Maintenance Fee can be waived in multiple ways1\n\nFlexible banking with perks and rewards, debit card access, interest earning and optional checks\n\nTrack spending, savings and subscriptions to help you manage your budget, all in one place\n\n$25 minimum opening deposit\n\nOpen an account\n\nLearn about Bank Smartly Checking\n\nNO MONTHLY MAINTENANCE FEES\n\nYoung adult & student checking (ages 18 to 24)\n\n$0 Monthly Maintenance Fee; $12 fee is waived for ages 18 to 241\n\nBank Smartly Checking with special benefits for young adults, including perks and rewards that grow with you\n\nSpending and savings goal tracking available anytime with the mobile app\n\nOverdraft Fee Forgiven and protection options\n\n$25 minimum opening deposit\n\nOpen an account\n\nLearn about young adult checking\n\nBUILD FINANCIAL SKILLS + DEBIT CARD\n\nTeen checking (ages 13 to 17)\n\n$0 Monthly Maintenance Fee; $12 fee is waived for ages 13 to 171\n\nBank Smartly Checking with special benefits for teens, including money management with a debit card and optional checks\n\nTools for saving, spending tracking and overdraft protection\n\n$25 minimum opening deposit\n\nOpen an account\n\nLearn about teen checking account\n\nBANKING MADE SIMPLE\n\nSafe Debit account2\n\n$4.95 Monthly Maintenance Fee with no minimum balance requirement\n\nMoney management with a debit card – no checks, no overdraft fees3\n\n$25 minimum opening deposit\n\nSeniors (age 65 or over)\n\n$12 Monthly Maintenance Fee waived on every U.S. Bank Smartly® Checking account1\n\n50% discount on personal check re-orders (U.S. Bank logo or personal)8 and the annual safe deposit box rental fees*\n\nNon-U.S. Bank ATM Surcharge reimbursed for the first fee charged by an ATM Owner (one per statement period, domestic only)45\n\n$10 Monthly Maintenance Fee waived on all Elite Money Market account with a U.S. Bank Smartly® Checking account\n";
/**
 * #1827: Valley Strong CU's fee page as stored (text 34862, doc 36716, read-only, Oct 17), its safe
 * deposit box table. The whole text is 92,074 characters, and this table holds its only "Box Annual
 * Fee" lines.
 */
const VALLEY_STRONG_BOXES =
  "| Safe Deposit Boxes | |\n| ------------------ | ------------------------------------- |\n" +
  "| **$195** | Drilling of Box by Locksmith/New Lock |\n| **$20** | Key Deposit |\n| **$11** | Key Replacement |\n" +
  "| **$45** | Rental of 3 × 5 Box Annual Fee |\n| **$55** | Rental of 5 × 5 Box Annual Fee |\n| **$80** | Rental of 3 × 10 Box Annual Fee |\n" +
  "| **$100** | Rental of 5 × 10 Box Annual Fee |\n| **$120** | Rental of 6 × 10 Box Annual Fee |\n| **$175** | Rental of 10 × 10 Box Annual Fee |\n\n" +
  "Rates effective as of 08/01/2026.\nAll rates, terms and conditions subject to change.\n";
const TEXTS: Record<number, string> = { 23695: `${PRIMIS_DISCLOSURE}${PRIMIS_PRICING}`, 23628: USBANK_CHECKING, 36716: VALLEY_STRONG_BOXES };

/** Each live row as it reads on prod (Oct 15; 5600 Oct 16), with its document's stored text. */
const OLD_NAMES: Record<number, string> = { 49175: "00 Loan Skip A Pay Fee", 29166: "00 ATM Transactions (per item)", 5600: "Overdraft Item Fee", 102971: "Maintenance Fee waived on every U.S. Bank Smartly® Checking account" };
const liveRows = HAND_AMOUNT_CORRECTIONS.map((fix) => ({
  fee_published_id: fix.feePublishedId,
  lineage_ref: fix.feePublishedId + 1_000_000,
  institution_id: fix.institutionId,
  canonical_fee_key: fix.canonicalFeeKey,
  fee_name: OLD_NAMES[fix.feePublishedId] ?? fix.feeName,
  amount: fix.from.toFixed(2),
  source_document_id: fix.sourceDocumentId,
  normalized_text: TEXTS[fix.sourceDocumentId] ?? textOf(fix.sourceDocumentId),
}));

describe("hand amount corrections (#1334)", () => {
  it("uses the stored texts byte for byte", () => {
    for (const [doc, entry] of Object.entries(docs as unknown as Record<string, Doc | string>)) {
      if (typeof entry === "string") continue;
      expect(createHash("sha256").update(entry.text).digest("hex"), doc).toBe(entry.text_sha256);
    }
  });

  it("corrects all fifteen on their own stored text: the corrected price traces and the wrong one no longer does", () => {
    const plan = planHandAmountCorrections(liveRows);
    expect(plan.skipped).toEqual([]);
    expect(plan.corrected.map((fix) => [fix.feePublishedId, fix.from, fix.to])).toEqual([
      [49175, 29, 29.95], [29166, 1, 1.5], [141772, 1, 1.5], [97435, 1, 1.5],
      [61650, 1, 1.5], [61934, 4, 4.5], [79234, 7, 7.5], [79237, 3, 3.5], [5600, 0, 35], [102971, 10, 12],
      [151737, 55, 45], [151738, 80, 55], [151739, 100, 80], [151740, 120, 100], [151741, 175, 120],
    ]);
    expect(plan.corrected.find((fix) => fix.feePublishedId === 49175)).toMatchObject({ oldName: "00 Loan Skip A Pay Fee", newName: "Loan Skip A Pay Fee" });
    expect(plan.corrected.find((fix) => fix.feePublishedId === 5600)).toMatchObject({
      oldName: "Overdraft Item Fee", newName: "Overdraft or Returned-Item Fee", sourceLine: expect.stringContaining("$35 Per Item"),
    });
  });

  it("#1655: Primis's $35 traces under its printed name, and the old name is printed nowhere", () => {
    expect(checkFeeAgainstSource(TEXTS[23695], "Overdraft or Returned-Item Fee", 35, ".", "overdraft")).toEqual({ ok: true, sourceLine: "Overdraft or Returned-Item Fee | $35 Per Item" });
    expect(checkFeeAgainstSource(TEXTS[23695], "Overdraft or Returned-Item Fee", 0, ".", "overdraft").ok).toBe(false);
    // The shared check loosely matches the old name's $0 to other fees' lines (the stored text's
    // "There is no fee for this service." and the free overdraft protection transfer), so the entry
    // tests instead that the old name is printed nowhere: "Overdraft Item" occurs 0 times in text 20768.
    expect(checkFeeAgainstSource(`${PRIMIS_DISCLOSURE}${PRIMIS_PRICING}`, "Overdraft Item Fee", 0, ".", "overdraft").ok).toBe(true);
    expect(HAND_AMOUNT_CORRECTIONS.find((entry) => entry.feePublishedId === 5600)?.oldNameNotPrinted).toBe(true);
    const primis = liveRows.find((row) => row.fee_published_id === 5600)!;
    expect(planHandAmountCorrections([primis]).corrected.map((fix) => fix.feePublishedId)).toEqual([5600]);
    // Were the old name printed, the row would be left alone.
    const printed = { ...primis, normalized_text: `${PRIMIS_PRICING}Overdraft  item fee | $0.00\n` };
    expect(planHandAmountCorrections([printed]).skipped).toContainEqual({ feePublishedId: 5600, reason: "old name still printed" });
  });

  it("#1659: U.S. Bank's Bank Smartly row takes its printed $12, and its $10 traces only to the Elite Money Market line", () => {
    expect(checkFeeAgainstSource(USBANK_CHECKING, "Bank Smartly Checking Monthly Maintenance Fee", 12, ".", "monthly_maintenance"))
      .toEqual({ ok: true, sourceLine: "$12 Monthly Maintenance Fee can be waived in multiple ways1" });
    const fix = HAND_AMOUNT_CORRECTIONS.find((entry) => entry.feePublishedId === 102971)!;
    // The wrong read still traces, but only to the other fee's line it was taken from.
    expect(checkFeeAgainstSource(USBANK_CHECKING, "Maintenance Fee waived on every U.S. Bank Smartly® Checking account", 10, ".", "monthly_maintenance"))
      .toEqual({ ok: true, sourceLine: fix.wrongReadTracesTo });
    const usbank = liveRows.find((row) => row.fee_published_id === 102971)!;
    expect(planHandAmountCorrections([usbank]).corrected).toEqual([expect.objectContaining({
      feePublishedId: 102971, from: 10, to: 12, oldName: "Maintenance Fee waived on every U.S. Bank Smartly® Checking account",
      newName: "Bank Smartly Checking Monthly Maintenance Fee", sourceLine: "$12 Monthly Maintenance Fee can be waived in multiple ways1",
    })]);
    // Were the $10 printed on the row's own line, the row would be left alone.
    const elsewhere = { ...usbank, normalized_text: `$10 Monthly Maintenance Fee waived on every U.S. Bank Smartly® Checking account\n${USBANK_CHECKING}` };
    expect(planHandAmountCorrections([elsewhere]).skipped).toContainEqual({ feePublishedId: 102971, reason: "wrong read traces to another line" });
  });

  it("#1827: Valley Strong's box rents take their own row's price, and each wrong read traces only to the next row", () => {
    const rents = HAND_AMOUNT_CORRECTIONS.filter((fix) => fix.issue === 1827);
    expect(rents.map((fix) => [fix.feePublishedId, fix.from, fix.to])).toEqual([
      [151737, 55, 45], [151738, 80, 55], [151739, 100, 80], [151740, 120, 100], [151741, 175, 120],
    ]);
    for (const fix of rents) {
      expect(checkFeeAgainstSource(VALLEY_STRONG_BOXES, fix.feeName, fix.to, ".", fix.canonicalFeeKey))
        .toEqual({ ok: true, sourceLine: `| **$${fix.to}** | ${fix.feeName} |` });
      expect(checkFeeAgainstSource(VALLEY_STRONG_BOXES, fix.feeName, fix.from, ".", fix.canonicalFeeKey))
        .toEqual({ ok: true, sourceLine: fix.wrongReadTracesTo });
    }
    // No two corrected rents share a price, and none takes the price of a rent that stays.
    expect(new Set(rents.map((fix) => fix.to)).size).toBe(rents.length);
    // A page whose wrong read traces elsewhere is left alone.
    const row = liveRows.find((live) => live.fee_published_id === 151737)!;
    const moved = { ...row, normalized_text: "| **$45** | Rental of 3 × 5 Box Annual Fee |\n| **$55** | Rental of 3 × 5 Box Annual Fee (rush) |\n" };
    expect(planHandAmountCorrections([moved]).skipped).toContainEqual({ feePublishedId: 151737, reason: "wrong read traces to another line" });
  });

  it("is a fixed list that leaves a changed, corrected or untraceable row alone", () => {
    const [first, ...rest] = liveRows;
    expect(planHandAmountCorrections([{ ...first, amount: "29.95" }, ...rest]).skipped).toEqual([{ feePublishedId: 49175, reason: "already corrected" }]);
    expect(planHandAmountCorrections([{ ...first, amount: "30.00" }, ...rest]).skipped).toEqual([{ feePublishedId: 49175, reason: "changed since labelling" }]);
    expect(planHandAmountCorrections([{ ...first, normalized_text: "Loan Skip A Pay Fee | $29" }, ...rest]).skipped[0].reason).toMatch(/does not trace|still traces/);
    expect(planHandAmountCorrections(rest).skipped).toEqual([{ feePublishedId: 49175, reason: "not live" }]);
    // A fee that is not on the list is never touched.
    expect(planHandAmountCorrections([{ ...first, fee_published_id: 1 }]).corrected).toEqual([]);
  });

  it("rejects the unpublished copies (four cut-cents, three #1360 plans) only while each reads as labelled", () => {
    const rows = HAND_REJECTED_TWINS.map((twin) => ({
      fee_verified_id: twin.feeVerifiedId, canonical_fee_key: twin.canonicalFeeKey, fee_name: twin.feeName,
      amount: twin.amount.toFixed(2), review_status: "verified", source_document_id: twin.sourceDocumentId, live_published: false,
    }));
    expect(planTwinRejections(rows).rejectedTwins).toEqual([113133, 112658, 157467, 125738, 66392, 167844, 102462]);
    expect(planTwinRejections([{ ...rows[0], live_published: true }, ...rows.slice(1)]).skippedTwins).toEqual([{ feeVerifiedId: 113133, reason: "published" }]);
    expect(planTwinRejections([{ ...rows[0], amount: "29.95" }, ...rows.slice(1)]).skippedTwins).toEqual([{ feeVerifiedId: 113133, reason: "changed since labelling" }]);
  });

  it("writes the published and verified rows, the rollback evidence and one run event", async () => {
    const twins = HAND_REJECTED_TWINS.map((twin) => ({
      fee_verified_id: twin.feeVerifiedId, canonical_fee_key: twin.canonicalFeeKey, fee_name: twin.feeName,
      amount: twin.amount.toFixed(2), review_status: "verified", source_document_id: twin.sourceDocumentId, live_published: false,
    }));
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("FROM published_fee_records fp")) return Promise.resolve(liveRows);
      if (text.includes("FROM verified_fee_observations fv")) return Promise.resolve(twins);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: values[2] }]);
      if (text.includes("SET review_status = 'rejected'")) return Promise.resolve((values[2] as number[]).map((id) => ({ fee_verified_id: id })));
      return Promise.resolve([]);
    });
    const result = await applyHandAmountCorrections(db as never, { runId: 7, dryRun: false });
    expect(result.corrected).toHaveLength(15);
    expect(result.rejectedTwins).toEqual([113133, 112658, 157467, 125738, 66392, 167844, 102462]);
    const verifiedUpdates = calls.filter((call) => call.text.includes("UPDATE verified_fee_observations") && call.text.includes("SET amount"));
    expect(verifiedUpdates).toHaveLength(15);
    // Each update lands only while the row still holds the cut amount.
    expect(calls.filter((call) => call.text.includes("UPDATE published_fee_records")).every((call) => call.text.includes("AND amount ="))).toBe(true);
    const feedback = calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"));
    const written = JSON.parse(String(feedback?.values[0])) as Array<{ dedupe_key: string; evidence: Record<string, unknown> }>;
    expect(written.find((row) => row.dedupe_key === `${HAND_AMOUNT_CHECK}:pub:49175`)?.evidence).toMatchObject({ old_amount: 29, new_amount: 29.95, old_name: "00 Loan Skip A Pay Fee", pattern: "cut_cents", issue: 1334 });
    expect(written.find((row) => row.dedupe_key === `${HAND_AMOUNT_CHECK}:pub:5600`)?.evidence).toMatchObject({
      old_amount: 0, new_amount: 35, old_name: "Overdraft Item Fee", new_name: "Overdraft or Returned-Item Fee", pattern: "wrong_read", issue: 1655,
    });
    expect(written.filter((row) => row.dedupe_key.startsWith(`${HAND_AMOUNT_CHECK}:twin:`))).toHaveLength(7);
    // Each copy carries its own pattern: one UPDATE per flag.
    const flags = calls.filter((call) => call.text.includes("SET review_status = 'rejected'")).map((call) => call.values[0]);
    expect(flags).toEqual(["hand_rejected:cut_cents_twin", "hand_rejected:optional_overdraft_plan_twin"]);
    expect(written.find((row) => row.dedupe_key === `${HAND_AMOUNT_CHECK}:twin:66392`)?.evidence).toMatchObject({ issue: 1360, flag: "hand_rejected:optional_overdraft_plan_twin" });
    expect(calls.filter((call) => call.text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("a dry run plans the same and writes nothing", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("FROM published_fee_records fp")) return Promise.resolve(liveRows);
      return Promise.resolve([]);
    });
    const result = await applyHandAmountCorrections(db as never, { runId: 7, dryRun: true });
    expect(result.corrected).toHaveLength(15);
    expect(db.mock.calls.some(([strings]) => /UPDATE|INSERT/.test((strings as TemplateStringsArray).join(" ")))).toBe(false);
  });
});
