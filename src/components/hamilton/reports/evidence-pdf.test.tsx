/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import type { EvidenceBoundAnalyzeResponse } from "@/lib/hamilton/evidence-contract";
import { AnalysisPdfDocument } from "./AnalysisPdfDocument";

// Synthetic fee data only; it is not a claim about any real institution.
const saved: EvidenceBoundAnalyzeResponse = {
  title: "Synthetic overdraft position",
  confidence: { level: "medium", basis: ["Published schedule"] },
  hamiltonView: "The synthetic bank charges nothing for a paid overdraft item.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [] },
  exploreFurther: [],
  factEvidence: {
    version: 1,
    generatedAt: "2026-07-03T00:00:00Z",
    facts: [
      {
        id: "fee:published:10001", kind: "observed",
        scope: { institutionId: 8109, feeCategory: "overdraft", product: null, reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
        value: 0, unit: "usd", currency: "USD", frequency: "per item", conditions: "If item is paid", status: "published",
        source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 10001, sourceDocumentIds: [5001], urls: ["https://fixture.invalid/fee-schedule"], asOf: "2026-06-30", verificationEventId: null },
      },
      {
        id: "fee:published:10002", kind: "observed",
        scope: { institutionId: 8109, feeCategory: "nsf", product: null, reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
        value: 30, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
        source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: null, sourceDocumentIds: [], urls: [], asOf: null, verificationEventId: null },
      },
    ],
    derivations: [],
    limitations: ["Synthetic record only."],
  },
};

async function renderedText(element: ReactElement) {
  const buffer = await renderToBuffer(element as unknown as ReactElement<DocumentProps>);
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return result.text.replace(/\s+/g, " ");
}

describe("analysis PDF evidence record (H06-T08)", () => {
  it("prints each saved figure with its source and date, keeps zero, and marks an untraceable record", async () => {
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis: saved, analysisFocus: "Fees" }));
    expect(text).toContain("Evidence Record");
    expect(text).toContain("$0");
    expect(text).toContain("as of 2026-06-30");
    expect(text).toContain("https://fixture.invalid/fee-schedule");
    expect(text).toContain("date not recorded");
    expect(text).toContain("Source not fully traceable");
    expect(text).toContain("It was not re-checked against the bank's current schedule");
    expect(text).not.toMatch(/verified against the (current )?live/i);
    expect(text).not.toContain("input lineage");
  }, 20000);

  it("leaves the section out of answers saved without structured evidence", async () => {
    const { factEvidence: _unused, ...legacy } = saved;
    void _unused;
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis: legacy, analysisFocus: "Fees" }));
    expect(text).not.toContain("Evidence Record");
  }, 20000);
});
