// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SINGLE_ACCOUNT_DISCLOSURE_MAX_CHARS, primaryAncillaryProduct, singleAccountOwnerLive, withAncillaryProduct } from "./ancillary-product";
import { ancillaryAccountText, ancillaryOfficialText, singleAccountDisclosureText } from "./ancillary-product-fixtures";

describe("Explicit primary-document ancillary account ownership", () => {
  it("owns the actual official Safe Debit exceptions but not its general multi-account guide", async () => {
    const safe = await ancillaryOfficialText("safe");
    expect(primaryAncillaryProduct(safe), safe.slice(0, 2000)).toMatchObject({ productName: "Safe Debit Account" });
    expect(primaryAncillaryProduct(await ancillaryOfficialText("general"))).toBeNull();
  });
  it("keeps a generic product witness on its own price and conditions", () => {
    const text = ancillaryAccountText();
    const row = withAncillaryProduct({ feeName: "Personal money order", canonicalHint: "money_order", amount: 5 }, text);
    expect(row.ancillaryProduct).toMatchObject({ version: 1, productName: "Everyday Debit Account" });
    expect(row.ancillaryProduct?.ownLine).toContain("$5.00");
    expect(withAncillaryProduct({ feeName: "Personal money order", canonicalHint: "money_order", amount: 30 }, text).ancillaryProduct).toBeUndefined();
  });
  it("does not mistake a physical feature bullet ending in account for a second product heading", () => {
    expect(primaryAncillaryProduct(ancillaryAccountText() + "\nACCOUNT FEATURES\n• Multiple options for depositing funds to the account"))
      .toMatchObject({ productName: "Everyday Debit Account" });
  });
  it.each([
    "Consumer Account Pricing and Information", "Loan Account Pricing and Information", "Truth in Savings",
    "Everyday Debit Account Pricing and Information\nPremium Checking",
    "Everyday Debit Account Pricing and Information\nBasic Checking | Premium Checking",
    "Everyday Debit Account Pricing and Information\nPremium Debit Account Pricing and Information",
  ])("leaves mixed, generic or non-deposit scope unassigned: %s", (title) => {
    expect(primaryAncillaryProduct(ancillaryAccountText().replace("Everyday Debit Account Pricing and Information", title))).toBeNull();
  });
  it.each([
    "Premium no fee | Standard no fee\nPersonal money order | $5.00 each",
    "Premium | Standard\nPersonal money order | $5.00 each | $1.65 each",
    "Premium | Standard\nPersonal money order | $5.00 each | $5.00 each",
    "Premium\nStandard\nPersonal money order | $5.00 each",
    "Premium |\n| Standard\nPersonal money order | $5.00 each",
    "Premium | Standard\nPersonal money order $5.00 each",
    "Personal money order | $5.00 each | $1.65 each",
    "Personal money order $5.00 each $1.65 each",
    "Personal money order | 5.00 each | 1.65 each",
  ])("keeps shorthand/multiline/multiple-price columns unassigned: %s",(block)=>{
    const text=`Everyday Debit Account Pricing and Information\nACCOUNT TERMS AND FEES\n${block}`;
    expect(primaryAncillaryProduct(text)).toBeNull();
    expect(withAncillaryProduct({feeName:'Personal money order',canonicalHint:'money_order',amount:5},text).ancillaryProduct).toBeUndefined();
  });
  it("fails closed outside the title/block budgets",()=>{
    expect(primaryAncillaryProduct("\n".repeat(13)+ancillaryAccountText())).toBeNull();
    expect(primaryAncillaryProduct(ancillaryAccountText()+"\n".repeat(49))).toBeNull();
    expect(primaryAncillaryProduct(ancillaryAccountText()+"x".repeat(5001))).toBeNull();
  });
  it("stops its applicable fee block before another section", () => {
    const text = "Everyday Debit Account Pricing and Information\nACCOUNT TERMS AND FEES\nStop payment $30\nACCOUNT FEATURES\nPersonal money order $5";
    expect(withAncillaryProduct({ feeName: "Personal money order", canonicalHint: "money_order", amount: 5 }, text).ancillaryProduct).toBeUndefined();
  });
});

/** #1911 v2: real stored texts from prod (read-only, 2026-11-01). */
describe("single-account disclosures name their account", () => {
  it.each([
    ["24910-first-fed-bank-on", "First Fed Bank On Account", "Out of Network ATM Fee", 2.5, "atm_non_network"],
    ["27312-zing-second-chance", "Second Chance Checking Account", "Paper Statement Fee", 2, "paper_statement"],
    ["20067-boh-bankohana-level-1", "BANKOHANA - LEVEL I CHECKING", "Non-Sufficient Funds Item Returned/Returned Item Fee", 30, "nsf"],
  ] as const)("%s owns its own prices for %s", (fixture, product, feeName, amount, category) => {
    const text = singleAccountDisclosureText(fixture);
    expect(primaryAncillaryProduct(text)).toMatchObject({ productName: product, form: "single_account_disclosure" });
    const owned = withAncillaryProduct({ feeName, canonicalHint: category, amount }, text, null, { singleAccount: true });
    expect(owned.ancillaryProduct).toMatchObject({ version: 1, productName: product, form: "single_account_disclosure" });
    // A price the disclosure does not print is not witnessed.
    expect(withAncillaryProduct({ feeName, canonicalHint: category, amount: amount + 7 }, text, null, { singleAccount: true }).ancillaryProduct).toBeUndefined();
  });

  it("reads the Albany Bank account sheet title beside its account-number box", () => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("35510-albank-personal-interest"))).toMatchObject({ productName: "PERSONAL INTEREST CHECKING" });
  });

  it("stays off at read until KNOX_SINGLE_ACCOUNT_OWNER_LIVE is on", () => {
    const text = singleAccountDisclosureText("24910-first-fed-bank-on");
    const candidate = { feeName: "Out of Network ATM Fee", canonicalHint: "atm_non_network", amount: 2.5 };
    expect(withAncillaryProduct(candidate, text, null, { singleAccount: false }).ancillaryProduct).toBeUndefined();
    expect(singleAccountOwnerLive({} as NodeJS.ProcessEnv)).toBe(false);
    expect(singleAccountOwnerLive({ KNOX_SINGLE_ACCOUNT_OWNER_LIVE: " \"On\" " } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(singleAccountOwnerLive({ KNOX_SINGLE_ACCOUNT_OWNER_LIVE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("leaves a disclosure that also carries fees for all accounts unassigned", () => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("18704-cash-back-shared-schedule"))).toBeNull();
  });

  it("leaves a disclosure whose title does not open the text, or that never defers to the general schedule, unassigned", () => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("24908-first-fed-cash-tis"))).toBeNull();
    const bankOn = singleAccountDisclosureText("24910-first-fed-bank-on");
    expect(primaryAncillaryProduct(bankOn.replace("For additional fee information, refer to our Fee Schedule.", ""))).toBeNull();
    expect(primaryAncillaryProduct("Fee Schedule\nEffective 2026\nOverdraft $30\nATM $3\nNSF $30\nWire $25\nStop $30\n" + bankOn)).toBeNull();
  });

  it.each([
    ["a second account title", "\nInformation about your Premier Checking Account\n"],
    ["a second account column", "\nBank On Account | Premier Checking\n"],
    ["a standalone second account heading", "\nPremier Checking\n"],
  ])("fails closed on %s", (_label, extra) => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("24910-first-fed-bank-on") + extra)).toBeNull();
  });

  it.each([
    "Checking Account Disclosure", "Deposit Account Disclosure", "Truth in Savings Account Disclosure", "IRA Account Disclosure",
    // Review of #2870: more than one account, or no real account.
    "Checking and Savings Account Disclosure", "Checking & Savings Account Disclosure", "Checking/Savings Account Disclosures",
    "Savings and Money Market Account Disclosure", "Consumer and Business Checking Disclosure",
    "New Account Disclosure", "Joint Account Disclosure", "Online Account Disclosure", "Money Market Account Disclosure",
    "Overdraft Protection Account Disclosure", "Escrow Account Disclosure",
  ])("leaves a generic, non-account or non-deposit title unassigned: %s", (title) => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("24910-first-fed-bank-on").replace("First Fed Bank On Account Disclosure", title))).toBeNull();
  });

  it("fails closed when the text puts its prices on every account", () => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("24910-first-fed-bank-on") + "\nThese fees apply to every account type.\n")).toBeNull();
  });

  it("fails closed on a long text", () => {
    expect(primaryAncillaryProduct(singleAccountDisclosureText("24910-first-fed-bank-on") + "x".repeat(SINGLE_ACCOUNT_DISCLOSURE_MAX_CHARS))).toBeNull();
  });
});
