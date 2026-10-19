// @vitest-environment node
import { describe, expect, it } from "vitest";
import { primaryAncillaryProduct, withAncillaryProduct } from "./ancillary-product";
import { ancillaryAccountText, ancillaryOfficialText } from "./ancillary-product-fixtures";

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
