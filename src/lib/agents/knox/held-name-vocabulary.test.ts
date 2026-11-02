import { describe, expect, it } from "vitest";

import { findRereadCategoryMoves, type RereadCategoryRow } from "@/lib/agents/darwin/reread-category-check";
import { forLiveRelabel, HELD_VOCABULARY_RELABEL_LIVE, withHeldNameVocabulary } from "./held-name-vocabulary";
import { classifyFeeText } from "./rules";
import { runFreeSpecialists } from "./specialists";

/**
 * v157 near misses. Each positive line is the answer key's own source line (state key tid noted) or
 * the frozen text's; each look-alike must stay held, or keep the category main gives it. "Main" is
 * the vocabulary off (`withHeldNameVocabulary(false)`), which reads as main eaf6bef does.
 */
type Read = [string, number, string];
const reads = (line: string, on = true): Read[] =>
  withHeldNameVocabulary(on, () => runFreeSpecialists(line).candidates.map((c): Read => [c.canonicalHint, c.amount, c.feeName]));
const held = (line: string) => runFreeSpecialists(line).held.map((h) => [h.shape, h.canonicalHint, h.amount]);

const POSITIVES: Array<[string, string, Read[]]> = [
  ["tid 8034", "Skip-a-Loan payment | $25 per request", [["other_lending_fee", 25, "Skip-a-Loan payment"]]],
  ["tid 7114", "Year round skip-a-loan-payment $20.00 request", [["other_lending_fee", 20, "Year round skip-a-loan-payment"]]],
  ["tid 11470", "Loan Skip Pay (restrictions apply) | $35 where regionally offered", [["other_lending_fee", 35, "Loan Skip Pay (restrictions apply)"]]],
  ["tid 8085", "Reamortization schedule | $ 250.00", [["mortgage_modification", 250, "Reamortization schedule"]]],
  ["a re-amortization", "Re-amortization Fee | $100.00", [["mortgage_modification", 100, "Re-amortization Fee"]]],
  ["tid 8085", "Mortgage Payoff Processing Fee | $ 25.00", [["other_lending_fee", 25, "Mortgage Payoff Processing Fee"]]],
  ["tid 7114", "Foreign check acceptance $10.00", [["collection_item", 10, "Foreign check acceptance"]]],
  ["tid 3515", "Immigration letter $ 20.00", [["account_verification", 20, "Immigration letter"]]],
  ["tid 12752", "Proof of Funds Letter (Verification of Funds) | $10.00", [["account_verification", 10, "Proof of Funds Letter (Verification of Funds)"]]],
  ["tid 8034", "Verification of mortgage | $10 each", [["account_verification", 10, "Verification of mortgage"]]],
  ["tid 8036", "DMV Documentation and Transfer | $20.00", [["vehicle_title", 20, "DMV Documentation and Transfer"]]],
];

/** Look-alikes the vocabulary leaves exactly as main reads them (filed, held or unread). */
const AS_MAIN: Array<[string, string]> = [
  ["a late fee beside a skip-a-pay", "Late payment fee (skip-a-pay not available) | $25.00"],
  ["a skip-a-pay's late charge", "Skip-a-Pay late charge | $15.00"],
  ["an overdraft's skip", "Overdraft Skip-a-Pay | $10.00"],
  ["a free skip-a-pay", "Skip-a-Pay (free for members) | $0.00"],
  ["a skipped payment notice", "Skipped payment notice | $5.00"],
  ["a loan payment skip notice", "Loan Payment Skip Notice | $5.00"],
  ["a credit card's skip payment", "Credit Card Skip Payment | $25.00"],
  ["an account's modification", "Account Modification Request | $10.00"],
  ["an address's modification", "Modification of Address | $5.00"],
  ["a mortgage's modification (State key 12030 keys a bare \"$125.00\" under the retired type)", "Mortgage Modification | $125.00"],
  ["a home equity loan modification", "Home Equity Loan Modification | $150.00"],
  ["negative amortization", "Negative amortization | $0.00"],
  ["an amortization schedule (a category question for James, #1099)", "Amortization schedule – $10.00"],
  ["a bare loan payoff", "Loan Payoff | $10.00"],
  ["a bare processing fee", "Processing Fee | $25.00"],
  ["a payoff statement", "Payoff Statement | $20.00"],
  ["a foreign check cashed", "Foreign check cashing acceptance | $10.00"],
  ["a foreign check returned", "Returned foreign check acceptance | $15.00"],
  ["foreign currency", "Foreign currency acceptance | $5.00"],
  ["an immigration referral", "Immigration services referral | $5.00"],
  ["a letter of credit", "Letter of Credit | $50.00"],
  ["a signature's verification", "Verification of signature | $10.00"],
  ["an account's title change", "Account Title Change | $10.00"],
  ["a title change on an account", "Title change on account | $5.00"],
  ["a vehicle title transfer", "Vehicle Title Transfer | $15.00"],
  ["a PIN named in a sentence", "Your PIN number will be mailed separately. A replacement card is $5.00"],
  ["an account activity statement", "Account Activity Statement | $2.00"],
  ["a credit card's UCC filing", "Credit Card UCC Filing | $25.00"],
];

/** Look-alikes that stay held as unclassified, at their price. */
const HELD_UNCLASSIFIED: Array<[string, string, number]> = [
  ["a title search (a mortgage's pass-through)", "Title Search Fee | $75.00", 75],
  ["a closing's title and recording fees", "Title & Recording Fees | $40.00", 40],
  ["a loan's pass-through title charge in a sentence", "Plus credit report, title & recording fee if required | $600", 600],
  ["a real estate title fee", "Real Estate Title Fee | $50.00", 50],
  ["a mortgage title fee", "Mortgage Title Fee | $100.00", 100],
  ["a misspelled UCC lien (keys: other lending; DECISIONS v26: origination)", "UCC Lean Fee | $15.00 per item", 15],
  ["a wire with no direction", "Wire Transfer Fee | $20.00", 20],
  ["a misspelled loan extension (the one key files it as origination)", "Loan Extention Fee (per month) $35", 35],
  ["a credit card's over-limit fee", "Visa Over Limit Fee $20", 20],
  ["a credit card payment fee", "Visa Credit Card Payment Fee | $2.00 per payment", 2],
];

/** Look-alikes that read nothing. */
const UNREAD: Array<[string, string]> = [
  // A bare title fee needs a vehicle on its line or heading (`title-section.ts`, second review of #2888).
  ["a bare title fee under a miscellaneous heading (State key 3141)", "Miscellaneous Fees\nTitle Fee | $18.00"],
  ["a bare title fee with only its own note", "Title Fee (per title) | $15.00"],
  ["a credit card's skipped loan payment", "Skip-a-Loan payment on Visa credit card | $25.00"],
  ["a Mastercard skipped loan payment", "Mastercard skip-a-loan-payment | $25.00"],
  ["a modification priced as a percentage", "Mortgage Modification Fee | 1% of the unpaid balance"],
  ["a re-amortization priced as a percentage", "Re-amortization | 1% of the unpaid balance"],
  ["a sentence about amortization schedules", "Amortization schedules are available on request"],
  ["title insurance (a mortgage's pass-through)", "Title Insurance | $350.00"],
  ["a DMV insurance filing", "DMV Insurance Filing | $20.00"],
  ["a PIN on its own (guard v80)", "Pin Number | $ 2.50"],
  ["a PIN reminder or change (guard v80)", "PIN reminder/PIN change $ 2.00"],
  ["a printout (keys split between research and copies)", "Account Activity Printout | $1.00"],
  ["a UCC termination (a lien release, Oct 8, or a UCC fee, v26)", "UCC Termination | $20.00"],
  ["a wire transfer with no direction", "Wire Transfer | $20.00"],
  ["a reopened account", "Reopen Closed Account | $20.00"],
  ["a phone transfer (DECISIONS, Oct 7)", "Phone Transfers | $2.00 per transfer"],
];

describe("v157: names the taxonomy and DECISIONS already place", () => {
  for (const [source, line, expected] of POSITIVES) {
    it(`reads "${line}" (${source}), which main does not read`, () => {
      expect(reads(line)).toEqual(expected);
      expect(reads(line, false)).toEqual([]);
    });
  }
});

describe("v157 look-alikes", () => {
  for (const [what, line] of AS_MAIN) {
    it(`reads ${what} as main does: "${line}"`, () => {
      expect(reads(line, true)).toEqual(reads(line, false));
    });
  }
  for (const [what, line, amount] of HELD_UNCLASSIFIED) {
    it(`holds ${what} as unclassified: "${line}"`, () => {
      expect(reads(line)).toEqual([]);
      expect(held(line)).toEqual([["unclassified", null, amount]]);
    });
  }
  for (const [what, line] of UNREAD) {
    it(`reads nothing from ${what}: "${line}"`, () => {
      expect(reads(line)).toEqual([]);
    });
  }

  it("reads no vehicle title from a bare title transfer in a flattened misc block (Texas key 38)", () => {
    const line = "Deposit corrections – $1.00 Title transfers – $25.00 Notary – $5.00";
    expect(reads(line).filter(([key]) => key === "vehicle_title")).toEqual([]);
    expect(reads(line)).toEqual(reads(line, false));
  });

  it("keeps a re-amortization priced as a percentage held as one", () => {
    expect(held("Re-amortization | 1% of the unpaid balance")).toEqual([["percentage", "mortgage_modification", null]]);
  });
});

describe("HELD_VOCABULARY_RELABEL_LIVE: the paths that change a live fee read as main", () => {
  const text = ["Loan Services", "Year round skip-a-loan-payment $20.00 request"].join("\n");
  const fragment = "Year round skip-a-loan";
  const live: RereadCategoryRow = {
    fee_published_id: 501,
    fee_verified_id: 511,
    institution_id: 7114,
    fee_name: fragment,
    amount: "20.00",
    canonical_fee_key: "late_payment",
    source_document_id: 9001,
    fragment_name: fragment,
    document_text_id: 9101,
    normalized_text: text,
    same_amount: [],
  };

  it("is off", () => {
    expect(HELD_VOCABULARY_RELABEL_LIVE).toBe(false);
  });

  it("reads a live-correction path without the vocabulary while off, and with it only when switched on", () => {
    expect(forLiveRelabel(() => classifyFeeText("Skip-a-Loan payment"))).toBeNull();
    expect(forLiveRelabel(() => classifyFeeText("Skip-a-Loan payment"), true)).toBe("other_lending_fee");
    // Outside those paths (the extract step, Hamilton's rules re-check) the vocabulary reads.
    expect(classifyFeeText("Skip-a-Loan payment")).toBe("other_lending_fee");
  });

  it("leaves a live late fee on a skipped payment's line alone while off; switched on, Darwin would re-file it", () => {
    expect(findRereadCategoryMoves([live]).verdicts[0].outcome).toBe("not_found");
    const switchedOn = findRereadCategoryMoves([live], (t) => forLiveRelabel(() => runFreeSpecialists(t), true).candidates).verdicts[0];
    expect(switchedOn).toMatchObject({ outcome: "refile", newKey: "other_lending_fee" });
  });
});

describe("v157: a cap on the next line reads as main reads it beside a name main already files (State key 7114)", () => {
  // "Foreign check acceptance $10.00" / "Max of $45.00": main reads a collection fee with a "Max of"
  // after it (same line or next) at its own price and leaves the maximum unread, so the vocabulary does too.
  const block = (name: string) => `Fees\n${name} $10.00\nMax of $45.00\nNotary $2.00`;

  it("reads main's own collection names at $10 with the maximum unread", () => {
    expect(reads(block("Items sent for collection"), false)).toEqual([["collection_item", 10, "Items sent for collection"], ["notary_fee", 2, "Notary"]]);
    expect(reads("Fees\nForeign check collection fee $10.00 Max of $45.00\nNotary $2.00", false)).toContainEqual(["collection_item", 10, "Foreign check collection fee"]);
  });

  it("reads a foreign check's acceptance the same way", () => {
    expect(reads(block("Foreign check acceptance"))).toEqual([["collection_item", 10, "Foreign check acceptance"], ["notary_fee", 2, "Notary"]]);
    expect(reads(block("Foreign check acceptance")).some(([, amount]) => amount === 45)).toBe(false);
  });
});
