import { describe, expect, it } from "vitest";
import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import { checkFeeCategory, INTL_ABBREVIATION_REFILE_LIVE, intlAbbreviationRefile, refileCategory } from "@/lib/fee-category-guard";
import { abbreviatesInternationalWire } from "@/lib/fee-fold";
import { classifyFeeText, extractCandidatesFromText, titledPriceRead } from "./rules";
import { runFreeSpecialists } from "./specialists";

// #1513: each line as the bank's stored text prints it (agent_source_texts, prod, read-only, Oct 26).
// Banner FCU (inst 5653, doc 18876), live 63055 (hand re-filed Oct 16) beside 63054.
const BANNER = "Wire Trans. (Dom. Outgoing) …........…$18.00 per Wire\nDebit, ACH, Personal Check…..$35.00 per Item\nWire Trans. (Intern. Outgoing) ………...$35.00 per Wire";
// Inst 1405, live 90379-90382 (the excerpts Knox stored).
const INST_1405 = "Wire Transfers – Incoming | $15.00\nWire Transfers – Outgoing | $20.00\nInt. Wire Transfers – Incoming | $20.00\nInt. Wire Transfer – Outgoing | $40.00";
// Local 804 FCU (inst 6643, doc 27421), live 128668.
const LOCAL_804 = "After the 14-day grace period, there will be a Negative Balance Fee of $2.00 per day. For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a $1 Overdraft Transfer Fee.";

const reads = (text: string) => runFreeSpecialists(text).candidates.map((row) => [row.feeName, row.amount, row.canonicalHint]);

describe("Knox v120: a wire's abbreviated international (#1513)", () => {
  it("reads Intern., Int. before Wire, Internat'l and bare INTL as international on a wire", () => {
    for (const name of ["Wire Trans. (Intern. Outgoing)", "Int. Wire Transfer – Outgoing", "Internat'l Wire Outgoing", "Internat’l Wire Outgoing", "INTL Outgoing Manual Wire Fee"]) {
      expect(abbreviatesInternationalWire(name), name).toBe(true);
      expect(classifyFeeText(name), name).toBe("wire_intl_outgoing");
    }
    for (const name of ["Wire Trans. (Intern. Incoming)", "Int. Wire Transfers – Incoming", "Intl Wire Transfer – Incoming"]) {
      expect(classifyFeeText(name), name).toBe("wire_intl_incoming");
    }
  });

  it("keeps a domestic word, a non-wire line and a bare Int domestic or unread", () => {
    // One price for both: the name says domestic too.
    expect(abbreviatesInternationalWire("Dom./Intern. Outgoing Wire")).toBe(false);
    expect(classifyFeeText("Dom./Intern. Outgoing Wire")).toBe("wire_domestic_outgoing");
    expect(classifyFeeText("Wire Trans. (Dom. Outgoing)")).toBe("wire_domestic_outgoing");
    // "Int." away from "Wire" may be an intermediary bank's or interest; "Int" with no period is not one.
    expect(abbreviatesInternationalWire("Wire Transfer - Int. Bank Fee")).toBe(false);
    expect(abbreviatesInternationalWire("Int Wire Transfer – Outgoing")).toBe(false);
    expect(abbreviatesInternationalWire("Intern. Transfer Fee")).toBe(false);
    expect(classifyFeeText("Int. Paid")).toBe(null);
  });

  it("files Banner's and inst 1405's international wires as international, the plain ones domestic", () => {
    expect(reads(BANNER).filter((row) => String(row[2]).startsWith("wire_"))).toEqual([
      ["Wire Trans. (Dom. Outgoing)", 18, "wire_domestic_outgoing"],
      ["Wire Trans. (Intern. Outgoing)", 35, "wire_intl_outgoing"],
    ]);
    expect(reads(INST_1405)).toEqual([
      ["Wire Transfers – Incoming", 15, "wire_domestic_incoming"],
      ["Wire Transfers – Outgoing", 20, "wire_domestic_outgoing"],
      ["Int. Wire Transfers – Incoming", 20, "wire_intl_incoming"],
      ["Int. Wire Transfer – Outgoing", 40, "wire_intl_outgoing"],
    ]);
  });

  it("gives the source scope review the same reading, so the international read is admitted, not held", () => {
    expect(sourceOwnedWireScope(INST_1405, "Int. Wire Transfer – Outgoing", 40)).toMatchObject({ kind: "owned", geography: "international", directions: ["outgoing"] });
    expect(sourceOwnedWireScope(BANNER, "Wire Trans. (Intern. Outgoing)", 35)).toMatchObject({ kind: "owned", geography: "international", directions: ["outgoing"] });
    expect(sourceOwnedWireScope(INST_1405, "Wire Transfers – Outgoing", 20)).toMatchObject({ kind: "owned", geography: "unspecified" });
    expect(runFreeSpecialists(INST_1405).held.filter((row) => row.shape === "eligibility")).toEqual([]);
  });
});

describe("guard: the switched re-file of a domestic wire's abbreviated international (#1513)", () => {
  it("is on since James's yes (2026-10-26); off, it reads nothing: live 90381 and 90382 still pass as domestic", () => {
    expect(INTL_ABBREVIATION_REFILE_LIVE).toBe(true);
    const off = { intlAbbreviation: false };
    expect(checkFeeCategory("wire_domestic_outgoing", "Int. Wire Transfer – Outgoing", undefined, off).ok).toBe(true);
    expect(checkFeeCategory("wire_domestic_incoming", "Int. Wire Transfers – Incoming", undefined, off).ok).toBe(true);
    expect(refileCategory("wire_domestic_outgoing", "Int. Wire Transfer – Outgoing", null, off)).toBe("wire_domestic_outgoing");
    expect(intlAbbreviationRefile("wire_domestic_outgoing", "Int. Wire Transfer – Outgoing", false)).toBe(null);
  });

  it("on, re-files each to the international wire of its direction, and keeps a domestic-worded name", () => {
    const on = { intlAbbreviation: true };
    expect(checkFeeCategory("wire_domestic_outgoing", "Int. Wire Transfer – Outgoing", undefined, on)).toMatchObject({ ok: false, code: "name_contradicts" });
    expect(refileCategory("wire_domestic_outgoing", "Int. Wire Transfer – Outgoing", null, on)).toBe("wire_intl_outgoing");
    expect(refileCategory("wire_domestic_incoming", "Int. Wire Transfers – Incoming", null, on)).toBe("wire_intl_incoming");
    expect(refileCategory("wire_domestic_outgoing", "Wire Trans. (Intern. Outgoing)", null, on)).toBe("wire_intl_outgoing");
    expect(refileCategory("wire_domestic_outgoing", "Wire Trans. (Dom. Outgoing)", null, on)).toBe("wire_domestic_outgoing");
    expect(refileCategory("wire_domestic_outgoing", "Wire Transfers – Outgoing", null, on)).toBe("wire_domestic_outgoing");
    // The international wires it lands on accept the names.
    expect(checkFeeCategory("wire_intl_outgoing", "Int. Wire Transfer – Outgoing").ok).toBe(true);
    expect(checkFeeCategory("wire_intl_incoming", "Int. Wire Transfers – Incoming").ok).toBe(true);
  });
});

describe("Knox v120: a sentence's titled price names its category (#1513)", () => {
  it("files Local 804's $1 as the overdraft transfer, keeping the condition in brackets", () => {
    const rows = extractCandidatesFromText(LOCAL_804).candidates.filter((row) => row.amount === 1);
    expect(rows.map((row) => [row.feeName, row.canonicalHint])).toEqual([
      ["Overdraft Transfer Fee (For ATM and Debit Card transactions ONLY, when funds are available in your savings)", "od_protection_transfer"],
    ]);
    expect(reads(LOCAL_804).filter((row) => row[1] === 1)).toEqual([
      ["Overdraft Transfer Fee (For ATM and Debit Card transactions ONLY, when funds are available in your savings)", 1, "od_protection_transfer"],
    ]);
    expect(checkFeeCategory("od_protection_transfer", rows[0].feeName).ok).toBe(true);
  });

  it("names the fee by its title alone when the words before carry no condition", () => {
    expect(titledPriceRead("For each ATM transfer there will be a", " Overdraft Transfer Fee.", 5, "atm_non_network")).toEqual({ name: "Overdraft Transfer Fee", hint: "od_protection_transfer" });
  });

  it("keeps the read for a generic title, a qualifier before, the same category, no lead-in or no category", () => {
    // Generic: what the charge is for is the words before.
    expect(titledPriceRead("Requirements to Avoid a", " Monthly Fee:", 12, "monthly_maintenance")).toBe(null);
    expect(titledPriceRead("If you use another bank's ATM, there will be a", " Service Charge.", 2, "atm_non_network")).toBe(null);
    // A service charge title: the words before say what for (live 88206 stays the minimum balance fee).
    expect(titledPriceRead("If minimum average balance falls below $50.00 in the cycle period, a", " Base Service Charge will be assessed.", 5, "minimum_balance")).toBe(null);
    // A region, direction or audience before: the words before are the more specific fee.
    expect(titledPriceRead("For international wires, there is a", " Wire Transfer Fee.", 45, "wire_intl_outgoing")).toBe(null);
    expect(titledPriceRead("Business accounts will be charged a", " Overdraft Transfer Fee", 10, "atm_non_network")).toBe(null);
    // Same category: nothing to re-file.
    expect(titledPriceRead("Accounts closed early are assessed a", " Early Closure Fee.", 10, "early_closure")).toBe(null);
    // No "a/an" lead-in: the title may be the next row's.
    expect(titledPriceRead("ATM Withdrawal", " Overdraft Transfer Fee", 1, "atm_non_network")).toBe(null);
    // A title no rule files.
    expect(titledPriceRead("Members receive a", " Loyalty Bonus Fee", 25, "safe_deposit_box")).toBe(null);
  });
});
