import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { extractCandidatesFromText } from "@/lib/agents/knox/rules";
import { postSourceCheck, sourceLineFor } from "@/lib/agents/darwin/verify";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { bandedZeroOf } from "@/lib/banded-zero";

const zeros = (text: string) =>
  runFreeSpecialists(text).held.filter((row) => row.amount === 0).map((row) => [row.shape, row.canonicalHint, row.feeName]);

// Wells Fargo's overdraft services page, doc 33356 (institution 4), lines as stored.
const WELLS = [
  "Overdraft fee | $35 per item",
  "If we don't pay a transaction into overdraft, it will be declined or returned unpaid. We don't assess fees for declined or returned transactions.",
  "Overdraft fees can still apply even if you remove standard overdraft coverage. We do not assess fees for returned items or declined transactions.",
  "We do not charge transfer fees or advance fees for Overdraft Protection.",
  "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.",
].join("\n");

describe("Knox v124: a \"we do not charge\" sentence is the fee's confirmed $0 (#2040)", () => {
  it("holds Wells Fargo's NSF sentence as a zero read, once, under the name it prints", () => {
    expect(zeros(WELLS)).toEqual([["zero", "nsf", "Returned item/non-sufficient funds (NSF) fee"]]);
    // The priced overdraft fee on the same page is read as before.
    expect(runFreeSpecialists(WELLS).candidates.map((read) => [read.canonicalHint, read.amount])).toContainEqual(["overdraft", 35]);
  });

  it("goes through Darwin's checks like a \"No Fee\" row: traced, not a conditional $0, filed, not banded", () => {
    const [held] = runFreeSpecialists(WELLS).held.filter((row) => row.amount === 0);
    const line = sourceLineFor({ fee_name: held.feeName, amount: 0, source_document_id: 1, amount_kind: null, rate_percent: null } as never, new Map([[1, WELLS]]), "nsf");
    expect(line).toBe("We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.");
    expect(postSourceCheck("nsf", held.feeName, 0, line, WELLS)).toBeNull();
    expect(checkFeeCategory("nsf", held.feeName).ok).toBe(true);
    expect(bandedZeroOf({ line: held.excerpt, feeName: held.feeName, canonicalFeeKey: "nsf", documentText: WELLS })).toBeNull();
  });

  it("reads overdraft and overdraft transfer sentences too", () => {
    expect(zeros("We don't charge overdraft fees.\nWe do not charge for overdraft protection transfers.")).toEqual([
      ["zero", "overdraft", "Overdraft fee"],
      ["zero", "od_protection_transfer", "Overdraft transfer fee"],
    ]);
  });

  it("reads no $0 beside a priced read of the same category", () => {
    expect(zeros("NSF Fee | $30.00 per item\nWe do not charge NSF fees.")).toEqual([]);
    expect(extractCandidatesFromText("Overdraft Fee | $35.00\nWe don't charge overdraft fees.").held.filter((row) => row.amount === 0)).toEqual([]);
  });

  it("adds no second $0 when a free row already states it", () => {
    expect(zeros("NSF Returned Item Fee | No Fee\nWe do not charge NSF fees.").map(([, key]) => key)).toEqual(["nsf"]);
  });

  it("reads nothing from a waiver, a band, a cap or a consequence", () => {
    for (const text of [
      "We do not charge an NSF fee if you deposit a check from someone else in good faith, but it bounces on you.",
      "We do not charge overdraft fees on transactions under $5.",
      "We do not charge a fee for the first overdraft protection transfer each month.",
      "We will not charge more than 3 overdraft fees per day.",
      "In this situation, the full payment may go through, but we will not charge you an overdraft fee.",
      "We do not charge overdraft or NSF fees for one-time debit card or ATM transactions.",
      "We no longer charge NSF fees.",
      // Fidelity Bank, doc 23446: a bill pay service's row, under a schedule whose account NSF is $35.
      "BILL PAY SERVICES NSF | We do not charge a fee when we return an item unpaid due to insufficient funds in your account. However, the merchant may charge you a fee.",
    ]) {
      expect(zeros(text), text).toEqual([]);
    }
  });
});
