import { describe, expect, it } from "vitest";

import {
  checkHeader,
  cleanAgreementRows,
  extractFeeTerms,
  indexCardAgreementZip,
  issuerMatchKey,
  matchIssuers,
  parseAgreementPartition,
  parseFeeAmount,
  readPrepaidMetadata,
  readTccpCsv,
} from "./cfpb-card-agreements";

describe("parseAgreementPartition", () => {
  it("reads the three families and refuses others", () => {
    expect(parseAgreementPartition("card-2026Q2")).toMatchObject({ family: "card", period: "2026Q2" });
    expect(parseAgreementPartition("prepaid-2026Q4")).toMatchObject({ family: "prepaid", period: "2026Q4" });
    expect(parseAgreementPartition("tccp-2025H2")).toMatchObject({ family: "tccp", period: "2025H2" });
    expect(parseAgreementPartition("2026Q2")).toBeNull();
  });
});

describe("parseFeeAmount", () => {
  it("parses one clear amount", () => {
    expect(parseFeeAmount("$95")).toMatchObject({ amountUsd: 95, amountPercent: null, qualifier: "exact", ambiguous: false });
    expect(parseFeeAmount("Up to $40")).toMatchObject({ amountUsd: 40, qualifier: "up_to" });
    expect(parseFeeAmount("3% of each transaction in U.S. dollars")).toMatchObject({ amountUsd: null, amountPercent: 3 });
    expect(parseFeeAmount("$1,250.00")).toMatchObject({ amountUsd: 1250 });
  });

  it("reads None as a stated zero", () => {
    expect(parseFeeAmount("None")).toMatchObject({ amountUsd: 0, qualifier: "none", ambiguous: false });
  });

  it("leaves hedged or several amounts null", () => {
    expect(parseFeeAmount("Either $10 or 5% of the amount, whichever is greater")).toMatchObject({ amountUsd: null, amountPercent: null, ambiguous: true });
    expect(parseFeeAmount("$0 introductory annual fee for the first year. After that, $95")).toMatchObject({ amountUsd: null, ambiguous: true });
    expect(parseFeeAmount("$5 intro fee")).toMatchObject({ amountUsd: null, ambiguous: true, reason: "hedged" });
    expect(parseFeeAmount("see below")).toMatchObject({ ambiguous: true, reason: "no_amount" });
  });
});

describe("extractFeeTerms", () => {
  const schumer = [
    "Annual Percentage Rate (APR) for Purchases 21.99%",
    "APR for Cash Advances 29.99%",
    "Fees",
    "Annual Fee None",
    "Transaction Fees",
    "• Balance Transfers Either $5 or 3% of the amount of each transfer, whichever is greater.",
    "• Cash Advance Either $10 or 5% of the amount of each cash advance, whichever is greater.",
    "• Foreign Transaction 3% of each transaction in U.S. dollars.",
    "Penalty Fees",
    "• Late Payment Up to $40",
    "• Returned Payment Up to $40",
    "Late Payment Fee. If we do not receive your minimum payment by the due date, we may charge up to $40.",
  ].join("\n");

  it("reads labelled lines and skips APR lines", () => {
    const terms = extractFeeTerms(schumer, "credit_card");
    const by = Object.fromEntries(terms.map((t) => [t.type, t]));
    expect(by.annual_fee).toMatchObject({ amountUsd: 0, qualifier: "none" });
    expect(by.cash_advance_fee).toMatchObject({ amountUsd: null, ambiguous: true, quotedText: expect.stringContaining("Either $10") });
    expect(by.balance_transfer_fee.ambiguous).toBe(true);
    expect(by.foreign_transaction_fee).toMatchObject({ amountPercent: 3, amountUsd: null });
    expect(by.late_fee).toMatchObject({ amountUsd: 40, qualifier: "up_to", lineCount: 2 });
    expect(by.returned_payment_fee).toMatchObject({ amountUsd: 40 });
  });

  it("nulls a fee whose labelled lines disagree", () => {
    const [late] = extractFeeTerms("Late Fee $29\nLate Fee $40", "credit_card");
    expect(late).toMatchObject({ amountUsd: null, ambiguous: true, reason: "lines_disagree", quotedText: "Late Fee $29" });
  });

  it("reads the prepaid short form", () => {
    const text = "Monthly fee $5.00\nPer purchase $0\nATM withdrawal $2.50\nATM balance inquiry $0.50\nCash reload $3.95";
    const by = Object.fromEntries(extractFeeTerms(text, "prepaid").map((t) => [t.type, t]));
    expect(by.monthly_fee.amountUsd).toBe(5);
    expect(by.atm_fee.amountUsd).toBe(2.5);
    expect(by.reload_fee.amountUsd).toBe(3.95);
  });
});

describe("indexCardAgreementZip", () => {
  it("names issuer by folder and product by file, dropping the shared root", () => {
    const index = indexCardAgreementZip(
      [
        "Credit_Card_Agreements_2026_Q2/",
        "Credit_Card_Agreements_2026_Q2/First Bank/Platinum_Card.pdf",
        "Credit_Card_Agreements_2026_Q2/Second CU/Rewards/agreement.pdf",
        "Credit_Card_Agreements_2026_Q2/loose.pdf",
        "Credit_Card_Agreements_2026_Q2/index.csv",
      ],
      "https://x/zip",
    );
    const by = Object.fromEntries(index.rows.map((r) => [r.fileName, r]));
    expect(by["Platinum_Card.pdf"]).toMatchObject({ issuerName: "First Bank", productName: "Platinum Card" });
    expect(by["agreement.pdf"]).toMatchObject({ issuerName: "Second CU", productName: "Rewards" });
    expect(by["loose.pdf"]).toMatchObject({ issuerName: null, productName: null });
    expect(index.layoutDepths).toEqual({ "1": 1, "2": 1, "3": 1 });
    expect(index.indexFiles).toEqual(["Credit_Card_Agreements_2026_Q2/index.csv"]);
  });
});

describe("header checks", () => {
  it("reports missing and unexpected headers", () => {
    const check = checkHeader(["Issuer Name", "Mystery"], { issuer: ["issuer_name"], product: ["product_name"] });
    expect(check).toMatchObject({ missing: ["product"], unexpected: ["Mystery"], used: { issuer: "Issuer Name" } });
  });

  it("reads prepaid metadata with the header as written", () => {
    const read = readPrepaidMetadata(
      '﻿issuer_name,product_name,agreement_id,agreement_url,effective_date,extra\n"Acme Bank","Acme Card",7,https://f/a/b.pdf,2025-01-01,x\n',
    );
    expect(read.check.missing).toEqual(["status", "withdrawalDate", "productType"]);
    expect(read.check.unexpected).toEqual(["extra"]);
    expect(read.rows[0]).toMatchObject({ recordKey: "id:7", issuerName: "Acme Bank", fileName: "b.pdf", effectiveDate: "2025-01-01" });
  });

  it("reads TCCP fee columns as labelled terms", () => {
    const read = readTccpCsv("Institution Name,Product Name,Annual Fee,Late Fee,Purchase APR Median\nAcme Bank,Gold,$95,,22.5\n");
    const row = read.rows[0];
    expect(row.issuerName).toBe("Acme Bank");
    const by = Object.fromEntries(row.terms.map((t) => [t.type, t]));
    expect(by.annual_fee).toMatchObject({ amountUsd: 95, quotedText: "Annual Fee: $95" });
    expect(by.late_fee).toBeUndefined();
    expect(by.purchase_apr.amountPercent).toBe(22.5);
    expect(read.check.missing).toContain("foreignTransactionFee");
  });
});

describe("matchIssuers", () => {
  const institutions = [
    { id: 1, name: "First Bank, N.A." },
    { id: 2, name: "Citizens Bank" },
    { id: 3, name: "Citizens Bank" },
    { id: 4, name: "Acme Credit Union" },
  ];

  it("accepts only a unique exact or normalized name", () => {
    const m = matchIssuers(["First Bank", "Citizens Bank", "acme credit union", "Acme CU"], institutions);
    expect(m.get("First Bank")).toMatchObject({ institutionId: 1, method: "normalized_name" });
    expect(m.get("Citizens Bank")).toMatchObject({ institutionId: null, reason: "ambiguous", candidates: 2 });
    expect(m.get("acme credit union")).toMatchObject({ institutionId: 4, method: "exact_name" });
    expect(m.get("Acme CU")).toMatchObject({ institutionId: null, reason: "no_match" });
  });

  it("drops a trailing N.A. only", () => {
    expect(issuerMatchKey("Example Bank, National Association")).toBe("EXAMPLE BANK");
  });
});

describe("cleanAgreementRows", () => {
  it("reports gaps, duplicates, impossible values and outliers without changing anything", () => {
    const row = (key: string, issuer: string | null) => ({
      kind: "credit_card" as const,
      recordKey: key,
      issuerName: issuer,
      productName: "P",
      fileName: "f.pdf",
      agreementUrl: null,
      externalId: null,
      status: null,
      effectiveDate: null,
      raw: {},
    });
    const rows = [row("a", "X"), row("a", "X"), row("b", null)];
    const term = (amountUsd: number | null, amountPercent: number | null = null) => ({
      type: "annual_fee" as const,
      quotedText: "",
      amountUsd,
      amountPercent,
      qualifier: "exact" as const,
      ambiguous: amountUsd === null && amountPercent === null,
      reason: null,
      lineCount: 1,
    });
    const terms = new Map<string, ReturnType<typeof term>[]>();
    for (let i = 0; i < 10; i += 1) terms.set(`k${i}`, [term(50)]);
    terms.set("big", [term(5000)]);
    terms.set("pct", [term(null, 150)]);
    terms.set("amb", [term(null)]);
    const report = cleanAgreementRows(rows, terms, new Map([["X", { institutionId: null, method: null, reason: "no_match", candidates: 0 }]]));
    expect(report.missingFields).toEqual({ issuer_name: 1 });
    expect(report.duplicateKeys).toBe(1);
    expect(report.duplicateAgreements).toBe(1);
    expect(report.unmatchedIssuerCount).toBe(1);
    expect(report.impossibleValues).toEqual([{ recordKey: "pct", type: "annual_fee", value: 150, why: "percent_over_100" }]);
    expect(report.outliers.map((o) => o.recordKey)).toEqual(["big"]);
    expect(report.ambiguousTerms).toEqual({ annual_fee: 1 });
  });
});
