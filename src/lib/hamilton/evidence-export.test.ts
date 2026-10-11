import { describe, expect, it } from "vitest";
import { savedEvidenceAppendix } from "./evidence-export";
import type { EvidenceBoundAnalyzeResponse, HamiltonEvidenceFact, HamiltonDerivedFact } from "./evidence-contract";

// Synthetic fee data only; it is not a claim about any real institution.
const originalFact: HamiltonEvidenceFact = {
  id: "fee:published:10001",
  kind: "observed",
  scope: {
    institutionId: 8109,
    feeCategory: "overdraft",
    product: "Synthetic personal checking",
    reportingDate: null,
    effectiveDate: null,
    accountApplicability: "consumer",
  },
  value: 0,
  unit: "usd",
  currency: "USD",
  frequency: "per item",
  conditions: "If item is paid",
  audienceEvidence: "Personal accounts",
  status: "published",
  source: {
    label: "Published fee catalog",
    table: "published_fee_catalog",
    recordId: 10001,
    sourceDocumentIds: [5001],
    urls: ["https://fixture.invalid/8109/fee-schedule"],
    asOf: "2026-06-30",
    documentContentHash: "synthetic-hash",
    retrievedAt: "2026-07-01T01:02:03Z",
    lastCheckedAt: "2026-07-02T01:02:03Z",
    location: "page 4",
    verificationEventId: null,
  },
};

function saved(
  fact: HamiltonEvidenceFact = originalFact,
  derivations: HamiltonDerivedFact[] = [],
): EvidenceBoundAnalyzeResponse {
  return {
    title: "Synthetic fee analysis",
    confidence: { level: "high", basis: ["Historical numeric pool match"] },
    hamiltonView: "A comparison is directional, not independently verified.",
    whatThisMeans: "Source evidence requires inspection.",
    whyItMatters: [],
    evidence: { metrics: [{ label: "Fee", value: "$0" }] },
    exploreFurther: [],
    factEvidence: {
      version: 1,
      generatedAt: "2026-07-03T00:00:00Z",
      facts: [fact],
      derivations,
      limitations: ["Synthetic record only."],
    },
  };
}

describe("saved evidence appendix for H06 T08 PDF parity", () => {
  it("preserves original fee lineage, date meanings, account scope, conditions and zero", () => {
    const appendix = savedEvidenceAppendix(saved());
    const row = appendix.facts[0];
    expect(appendix.version).toBe(1);
    expect(appendix.generatedAt).toBe("2026-07-03T00:00:00Z");
    expect(appendix.narrativeClaimsVerified).toBe(false);
    expect(row).toMatchObject({
      id: "fee:published:10001",
      scope: {
        institutionId: 8109,
        feeCategory: "overdraft",
        product: "Synthetic personal checking",
        reportingDate: null,
        effectiveDate: null,
        accountApplicability: "consumer",
      },
      value: 0,
      unit: "usd",
      frequency: "per item",
      conditions: "If item is paid",
      audienceEvidence: "Personal accounts",
      source: {
        table: "published_fee_catalog",
        recordId: 10001,
        sourceDocumentIds: [5001],
        urls: ["https://fixture.invalid/8109/fee-schedule"],
        asOf: "2026-06-30",
        retrievedAt: "2026-07-01T01:02:03Z",
        lastCheckedAt: "2026-07-02T01:02:03Z",
        location: "page 4",
      },
      problems: [],
    });
    expect(row.scope.reportingDate).toBeNull();
    expect(row.scope.effectiveDate).toBeNull();
    expect(appendix.confidence.level).toBe("medium");
    expect(appendix.limitations.join(" ")).toContain("not independently verify");
  });

  it("exports the same frozen evidence before and after a saved JSON round trip", () => {
    const input = saved();
    const before = JSON.stringify(input);
    const reopened = JSON.parse(before) as EvidenceBoundAnalyzeResponse;
    expect(savedEvidenceAppendix(input)).toEqual(savedEvidenceAppendix(reopened));
    expect(JSON.stringify(input)).toBe(before);
    expect(input.confidence.level).toBe("high"); // historical storage is not rewritten
  });

  it("treats legacy high without a bundle as unverified and does not invent source rows", () => {
    const input = saved();
    delete input.factEvidence;
    const appendix = savedEvidenceAppendix(input);
    expect(appendix.confidence.level).toBe("medium");
    expect(appendix.version).toBeNull();
    expect(appendix.generatedAt).toBeNull();
    expect(appendix.facts).toEqual([]);
    expect(appendix.derivations).toEqual([]);
    expect(appendix.limitations).toContain("No record-bound evidence was saved with this answer.");
    expect(appendix.narrativeClaimsVerified).toBe(false);
  });

  it("preserves unknown/null separately from genuine $0 and flags incomplete evidence", () => {
    const incomplete: HamiltonEvidenceFact = {
      ...originalFact,
      value: null,
      frequency: null,
      scope: { ...originalFact.scope, accountApplicability: "unknown" },
      source: { ...originalFact.source, recordId: null, sourceDocumentIds: [], urls: [] },
    };
    const appendix = savedEvidenceAppendix(saved(incomplete));
    expect(appendix.facts[0].value).toBeNull();
    expect(appendix.facts[0].problems).toEqual(expect.arrayContaining([
      "unknown_account_applicability",
      "unknown_frequency",
      "missing_record_id",
      "missing_source_document_id",
      "uninspectable_source_url",
    ]));
    expect(appendix.limitations.join(" ")).toContain("incomplete");
  });

  it("rejects nonfinite source numbers without replacing them with a fabricated zero", () => {
    const invalid = { ...originalFact, value: Number.NaN };
    const appendix = savedEvidenceAppendix(saved(invalid));
    expect(appendix.facts[0].value).toBeNull();
    expect(appendix.facts[0].problems).toContain("invalid_numeric_value");
    expect(appendix.narrativeClaimsVerified).toBe(false);
  });

  it("exposes missing and incomplete derived input links rather than certifying a matching number", () => {
    const derivative: HamiltonDerivedFact = {
      id: "derived:current:8109:overdraft",
      kind: "derived",
      scope: { ...originalFact.scope },
      value: 0,
      unit: "usd",
      currency: "USD",
      status: "derived",
      derivation: {
        kind: "institution_value",
        inputFactIds: ["fee:published:10001", "fee:published:missing"],
        denominatorFactId: null,
        formula: "median",
        rounding: "stored",
      },
    };
    const appendix = savedEvidenceAppendix(saved(originalFact, [derivative]));
    expect(appendix.derivations[0].value).toBe(0);
    expect(appendix.derivations[0].problems).toContain("missing_input:fee:published:missing");
    expect(appendix.narrativeClaimsVerified).toBe(false);
  });

  it("marks duplicate evidence IDs and does not mutate stored source arrays", () => {
    const input = saved();
    input.factEvidence!.facts.push({ ...originalFact });
    const appendix = savedEvidenceAppendix(input);
    expect(appendix.facts.every((row) => row.problems.includes("duplicate_fact_id"))).toBe(true);
    appendix.facts[0].source.sourceDocumentIds.push(8888);
    appendix.facts[0].source.urls.push("https://fixture.invalid/changed");
    expect(originalFact.source.sourceDocumentIds).toEqual([5001]);
    expect(originalFact.source.urls).toEqual(["https://fixture.invalid/8109/fee-schedule"]);
  });
});
