import { describe, expect, it } from "vitest";
import type { MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { amountBasis, buildAmountEvidence, educationalPage, evidenceProblem, problemReason, quoteNamesOtherFee, quoteStatesFigure, scopeProblem } from "./evidence";

const READ = "2026-10-15";

/** Wells Fargo's monthly fee as the sample report read it on 17 Oct 2026 (rows 119366, 68710, 68708). */
const wells: MarketFeeLine = {
  institution_id: 4,
  line: "monthly_maintenance",
  id: 119366,
  amount: 15,
  fee_name: "Monthly service fee",
  source_url: "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/",
  updated_at: null,
  schedule_read_on: READ,
  source_line: "Monthly service fee | $5",
  tiers: [
    { id: 119366, amount: 5, fee_name: "Monthly service fee", source_line: "Monthly service fee | $5", source_url: "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/", schedule_read_on: READ },
    { id: 68708, amount: 25, fee_name: "Prime Checking Monthly service fee", source_line: "How to avoid the $25 monthly service fee", source_url: "https://www.wellsfargo.com/checking/prime/", schedule_read_on: READ },
    { id: 68710, amount: 15, fee_name: "Everyday Checking Monthly service fee", source_line: "Avoid the $15 monthly service fee", source_url: "https://www.wellsfargo.com/checking/everyday/", schedule_read_on: READ },
  ],
};

describe("buildAmountEvidence", () => {
  it("states the basis of a calculated amount and lists every record behind it", () => {
    const evidence = buildAmountEvidence(wells);
    expect(evidence.amount).toBe(15);
    expect(evidence.basis).toBe("middle of 3 published prices");
    expect(evidence.records.map((r) => [r.record_id, r.amount, r.source_url])).toEqual([
      [119366, 5, "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/"],
      [68710, 15, "https://www.wellsfargo.com/checking/everyday/"],
      [68708, 25, "https://www.wellsfargo.com/checking/prime/"],
    ]);
    expect(evidence.excluded).toEqual([]);
  });

  it("calls a single record a published price", () => {
    const one = { ...wells, tiers: undefined, amount: 5 };
    expect(buildAmountEvidence(one)).toMatchObject({ amount: 5, basis: "published price" });
  });

  it("excludes an article's general statement (TD's overdraft, row 64718)", () => {
    const td: MarketFeeLine = {
      institution_id: 12,
      line: "overdraft",
      id: 64718,
      amount: 35,
      fee_name: "The amount for overdraft fees varies, but",
      source_url: "https://www.td.com/us/en/personal-banking/learning/money-management/types-of-checking-accounts",
      updated_at: null,
      schedule_read_on: READ,
      source_line: "The amount for overdraft fees varies, but $35 each occurrence is common.",
    };
    const evidence = buildAmountEvidence(td);
    expect(evidence.amount).toBeNull();
    expect(evidence.excluded[0]).toMatchObject({ record_id: 64718, problem: "not_a_fee_schedule" });
  });

  it("rebuilds the amount from the records that remain", () => {
    const tiers = [...wells.tiers!];
    tiers[1] = { ...tiers[1], source_line: "Prime Checking Monthly service fee | $15" };
    const evidence = buildAmountEvidence({ ...wells, tiers });
    expect(evidence.excluded.map((r) => r.record_id)).toEqual([68708]);
    expect(evidence).toMatchObject({ amount: 10, basis: "midpoint of $5 and $15" });
  });
});

describe("evidence rules", () => {
  it("reads overdraft at the highest of its prices", () => {
    expect(amountBasis("overdraft", [25, 30])).toBe("highest of 2 published prices");
    expect(amountBasis("overdraft", [35, 35])).toBe("published price");
  });

  it("keeps a credit union's fee schedule filed under /learn/", () => {
    expect(educationalPage("https://beaconfed.org/learn/fee-schedule")).toBe(false);
    expect(educationalPage("https://www.truenorthfcu.org/learn/true-north-account-info/fees.html")).toBe(false);
    expect(educationalPage("https://www.schoolsfirstfcu.org/advice/financial-wellness/saving/dont-get-stung-by-banking-fees/")).toBe(true);
    expect(educationalPage("https://www.axosbank.com/personal/insights/finance/understanding-overdraft-fees")).toBe(true);
  });

  it("finds the figure in a quote that prices several accounts in one row", () => {
    const quote = "Monthly Service Charge | $8.00 fee can be avoided by maintaining a $1,500.00 average daily collected balance | $10.00 fee";
    expect(quoteStatesFigure(quote, 10)).toBe(true);
    expect(quoteStatesFigure(quote, 12)).toBe(false);
    expect(evidenceProblem("monthly_maintenance", { product: "Monthly Maintenance Fee", amount: 10, quote, source_url: null })).toBeNull();
    expect(evidenceProblem("monthly_maintenance", { product: "Monthly Maintenance Fee", amount: 12, quote, source_url: null })).toBe("quote_without_amount");
  });

  it("gives two prices as a midpoint", () => {
    expect(amountBasis("card_replacement", [15, 10])).toBe("midpoint of $10 and $15");
    expect(amountBasis("monthly_maintenance", [5, 15, 25])).toBe("middle of 3 published prices");
  });
});

describe("quoteNamesOtherFee (sample market, 17 Oct 2026)", () => {
  it("fails a quote that labels the amount as another fee", () => {
    // TD row 64716, filed as a monthly maintenance fee.
    const td = "Paper statements | $3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee";
    expect(quoteNamesOtherFee("monthly_maintenance", td, 3)).toBe(true);
    expect(evidenceProblem("monthly_maintenance", { product: "Monthly fee", amount: 3, quote: td, source_url: null })).toBe("quote_names_other_fee");
    // Regions row 101170, an ATM figure on the bank-by-mail line.
    expect(quoteNamesOtherFee("atm_non_network", "Bank By Mail Deposits . . . . . . $5.00 | including a check, in-person withdrawal, ATM", 5)).toBe(true);
    // Hancock Whitney row 66419: the sustained overdraft fee, not the per-item fee.
    expect(quoteNamesOtherFee("overdraft", "not qualify as a direct deposit. | Sustained Overdraft Fee of $36.00. This", 36)).toBe(true);
    // ServisFirst row 66594: $10 is the incoming wire, filed as outgoing.
    expect(quoteNamesOtherFee("wire_domestic_outgoing", "Domestic Wire Transfer Fees | Incoming - $10.00 Outgoing - $20.00", 10)).toBe(true);
  });

  it("keeps a quote whose label names the fee itself, or names no fee", () => {
    expect(quoteNamesOtherFee("wire_intl_outgoing", "International Wire Transfer Fees | Incoming - $20.00 Outgoing - $20.00", 20)).toBe(false);
    expect(quoteNamesOtherFee("wire_domestic_outgoing", "| Domestic Outgoing (per transfer) | $30.00 |", 30)).toBe(false);
    expect(quoteNamesOtherFee("monthly_maintenance", "A service charge of $5 will be imposed every statement cycle the daily balance falls below $500", 5)).toBe(false);
    expect(quoteNamesOtherFee("paper_statement", "Paper statements are available for an additional $2 per month", 2)).toBe(false);
    expect(quoteNamesOtherFee("stop_payment", "$33.00 each", 33)).toBe(false);
  });
});

describe("comparison rules (James, 17 Oct): add-ons and ATMs abroad stay out of the lines", () => {
  const rec = (product: string, amount: number, quote: string) => ({ product, amount, quote, source_url: "https://bank.example/fees.pdf" });

  it("leaves First Commerce's ATM surcharge-refund add-on out of monthly maintenance and keeps its checking option", () => {
    const addOn = rec("For a monthly fee", 2.99, "First Commerce offers the ATM Freedom add-on for the Power Checking account. For a monthly fee of $2.99, you’ll get unlimited surcharge refunds on withdrawals");
    expect(evidenceProblem("monthly_maintenance", addOn)).toBe("add_on_feature");
    expect(problemReason("monthly_maintenance", "add_on_feature", addOn)).toBe("ATM surcharge-refund add-on, not account maintenance");
    const option = rec("Power Checking + CoverMe Monthly service charge", 3.99, "Power Checking + CoverMe - $3.99/month");
    expect(evidenceProblem("monthly_maintenance", option)).toBeNull();
  });

  it("reads identity protection and perks packages in the fee's name, but keeps an account whose line lists them", () => {
    expect(scopeProblem("monthly_maintenance", rec("ID TheftSmart Fee", 2, "ID TheftSmart | $2.00"))).toBe("add_on_feature");
    expect(problemReason("monthly_maintenance", "add_on_feature", rec("Identity Protection monthly fee", 6, "$6"))).toBe("identity-protection add-on, not account maintenance");
    expect(scopeProblem("monthly_maintenance", rec("Rewards package monthly fee", 5, "$5"))).toBe("add_on_feature");
    // A premium account that includes ATM refunds is the account's own fee.
    expect(scopeProblem("monthly_maintenance", rec("Premier Checking Monthly service fee", 25, "Monthly service fee $25. Includes refunds of non-bank ATM surcharges"))).toBeNull();
  });

  it("keeps PNC's and Fifth Third's withdrawals abroad out of the domestic ATM line", () => {
    const abroad = rec("Non-PNC Bank ATM Fee (All Other Countries)", 5, "At non-PNC Bank ATMs in all other countries ........ $5.00 each");
    expect(scopeProblem("atm_non_network", abroad)).toBe("international_atm");
    expect(problemReason("atm_non_network", "international_atm", abroad)).toBe("international ATM withdrawal, not domestic");
    expect(scopeProblem("atm_non_network", rec("Non-PNC Bank ATM Fee (US, Canada, Puerto Rico, US Virgin Islands)", 3, "Puerto Rico and the U.S. Virgin Islands ........ $3.00 each"))).toBeNull();
    const fifth = rec("Non-Fifth Third ATM Fee", 5, "Transaction Amount; International ATM Withdrawal: $5.00; Non-Fifth Third");
    expect(scopeProblem("atm_non_network", fifth)).toBe("international_atm");
    expect(scopeProblem("atm_non_network", rec("Non-Fifth Third ATM Transaction", 3.5, "do not complete a fund transfer). Non-Fifth Third ATM Transaction: $3.50 per"))).toBeNull();
    // One price for domestic and international ATMs together is the network fee (fee-fold.ts).
    expect(scopeProblem("atm_non_network", rec("ATMs inside United States & internationally", 3, "ATMs inside United States & internationally | $3"))).toBeNull();
    expect(scopeProblem("atm_non_network", rec("Foreign ATM Withdrawal", 2.49, "ATM Transactions - Foreign ATM Withdrawal | $2.49 Per Transaction"))).toBeNull();
  });

  it("averages PNC's ATM line from its domestic price alone", () => {
    const pnc: MarketFeeLine = {
      institution_id: 8, line: "atm_non_network", id: 1, amount: 4, fee_name: "Non-PNC Bank ATM Fee", source_url: "https://pnc.example/fees.pdf", updated_at: null, schedule_read_on: READ, source_line: "",
      tiers: [
        { id: 13164, amount: 5, fee_name: "Non-PNC Bank ATM Fee (All Other Countries)", source_line: "At non-PNC Bank ATMs in all other countries ........ $5.00 each" },
        { id: 13165, amount: 3, fee_name: "Non-PNC Bank ATM Fee (US, Canada, Puerto Rico, US Virgin Islands)", source_line: "Puerto Rico and the U.S. Virgin Islands ........ $3.00 each" },
      ],
    };
    const evidence = buildAmountEvidence(pnc);
    expect(evidence).toMatchObject({ amount: 3, basis: "published price" });
    expect(evidence.excluded).toEqual([expect.objectContaining({ record_id: 13164, problem: "international_atm", reason: "international ATM withdrawal, not domestic" })]);
  });
});

describe("problemReason names what the quote describes and the fee it is not", () => {
  const rec = (product: string, amount: number, quote: string, source_url = "https://bank.example/fees.pdf") => ({ product, amount, quote, source_url });

  it("for a quote that gives the amount to a different fee", () => {
    expect(problemReason("overdraft", "quote_names_other_fee", rec("Overdraft Fee", 36, "not qualify as a direct deposit. | Sustained Overdraft Fee of $36.00. This"))).toBe("sustained overdraft, not per-item overdraft");
    expect(problemReason("wire_domestic_outgoing", "quote_names_other_fee", rec("Domestic Wire", 10, "Domestic Wire Transfer Fees | Incoming - $10.00 Outgoing - $20.00"))).toBe("incoming wire, not outgoing domestic wire");
    expect(problemReason("monthly_maintenance", "quote_names_other_fee", rec("Monthly fee", 3, "Paper statements | $3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee"))).toBe("paper statements, not account maintenance");
  });

  it("for an article, and only for a truly absent amount says the quote does not show it", () => {
    expect(problemReason("overdraft", "not_a_fee_schedule", rec("Overdraft", 35, "The amount for overdraft fees varies, but $35 each occurrence is common.", "https://www.td.com/us/en/personal-banking/learning/money-management/types-of-checking-accounts"))).toBe("educational article, not the bank's fee schedule");
    expect(problemReason("stop_payment", "quote_without_amount", rec("Stop payment", 30, "Stop payment | $5"))).toBe("the quote does not show the amount");
  });

  it("is carried on every left-out record the builder returns", () => {
    const td: MarketFeeLine = {
      institution_id: 12, line: "monthly_maintenance", id: 64716, amount: 3, fee_name: "Monthly fee", source_url: "https://td.example/fees", updated_at: null, schedule_read_on: READ,
      source_line: "Paper statements | $3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee",
    };
    expect(buildAmountEvidence(td).excluded[0]).toMatchObject({ problem: "quote_names_other_fee", reason: "paper statements, not account maintenance" });
  });
});
