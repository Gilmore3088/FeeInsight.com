import { describe, expect, it } from "vitest";

import {
  BROKERAGE_SEGMENT,
  brokerageLinkText,
  DEPOSIT_TOKEN,
  documentHostLabel,
  documentOpeningKind,
  documentOpeningKindSql,
  LOAN_OPENING,
  NOT_LOAN_OPENING,
  NOT_YOUTH_OPENING,
  openingLines,
  openingWords,
  YOUTH_OPENING_SUBJECT,
  YOUTH_OPENING_TITLE,
  documentPathSegments,
  documentPathSegmentsSql,
  documentTitleSegment,
  LOAN_SEGMENT,
  nonDepositDocumentKind,
  nonDepositKindSql,
  ratePageDocument,
  ratePageSql,
} from "./non-deposit-document";
import { NON_DEPOSIT_URL_FIXTURES, OPENING_FIXTURES } from "./non-deposit-document.fixtures";

describe("nonDepositDocumentKind (#1442)", () => {
  it.each(NON_DEPOSIT_URL_FIXTURES)("$url -> $kind ($why)", ({ url, kind }) => {
    expect(nonDepositDocumentKind(url)).toBe(kind);
  });

  it("normalises an address into its path segments", () => {
    expect(documentPathSegments("https://x.com/Docs/CreditCardAgreement-FINAL-v2.pdf?x=1#top")).toBe("/docs/credit card agreement/");
    expect(documentPathSegments("https://x.com/2024-Credit%20Card%20Agreement.pdf")).toBe("/credit card agreement/");
    expect(documentPathSegments("https://x.com")).toBe("//");
    expect(documentHostLabel("https://Wealth.Example.com:443/x")).toBe("wealth");
  });

  it("reads a title as one segment, and a deposit or business title wins", () => {
    expect(documentTitleSegment("Loan Rates")).toBe("/loan rates/");
    expect(nonDepositDocumentKind("https://x.com/download?id=7", "Credit Card Agreement")).toBe("loan");
    expect(nonDepositDocumentKind("https://x.com/download?id=7", "Wealth Management Fee Schedule")).toBe("brokerage");
    expect(nonDepositDocumentKind("https://x.com/download?id=7", "Make a Loan Payment")).toBeNull();
    expect(nonDepositDocumentKind("https://x.com/loans/auto-loans", "Checking Account Fee Schedule")).toBeNull();
    expect(nonDepositDocumentKind("https://x.com/investments", "Business Services")).toBeNull();
  });

  it("reads brokerage link words only where no deposit word stands (#1442 review)", () => {
    expect(brokerageLinkText("Brokerage Fee Schedule docs brokerage fee schedule pdf")).toBe(true);
    expect(brokerageLinkText("Trust & Investment Services")).toBe(true);
    expect(brokerageLinkText("Wealth Builder Savings")).toBe(false);
    expect(brokerageLinkText("Investment Money Market")).toBe(false);
    expect(brokerageLinkText("Fee Schedule personal checking savings and investments fee schedule pdf")).toBe(false);
    expect(brokerageLinkText("wp content uploads Investment and Deposit Fee Schedule pdf")).toBe(false);
    expect(brokerageLinkText("hsa investments fees")).toBe(false);
    expect(brokerageLinkText("Investors Bank Fee Schedule")).toBe(false);
    expect(nonDepositDocumentKind("https://x.com/wealth-builder", "Wealth Builder Savings")).toBeNull();
    expect(nonDepositDocumentKind("https://x.com/investments/money-market", "Investment Money Market")).toBeNull();
  });

  it("builds Postgres that carries the same patterns, with no JS-only escapes", () => {
    const path = documentPathSegmentsSql("sd.document_url");
    const kind = nonDepositKindSql("p.path", "p.host");
    expect(path).toContain("regexp_replace(");
    expect(path).toContain("'\\1 \\2'");
    expect(kind).toContain(`'${LOAN_SEGMENT}'`);
    expect(kind).toContain(`'${BROKERAGE_SEGMENT}'`);
    expect(kind).toContain(`'${DEPOSIT_TOKEN}'`);
    expect(kind).toContain("current|todays|today s|our) rates");
    expect(kind).toContain("'wealth', 'invest', 'investing', 'investments', 'brokerage'");
    expect(`${path}${kind}`).not.toMatch(/\\[bsdw]/);
    // The apostrophe class is doubled inside the literal.
    expect(path).toContain("'[''’]'");
  });
});

describe("documentOpeningKind (#1944)", () => {
  it.each(OPENING_FIXTURES)("$why -> $kind", ({ text, kind }) => {
    expect(documentOpeningKind(text)).toBe(kind);
  });

  it("reads only the first lines, and cuts each to words with list punctuation kept", () => {
    expect(openingLines("\n  A\n\n B \nC\nD")).toEqual(["A", "B", "C"]);
    expect(openingWords("Volt Teen Banking & Volt Banking accounts:")).toBe(" volt teen banking volt banking accounts , ");
    expect(documentOpeningKind(`${"x".repeat(2_100)}\nTD Fit Personal Unsecured Consumer Loan Disclosure`)).toBeNull();
  });

  it("never names a youth account from the address: such pages often carry the whole schedule", () => {
    expect(nonDepositDocumentKind("https://www.gtefinancial.org/products/go-student-checking")).toBeNull();
    expect(nonDepositDocumentKind("https://cdn.example.com/x_Youth%20Fee%20Schedule_April%202026.pdf")).toBeNull();
  });

  it("builds one Postgres subquery with the same patterns and no JS-only escapes", () => {
    const sql = documentOpeningKindSql("t.normalized_text");
    expect(sql).toContain(`'${LOAN_OPENING}'`);
    expect(sql).toContain(`'${NOT_LOAN_OPENING}'`);
    expect(sql).toContain(`'${YOUTH_OPENING_TITLE}'`);
    expect(sql).toContain(`'${YOUTH_OPENING_SUBJECT}'`);
    expect(sql).toContain(`'${NOT_YOUTH_OPENING}'`);
    expect(sql).toContain("left(COALESCE(t.normalized_text, ''), 2000)");
    expect(sql).not.toMatch(/\\[bsdw]/);
  });
});

describe("ratePageDocument (#1518)", () => {
  it("is true only for a loan document named as a rate page, with no loan product segment", () => {
    expect(ratePageDocument("https://www.siouxlandfederalcu.org/current-rates")).toBe(true);
    expect(ratePageDocument("https://www.bankofgreene.com/current-rates/")).toBe(true);
    expect(ratePageDocument("https://www.example.com/rate-sheet.pdf")).toBe(true);
    expect(ratePageDocument("https://www.example-cu.org/rates/loan-rates")).toBe(false);
    expect(ratePageDocument("https://www.example.com/personal/borrowing/todays-rates?type=mortgage")).toBe(false);
    expect(ratePageDocument("https://www.example.com/Personal/Fees%20and%20Rates/Consumer-Loan-Rate-Sheet_Jan2025.pdf")).toBe(false);
    expect(ratePageDocument("https://www.example.com/heloc")).toBe(false);
    expect(ratePageDocument("https://www.usbank.com/investing/self-directed-investing/pricing.html")).toBe(false);
    expect(ratePageDocument("https://www.example.com/fee-schedule")).toBe(false);
    expect(ratePageSql("p.path", "p.kind")).toContain("p.kind IS NOT DISTINCT FROM 'loan' AND p.path !~ '/(?:");
  });
});
