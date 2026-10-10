import { describe, expect, it } from "vitest";
import {
  buildFeeResearchEvidence,
  claimBindingMatches,
  CLAIM_BINDING_LIMITATION,
  deriveDifference,
  derivePercentChange,
  structuredEvidenceConfidence,
  normalizeLegacyAnalyzeConfidence,
  LEGACY_HIGH_CONFIDENCE_LIMITATION,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import type { FeeResearch } from "./workspace/types";

function fact(overrides: Partial<HamiltonEvidenceFact> = {}): HamiltonEvidenceFact {
  return {
    id: "fee:published:1",
    kind: "observed",
    scope: {
      institutionId: 1,
      feeCategory: "overdraft",
      product: "Overdraft",
      reportingDate: "2026-06-30",
      effectiveDate: null,
      accountApplicability: "consumer",
    },
    value: 10,
    unit: "usd",
    currency: "USD",
    frequency: "per item",
    conditions: null,
    status: "published",
    source: {
      label: "Published fee catalog",
      table: "published_fee_catalog",
      recordId: 1,
      sourceDocumentIds: [100],
      urls: ["https://example.test/a.pdf"],
      asOf: "2026-06-30",
      verificationEventId: "event-1",
    },
    ...overrides,
  };
}

describe("claim binding", () => {
  it("binds the same number to the actual institution, category, unit and period", () => {
    const a = fact();
    expect(claimBindingMatches(a, { institutionId: 1, feeCategory: "overdraft", unit: "usd", reportingDate: "2026-06-30" })).toBe(true);
    expect(claimBindingMatches(a, { institutionId: 2 })).toBe(false);
    expect(claimBindingMatches(a, { feeCategory: "nsf" })).toBe(false);
    expect(claimBindingMatches(a, { unit: "percent" })).toBe(false);
    expect(claimBindingMatches(a, { reportingDate: "2024-06-30" })).toBe(false);
  });

  it("keeps a genuine zero as a known value rather than unknown", () => {
    const zero = fact({ value: 0 });
    expect(zero.value).toBe(0);
    expect(claimBindingMatches(zero, { institutionId: 1, feeCategory: "overdraft" })).toBe(true);
  });
});

describe("explicit derivations", () => {
  const bankA = fact({ id: "a", value: 10 });
  const bankB = fact({
    id: "b",
    value: 35,
    scope: { ...fact().scope, institutionId: 2 },
  });

  it("keeps a $25 comparison as a derivation with both inputs, not an observed fee", () => {
    const result = deriveDifference("delta:b-a", bankB, bankA);
    expect(result.problems).toEqual([]);
    expect(result.fact).toMatchObject({
      kind: "derived",
      value: 25,
      unit: "usd",
      derivation: { kind: "difference", inputFactIds: ["b", "a"] },
    });
    expect(result.fact?.scope.institutionId).toBeNull();
  });

  it("preserves direction instead of taking absolute value", () => {
    expect(deriveDifference("delta:a-b", bankA, bankB).fact?.value).toBe(-25);
  });

  it("rejects wrong-category arithmetic", () => {
    const nsf = fact({ id: "nsf", scope: { ...fact().scope, institutionId: 2, feeCategory: "nsf" } });
    expect(deriveDifference("bad", bankA, nsf)).toEqual({ fact: null, problems: ["fee_category_mismatch"] });
  });

  it("rejects wrong-unit arithmetic", () => {
    const rate = fact({ id: "rate", unit: "percent", currency: null });
    expect(deriveDifference("bad", bankA, rate).problems).toContain("unit_mismatch");
  });

  it("rejects mixed reporting periods instead of presenting them as one-period comparison", () => {
    const old = fact({ id: "old", scope: { ...fact().scope, reportingDate: "2024-06-30" } });
    expect(deriveDifference("bad", bankA, old).problems).toContain("reporting_period_mismatch");
  });

  it("requires a reporting period rather than silently treating unknown as current", () => {
    const unknown = fact({ id: "unknown", scope: { ...fact().scope, reportingDate: null } });
    expect(deriveDifference("bad", bankA, unknown).problems).toContain("reporting_period_unknown");
  });

  it("records the denominator and signed percent change", () => {
    const current = fact({ id: "current", value: 90 });
    const prior = fact({ id: "prior", value: 100 });
    const result = derivePercentChange("change", current, prior);
    expect(result.fact?.value).toBe(-10);
    expect(result.fact?.derivation.denominatorFactId).toBe("prior");
  });

  it("does not calculate a percent change with a zero denominator", () => {
    const current = fact({ id: "current", value: 10 });
    const prior = fact({ id: "prior", value: 0 });
    expect(derivePercentChange("change", current, prior).problems).toContain("zero_denominator");
  });
});

describe("FeeResearch evidence snapshot", () => {
  const research = {
    institutionId: 1,
    institutionName: "Synthetic Bank A",
    feeCategory: "overdraft",
    displayName: "Overdraft fee",
    current: 35,
    ownRows: [
      {
        id: 11,
        feeName: "Overdraft item",
        amount: 35,
        sourceDocumentId: 101,
        documentUrl: "https://example.test/schedule.pdf",
        sourceUrl: "https://example.test/fees",
        publishedAt: "2026-06-30",
        verifiedByEventId: "verify-11",
      },
      {
        id: 12,
        feeName: "Unknown row",
        amount: null,
        sourceDocumentId: 102,
        documentUrl: null,
        sourceUrl: null,
        publishedAt: "2026-06-30",
        verifiedByEventId: null,
      },
    ],
    peers: [
      {
        institutionId: 2,
        institutionName: "Synthetic Bank B",
        amount: 10,
        stateCode: "WA",
        sourceDocumentIds: [201],
        documentUrls: ["https://example.test/b.pdf"],
        publishedAt: "2026-06-30",
      },
    ],
    band: { p25: 10, median: 10, p75: 10, n: 1 },
    provenance: {
      generatedAt: "2026-10-10T00:00:00.000Z",
      dataAsOf: { fees: "2026-06-30" },
    },
  } as unknown as FeeResearch;

  it("captures published facts with source/document identity and omits null amounts", () => {
    const bundle = buildFeeResearchEvidence(research);
    expect(bundle.facts).toHaveLength(2);
    expect(bundle.facts[0]).toMatchObject({
      id: "fee:published:11",
      value: 35,
      scope: { institutionId: 1, feeCategory: "overdraft" },
      source: { recordId: 11, sourceDocumentIds: [101], verificationEventId: "verify-11" },
    });
    expect(bundle.facts.some((item) => item.source.recordId === 12)).toBe(false);
  });

  it("records collapsed current and peer median as derivations instead of pretending they are source rows", () => {
    const bundle = buildFeeResearchEvidence(research);
    expect(bundle.derivations.map((item) => item.derivation.kind)).toEqual(["institution_value", "peer_median"]);
    expect(bundle.derivations[0].derivation.inputFactIds).toEqual(["fee:published:11"]);
    expect(bundle.derivations[1].derivation.inputFactIds[0]).toContain("fee:peer:2:overdraft");
  });

  it("never upgrades structured evidence to a semantic verification claim", () => {
    const confidence = structuredEvidenceConfidence(buildFeeResearchEvidence(research));
    expect(confidence.level).toBe("medium");
    expect(confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
  });

  it("labels a missing evidence bundle honestly", () => {
    const confidence = structuredEvidenceConfidence(null);
    expect(confidence.level).toBe("medium");
    expect(confidence.basis.join(" ")).toContain("without claim-level");
  });
});


describe("legacy saved confidence compatibility", () => {
  const base = {
    title: "Legacy answer",
    confidence: { level: "high" as const, basis: ["Old figure matcher"] },
    hamiltonView: "Synthetic legacy answer.",
    whatThisMeans: "",
    whyItMatters: [],
    evidence: { metrics: [] },
    exploreFurther: [],
  };

  it("downgrades an old high rating in memory when no record-bound evidence exists", () => {
    const normalized = normalizeLegacyAnalyzeConfidence(base);
    expect(normalized.confidence.level).toBe("medium");
    expect(normalized.confidence.basis).toContain(LEGACY_HIGH_CONFIDENCE_LIMITATION);
    expect(base.confidence.level).toBe("high");
  });

  it("does not downgrade an artifact that actually carries structured evidence", () => {
    const factEvidence: HamiltonEvidenceBundle = {
      version: 1,
      generatedAt: "2026-10-10T00:00:00Z",
      facts: [],
      derivations: [],
      limitations: [],
    };
    const response = { ...base, factEvidence };
    expect(normalizeLegacyAnalyzeConfidence(response)).toBe(response);
  });

  it("does not change an already-medium artifact", () => {
    const response = { ...base, confidence: { level: "medium" as const, basis: ["Already bounded"] } };
    expect(normalizeLegacyAnalyzeConfidence(response)).toBe(response);
  });
});
