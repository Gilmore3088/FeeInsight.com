import { describe, expect, it } from "vitest";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { ownInstitutionAtm } from "@/lib/custom-report/own-institution-atm";
import { classifyFeeText, extractCandidatesFromText } from "./rules";

// Prod sample, Nov 2: United Nations FCU (institution 4967, agent_source_texts 3232,
// unfcu.org/fees-service-charges) prints its own Nairobi ATMs' withdrawal charge under its own heading,
// after the non-UNFCU network rows. Knox v157 filed the $2 as a non-network ATM fee; it went live as
// 16734 (published name "UNFCU ATM fees in Nairobi").
const UNFCU = `Over 3 balance inquiries per month per account outside the US | Excessive non-UNFCU/Co-op/Allpoint network ATM transactions7 $1.00/inquiry

Fees incurred

Foreign transaction fee for non-USD cash withdrawals | Fees incurred 1.00% ☆

UNFCU ATM fees in Nairobi

Cash withdrawals | UNFCU ATM fees in Nairobi $2.00 ☆

Share certificate early withdrawal penalty`;
const note = (artifact: number, line: string) => `Knox deterministic extraction from Rosetta artifact #${artifact}. canonical_hint=atm_non_network; excerpt="${line}"`;

describe("an ATM label that opens with the institution's own abbreviation (fee 16734)", () => {
  it("reads the bank's own machines, never a network, card or someone else's ATM", () => {
    expect(ownInstitutionAtm("UNFCU ATM fees in Nairobi")).toBe("UNFCU");
    expect(ownInstitutionAtm("Cash withdrawals | UNFCU ATM fees in Nairobi")).toBe("UNFCU");
    // Live names of the same class (Nov 2 dry run), each read on its stored line.
    for (const name of ["CBCU ATM Withdrawal", "CEFCU ATM's", "CBCU ATM", "IH ATM", "OPEFCU ATM", "RSB ATM"]) {
      expect(ownInstitutionAtm(name), name).not.toBeNull();
    }
    // A network or card word, a name that says the machine is someone else's, a note that says it is free.
    for (const name of ["HSA ATM Withdrawal/Inquiry (any location)", "PDFCU ATM Foreign Fee", "LNB ATM Foreign Transaction fee",
      "ATM not part of ACU ATM Network", "ATM Transaction Fee – outside UMB ATM network", "ATM Transactions (except CAFCU ATMs)",
      "NON CO OP ATM", "Non 1ST SUMMIT ATM use", "ATM fee – 5 free per month, LPCCU ATM FREE unlimited, POS no fee",
      "each. MAX ATM withdrawals are exempt from this charge; (m) Membership Fee", "CO-OP ATM Withdrawal", "MoneyPass ATM",
      "ATM USAGE ATM Usage Fee at a non-TXTCU ATM", "Foreign ATM Fee", "UNFCU ATM card replacement", "Western MD ATM Network"]) {
      expect(ownInstitutionAtm(name), name).toBeNull();
    }
  });

  it("Knox no longer files the Nairobi withdrawal as a non-network ATM fee", () => {
    expect(classifyFeeText("Cash withdrawals | UNFCU ATM fees in Nairobi")).toBeNull();
    const reads = extractCandidatesFromText(UNFCU).candidates;
    expect(reads.filter((read) => read.canonicalHint === "atm_non_network" && read.amount === 2)).toEqual([]);
    // The non-UNFCU network rows are still non-network ATM reads.
    expect(classifyFeeText("Over 8 withdrawals per month per account within the US | Excessive non-UNFCU/Co-op/Allpoint network ATM transactions")).toBe("atm_non_network");
  });

  it("the guard refuses the live fee as non-network, with no type to re-file to", () => {
    const live = { amount: "2.00", conditions: note(3232, "Cash withdrawals | UNFCU ATM fees in Nairobi $2.00 ☆") };
    expect(checkFeeCategory("atm_non_network", "UNFCU ATM fees in Nairobi", live)).toMatchObject({ ok: false, code: "name_contradicts" });
    // No type takes it: the re-file keeps its own key, so Hamilton takes it down.
    expect(refileCategory("atm_non_network", "UNFCU ATM fees in Nairobi")).toBe("atm_non_network");
    // The non-member surcharge at the bank's own ATM, under a tidied name (City of Boston CU 93868, text 18740).
    expect(checkFeeCategory("atm_non_network", "CBCU ATM", { amount: "3.00", conditions: note(18740, "at CBCU ATM | $3.00") }).ok).toBe(false);
  });

  it("keeps a price the line gives to other ATMs, and real non-network names", () => {
    // National Capital Bank 102925 (text 20671): "No fee at any NCB ATM; $1.25 at other ATMs plus surcharges".
    expect(checkFeeCategory("atm_non_network", "NCB ATM", { amount: "1.25", conditions: note(20671, "No fee at any NCB ATM; $1.25") }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "Excessive non-UNFCU/Co-op/Allpoint network ATM transactions", {
      amount: "1.00", conditions: note(3232, "Over 8 withdrawals per month per account within the US8 | Excessive non-UNFCU/Co-op/Allpoint network ATM transactions7 $1.00/withdrawal"),
    }).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "ATM Transaction Fee – outside UMB ATM network").ok).toBe(true);
  });
});
