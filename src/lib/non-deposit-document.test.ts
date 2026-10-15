import { describe, expect, it } from "vitest";

import {
  BROKERAGE_SEGMENT,
  DEPOSIT_TOKEN,
  documentHostLabel,
  documentPathSegments,
  documentPathSegmentsSql,
  documentTitleSegment,
  LOAN_SEGMENT,
  nonDepositDocumentKind,
  nonDepositKindSql,
} from "./non-deposit-document";
import { NON_DEPOSIT_URL_FIXTURES } from "./non-deposit-document.fixtures";

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
