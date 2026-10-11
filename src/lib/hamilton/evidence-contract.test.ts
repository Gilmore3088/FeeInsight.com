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
    const prior = fact({ id: "prior", value: 100, scope: { ...fact().scope, reportingDate: "2025-06-30" } });
    const result = derivePercentChange("change", current, prior);
    expect(result.fact?.value).toBe(-10);
    expect(result.fact?.derivation.denominatorFactId).toBe("prior");
  });

  it("rejects two banks' values even when their dates match", () => {
    const current = fact({ id: "bank-a", value: 90 });
    const prior = fact({ id: "bank-b", value: 100, scope: { ...fact().scope, institutionId: 2 } });
    expect(derivePercentChange("wrong-bank-change", current, prior).problems).toContain("institution_mismatch");
  });

  it("rejects same-date records as a chronological change", () => {
    const current = fact({ id: "now", value: 90 });
    const prior = fact({ id: "then", value: 100 });
    expect(derivePercentChange("same-date-change", current, prior).problems).toContain("reporting_period_order_invalid");
  });

  it("rejects a future prior observation", () => {
    const current = fact({ id: "old", value: 90, scope: { ...fact().scope, reportingDate: "2025-06-30" } });
    const prior = fact({ id: "future", value: 100 });
    expect(derivePercentChange("backwards-change", current, prior).problems).toContain("reporting_period_order_invalid");
  });

  it("rejects a percent change across different fee products", () => {
    const current = fact({ id: "current", value: 90 });
    const prior = fact({ id: "prior", value: 100, scope: { ...fact().scope, reportingDate: "2025-06-30", product: "Different fee" } });
    expect(derivePercentChange("wrong-product-change", current, prior).problems).toContain("product_mismatch");
  });

  it("does not infer an institution for a percent change when both subjects are unknown", () => {
    const current = fact({ id: "current", value: 90, scope: { ...fact().scope, institutionId: null } });
    const prior = fact({ id: "prior", value: 100, scope: { ...fact().scope, institutionId: null, reportingDate: "2025-06-30" } });
    expect(derivePercentChange("unknown-bank-change", current, prior).problems).toContain("institution_mismatch");
  });

  it("does not calculate a percent change with a zero denominator", () => {
    const current = fact({ id: "current", value: 10 });
    const prior = fact({ id: "prior", value: 0, scope: { ...fact().scope, reportingDate: "2025-06-30" } });
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
        frequency: "per item",
        feeAudience: "consumer",
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
    expect(bundle.facts).toHaveLength(1);
    expect(bundle.facts[0]).toMatchObject({
      id: "fee:published:11",
      value: 35,
      scope: { institutionId: 1, feeCategory: "overdraft" },
      source: { recordId: 11, sourceDocumentIds: [101], verificationEventId: "verify-11" },
    });
    expect(bundle.facts.some((item) => item.source.recordId === 12)).toBe(false);
  });

  it("keeps a compatible current derivation without inventing observed peer fees", () => {
    const bundle = buildFeeResearchEvidence(research);
    expect(bundle.derivations.map((item) => item.derivation.kind)).toEqual(["institution_value"]);
    expect(bundle.derivations[0].derivation.inputFactIds).toEqual(["fee:published:11"]);
    expect(bundle.facts.some((item) => item.id.startsWith("fee:peer:"))).toBe(false);
    expect(bundle.limitations.join(" ")).toContain("contributing published fee-row IDs");
  });


  it("rejects a three-service synthetic category median as one product fee", () => {
    const base = research.ownRows[0];
    const mixed = {
      ...research,
      feeCategory: "monthly_maintenance", current: 10,
      ownRows: [
        { ...base, id: 21, feeName: "Checking monthly service", amount: 5, frequency: "monthly", sourceDocumentId: 201 },
        { ...base, id: 22, feeName: "Signature guarantee", amount: 10, frequency: null, sourceDocumentId: 202 },
        { ...base, id: 23, feeName: "IRS processing", amount: 50, frequency: "per item", sourceDocumentId: 201 },
      ], peers: [], band: null,
    } as FeeResearch;
    const bundle = buildFeeResearchEvidence(mixed);
    expect(bundle.facts).toHaveLength(3);
    expect(bundle.derivations.some((item) => item.derivation.kind === "institution_value")).toBe(false);
    expect(bundle.limitations.join(" ")).toContain("incompatible");
  });

  it("keeps a genuine $0 from a sourced consumer product", () => {
    const one = {
      ...research, feeCategory: "monthly_maintenance", current: 0,
      ownRows: [{ ...research.ownRows[0], id: 31, feeName: "Checking monthly fee",
        frequency: "monthly", feeAudience: "consumer", sourceDocumentId: 301, amount: 0 }],
      peers: [], band: null,
    } as FeeResearch;
    const bundle = buildFeeResearchEvidence(one);
    expect(bundle.facts[0].value).toBe(0);
    expect(bundle.derivations.find((item) => item.derivation.kind === "institution_value")?.value).toBe(0);
  });

  it("rejects an amount that does not equal the actual canonical median", () => {
    const base = { ...research.ownRows[0], feeName: "Checking fee", frequency: "monthly" };
    const wrong = { ...research, feeCategory: "monthly_maintenance", current: 10,
      ownRows: [{ ...base, id: 41, amount: 5 }, { ...base, id: 42, amount: 10 }],
      peers: [], band: null } as FeeResearch;
    expect(buildFeeResearchEvidence(wrong).derivations.some((item) => item.derivation.kind === "institution_value")).toBe(false);
    expect(buildFeeResearchEvidence({ ...wrong, current: 7.5 }).derivations[0]?.value).toBe(7.5);
  });

  it("rejects mismatched product, frequency, audience and document version", () => {
    const first = { ...research.ownRows[0], id: 51, feeName: "Checking fee",
      frequency: "monthly", feeAudience: "consumer" as const, sourceDocumentId: 401, amount: 5 };
    const second = { ...first, id: 52, amount: 10 };
    const variants = [
      { ...second, feeName: "Cashier's check" },
      { ...second, frequency: "per item" },
      { ...second, frequency: null },
      { ...second, sourceDocumentId: 402 },
      { ...second, feeAudience: "unknown" as const },
      { ...second, feeAudience: "business" as const },
      { ...second, sourceDocumentId: null },
    ];
    for (const variant of variants) {
      const mixed = { ...research, feeCategory: "monthly_maintenance", current: 7.5,
        ownRows: [first, variant], peers: [], band: null } as FeeResearch;
      expect(buildFeeResearchEvidence(mixed).derivations.some((item) => item.derivation.kind === "institution_value")).toBe(false);
    }
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

  it("does not consider an empty structured bundle proof of narrative accuracy", () => {
    const factEvidence: HamiltonEvidenceBundle = {
      version: 1,
      generatedAt: "2026-10-10T00:00:00Z",
      facts: [],
      derivations: [],
      limitations: [],
    };
    const response = { ...base, factEvidence };
    const normalized = normalizeLegacyAnalyzeConfidence(response);
    expect(normalized.confidence.level).toBe("medium");
    expect(normalized.confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
    expect(response.confidence.level).toBe("high");
  });

  it("also bounds a high label when a nonempty structured bundle exists", () => {
    const factEvidence: HamiltonEvidenceBundle = {
      version: 1,
      generatedAt: "2026-10-10T00:00:00Z",
      facts: [fact()],
      derivations: [],
      limitations: [],
    };
    const result = normalizeLegacyAnalyzeConfidence({ ...base, factEvidence });
    expect(result.confidence.level).toBe("medium");
    expect(result.confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
  });

  it("does not change an already-medium artifact", () => {
    const response = { ...base, confidence: { level: "medium" as const, basis: ["Already bounded"] } };
    expect(normalizeLegacyAnalyzeConfidence(response)).toBe(response);
  });
});
