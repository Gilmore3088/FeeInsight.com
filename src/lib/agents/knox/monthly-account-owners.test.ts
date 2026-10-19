// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explicitAccountHeading } from "./lineup";
import { monthlyAccountOwnerReview } from "./monthly-account-owners";
import { runFreeSpecialists } from "./specialists";
import type { ExtractedFeeCandidate } from "./rules";
import { groundPaidRow } from "./paid-extract";

const fee = (overrides: Partial<ExtractedFeeCandidate> = {}): ExtractedFeeCandidate => ({
  canonicalHint: "monthly_maintenance", feeName: "Monthly fee", amount: 5,
  frequency: "monthly", confidence: .9, waivable: false,
  excerpt: "• $5.00 monthly fee if balance goes below average minimum balance", ...overrides,
});
const source = (name: string, balance = 50, price = 5) => [name,
  `• $${balance}.00 average monthly balance`, "• No per check charge",
  `• $${price}.00 monthly fee if balance goes below average`, "minimum balance"].join("\n");

describe("ambiguous monthly account ownership (#2259)", () => {
  it("holds the actual repaired PDF's repeated personal/business prices with full literal blocks", () => {
    const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
    const result = runFreeSpecialists(text, { institutionName: "Oakwood Bank" });
    expect(result.candidates.filter(row => row.canonicalHint === "monthly_maintenance")
      .map(row => [row.feeName, row.amount])).toEqual([["monthly fee if balance goes below minimum balance", 5]]);
    const held = result.held.filter(row => row.shape === "eligibility" && row.canonicalHint === "monthly_maintenance");
    expect(held.map(row => row.amount).sort()).toEqual([5, 7]);
    for (const row of held) {
      expect(row.ownedPolicy).toBe(true);
      expect(row.linkedConditions).toContain(row.amount === 5 ? "PERSONAL CHECKING" : "PERSONAL INTEREST CHECKING");
      expect(row.linkedConditions).toContain(row.amount === 5 ? "AGRI/BUSINESS CHECKING" : "AGRI/BUSINESS INTEREST CHECKING");
      expect(row.linkedConditions).toContain(row.amount === 5 ? "$50.00 average monthly balance" : "$500.00 average monthly balance");
      expect(row.linkedConditions).toContain(row.amount === 5 ? "minimum balance" : "monthly balance");
    }
  });
  it("does not select the first matching personal/business owner", () => {
    for (const headings of [["PERSONAL CHECKING", "BUSINESS CHECKING"], ["BUSINESS CHECKING", "PERSONAL CHECKING"]]) {
      const evidence = monthlyAccountOwnerReview(headings.map(name => source(name)).join("\n"))(fee());
      expect(evidence).toContain("PERSONAL CHECKING");
      expect(evidence).toContain("BUSINESS CHECKING");
    }
  });
  it("also holds equal-price ambiguity between two personal products", () => {
    expect(monthlyAccountOwnerReview(source("Freedom Checking") + "\n" + source("Rewards Checking"))(fee()))
      .toContain("Rewards Checking");
  });
  it("keeps unique, explicitly assigned, and fee-named owners eligible", () => {
    const text = source("PERSONAL CHECKING") + "\n" + source("BUSINESS CHECKING");
    expect(monthlyAccountOwnerReview(source("PERSONAL CHECKING"))(fee())).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ lineup: { productName: "PERSONAL CHECKING", minBalanceToAvoid: null,
      minOpeningDeposit: null, waiverText: null } }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ feeName: "PERSONAL CHECKING Monthly fee" }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ feeName: "PERSONAL CHECKING: Monthly fee" }))).toBeNull();
  });
  it("does not borrow a differently priced product or conflate explicit condition tiers", () => {
    expect(monthlyAccountOwnerReview(source("PERSONAL CHECKING") + "\n" + source("BUSINESS CHECKING", 500, 7))(fee())).toBeNull();
    const text = "PERSONAL CHECKING\nMonthly fee $5 if balance below $50\nBUSINESS CHECKING\nMonthly fee $5 if balance below $500";
    expect(monthlyAccountOwnerReview(text)(fee({ excerpt: "Monthly fee $5 if balance below $50" }))).toBeNull();
  });
  it("keeps a specific nested product name while refusing two independently named owners", () => {
    const text = source("Rewards Checking") + "\n" + source("Rewards Checking Plus");
    expect(monthlyAccountOwnerReview(text)(fee({ feeName: "Rewards Checking Plus Monthly fee" }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ feeName: "Rewards Checking Plus Monthly fee", lineup: {
      productName: "Rewards Checking Plus", minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null,
    } }))).toBeNull();
    const two = source("Freedom Checking") + "\n" + source("Business Checking");
    expect(monthlyAccountOwnerReview(two)(fee({ feeName: "Freedom Checking and Business Checking Monthly fee" }))).not.toBeNull();
  });
  it("keeps a literal product named without its source's generic account suffix", () => {
    const text = source("Convenience Checking Accounts") + "\n" + source("Prime Checking Accounts");
    expect(monthlyAccountOwnerReview(text)(fee({ feeName: "Monthly fee (Convenience Checking)" }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee())).toContain("Prime Checking Accounts");
    const nested = source("Rewards Checking Accounts") + "\n" + source("Rewards Checking Plus Accounts");
    expect(monthlyAccountOwnerReview(nested)(fee({ feeName: "Rewards Checking Plus Monthly fee" }))).toBeNull();
    expect(monthlyAccountOwnerReview(nested)(fee())).not.toBeNull();
    expect(monthlyAccountOwnerReview(source("Rewards Checking Account") + "\n" + source("Rewards Checking Accounts"))(fee())).toBeNull();
  });
  it("does not shorten an explicitly conditional quote to a different owner's flat clause", () => {
    const text = "Business Checking\nMonthly service fee $5\nPremium Money Market\nMonthly service fee $5 if account falls below minimum balance";
    expect(monthlyAccountOwnerReview(text)(fee({ excerpt: "Monthly service fee $5 if account falls below minimum balance" }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ excerpt: "Monthly service fee $5" }))).not.toBeNull();
  });
  it("ends a prior owner at an unsupported retired or unfamiliar account heading", () => {
    const text = "GO GREEN CHECKING\nSTUDENT CHECKING (No longer available)\nMonthly fee $5\nTRADITIONAL SAVINGS\nMonthly fee $5";
    expect(monthlyAccountOwnerReview(text)(fee({ excerpt: "Monthly fee $5" }))).toBeNull();
  });
  it("does not retain an unfinished or over-budget waiver/condition prefix", () => {
    const unfinished = "Monthly fee $5 may be waived\nwith the following:";
    const overBudget = "Monthly fee $5 unless I make three\nqualifying purchases during this month\nusing this account and\nreceive electronic statements";
    for (const row of [unfinished, overBudget]) {
      const text = `PERSONAL CHECKING\n${row}\nBUSINESS CHECKING\n${row}`;
      expect(monthlyAccountOwnerReview(text)(fee({ excerpt: row.split("\n")[0] }))).toBeNull();
    }
  });
  it("repeated rows of one owner and generic headings do not prove multiple owners", () => {
    expect(monthlyAccountOwnerReview(source("PERSONAL CHECKING") + "\n" + source("PERSONAL CHECKING"))(fee())).toBeNull();
    expect(monthlyAccountOwnerReview(source("FEES AND CHARGES") + "\n" + source("ACCOUNT RESEARCH"))(fee())).toBeNull();
    for (const heading of ["FEES AND CHARGES", "Account Research", "Truth in Savings", "Monthly Checking Fee $5", "Checking | Savings"])
      expect(explicitAccountHeading(heading, "Savings Bank")).toBeNull();
  });
  it("does not cross blank/cell boundaries or attach unrelated next-price conditions", () => {
    const text = source("PERSONAL CHECKING") + "\nBUSINESS CHECKING\n\n" + source("", 50).split("\n").slice(1).join("\n");
    expect(monthlyAccountOwnerReview(text)(fee())).toBeNull();
    expect(monthlyAccountOwnerReview(source("PERSONAL CHECKING") + "\nBUSINESS CHECKING | Other\n" + source("", 50).split("\n").slice(1).join("\n"))(fee())).toBeNull();
    const evidence = monthlyAccountOwnerReview(source("PERSONAL CHECKING") + "\n" + source("BUSINESS CHECKING") + "\nWire fee $30")(fee());
    expect(evidence).not.toContain("Wire fee $30");
  });
  it("leaves other categories and unsupported evidence unchanged", () => {
    const text = source("PERSONAL CHECKING") + "\n" + source("BUSINESS CHECKING");
    expect(monthlyAccountOwnerReview(text)(fee({ canonicalHint: "paper_statement" }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ excerpt: "Monthly fee | $5" }))).toBeNull();
    expect(monthlyAccountOwnerReview(text)(fee({ amount: 50 }))).toBeNull();
  });
  it.each([false, true])("recognizes an otherwise accepted paid quote with heading/balance=%s", headed => {
    const text = source("PERSONAL CHECKING") + "\n" + source("BUSINESS CHECKING");
    const paid = groundPaidRow({ fee_name: "Monthly fee", canonical_key: "monthly_maintenance", amount: 5,
      frequency: "monthly", source_line: headed ? source("PERSONAL CHECKING") : fee().excerpt }, text);
    expect(typeof paid).not.toBe("string");
    if (typeof paid === "string") throw new Error(paid);
    expect(monthlyAccountOwnerReview(text)(fee({ feeName: paid.feeName, excerpt: paid.sourceLine, lineup: paid.lineup })))
      .toContain("BUSINESS CHECKING");
  });
});
