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
  EVENT_FEE_CATEGORIES,
  chargedPerEvent,
  peerComparisonCoverage,
  readPeerCoverage,
} from "./evidence-contract";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
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

  it("requires the stated figure and audience to be the record's own (H06-AC1)", () => {
    const a = fact({ value: 10 });
    expect(claimBindingMatches(a, { institutionId: 1, value: 10, accountApplicability: "consumer" })).toBe(true);
    expect(claimBindingMatches(a, { institutionId: 1, value: 35 })).toBe(false);
    expect(claimBindingMatches(a, { institutionId: 1, value: 25 })).toBe(false);
    expect(claimBindingMatches(a, { institutionId: 1, accountApplicability: "business" })).toBe(false);
    expect(claimBindingMatches(fact({ value: null }), { institutionId: 1, value: 0 })).toBe(false);
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

  it("rejects cross-bank dollar differences for different products even in one category", () => {
    const a = fact({ id: "a", value: 25 });
    const b = fact({ id: "b", value: 35, scope: { ...a.scope, institutionId: 2, product: "Different overdraft" } });
    expect(deriveDifference("bad", b, a).problems).toContain("product_mismatch");
    expect(deriveDifference("bad", b, a).fact).toBeNull();
  });

  it("rejects mismatched or missing frequency and unknown/business account scope", () => {
    const a = fact({ id: "a" });
    const variants: Array<[HamiltonEvidenceFact, string]> = [
      [fact({ frequency: "monthly" }), "fee_frequency_mismatch"],
      [fact({ scope: { ...a.scope, accountApplicability: "business" } }), "consumer_audience_unverified"],
      [fact({ scope: { ...a.scope, accountApplicability: "unknown" } }), "consumer_audience_unverified"],
    ];
    for (const [other, reason] of variants) expect(deriveDifference("bad", a, other).problems).toContain(reason);
    // A recurring fee with no stated frequency is still not compared (#1717).
    const monthlyScope = { ...a.scope, feeCategory: "monthly_maintenance", product: "Checking" };
    expect(deriveDifference("bad", fact({ id: "m", scope: monthlyScope, frequency: "monthly" }), fact({ scope: monthlyScope, frequency: null })).problems)
      .toEqual(["fee_frequency_unknown"]);
    // So is a category not on the event list.
    const unlisted = { ...a.scope, feeCategory: "safe_deposit_box", product: "Box" };
    expect(deriveDifference("bad", fact({ id: "s", scope: unlisted }), fact({ scope: unlisted, frequency: null })).problems).toEqual(["fee_frequency_unknown"]);
  });

  it("counts an event fee with no stated frequency as per item (#1717)", () => {
    const a = fact({ id: "a" });
    expect(deriveDifference("ok", a, fact({ frequency: null, value: 35 })).fact?.value).toBe(-25);
    expect(deriveDifference("ok", fact({ id: "a", frequency: null }), fact({ frequency: null, value: 35 })).fact?.value).toBe(-25);
    expect(deriveDifference("ok", fact({ id: "a", frequency: "per_item" }), fact({ frequency: null, value: 35 })).problems).toEqual([]);
    expect(deriveDifference("bad", fact({ id: "a", frequency: "monthly" }), fact({ frequency: null })).problems).toEqual(["fee_frequency_mismatch"]);
    expect(deriveDifference("ok", fact({ id: "a", frequency: "Per-Transaction" }), fact({ frequency: null, value: 35 })).problems).toEqual([]);
  });

  it("compares two stated frequencies by meaning, not spelling (#1975)", () => {
    // Underscores, hyphens, extra spaces and case are spelling, not a different frequency.
    for (const [left, right] of [
      ["per_item", "per item"],
      ["Per Item", "per-item"],
      ["  per   item ", "PER_ITEM"],
      ["per_transaction", "per transaction"],
      ["Monthly", "monthly "],
    ]) {
      const result = deriveDifference("ok", fact({ id: "a", frequency: left }), fact({ frequency: right, value: 35 }));
      expect(result.problems, `${left} vs ${right}`).toEqual([]);
      expect(result.fact?.value).toBe(-25);
    }
    // Different words are still different frequencies.
    for (const [left, right] of [
      ["monthly", "per item"],
      ["per_item", "per_transaction"],
      ["per item", "per month"],
      ["annual", "monthly"],
    ]) {
      expect(deriveDifference("bad", fact({ id: "a", frequency: left }), fact({ frequency: right })).problems, `${left} vs ${right}`)
        .toEqual(["fee_frequency_mismatch"]);
    }
  });

  it("lists only event categories the taxonomy knows, and no recurring one", () => {
    for (const category of EVENT_FEE_CATEGORIES) expect(CANONICAL_KEY_MAP[category], category).toBe(category);
    for (const recurring of ["monthly_maintenance", "minimum_balance", "dormant_account", "paper_statement", "continuous_od", "safe_deposit_box", "ira_administration"]) {
      expect(chargedPerEvent(recurring)).toBe(false);
    }
    for (const event of ["overdraft", "nsf", "wire_domestic_outgoing", "wire_domestic_incoming", "wire_intl_outgoing", "wire_intl_incoming", "stop_payment", "deposited_item_return", "atm_non_network"]) {
      expect(chargedPerEvent(event)).toBe(true);
    }
    expect(chargedPerEvent(null)).toBe(false);
  });

  it("never binds or compares a fee from a discontinued account's table as the current fee", () => {
    const old = fact({ scope: { ...fact().scope, productStatus: "discontinued" } });
    expect(claimBindingMatches(old, { institutionId: 1, value: 10 })).toBe(false);
    expect(claimBindingMatches(old, { institutionId: 1, value: 10, productStatus: "current" })).toBe(false);
    expect(claimBindingMatches(old, { institutionId: 1, value: 10, productStatus: "discontinued" })).toBe(true);
    expect(claimBindingMatches(fact(), { institutionId: 1, value: 10, productStatus: "discontinued" })).toBe(false);
    expect(claimBindingMatches(fact({ scope: { ...fact().scope, productStatus: "current" } }), { institutionId: 1, value: 10 })).toBe(true);
    expect(deriveDifference("bad", fact({ id: "a" }), old).problems).toEqual(["product_discontinued"]);
  });

  it("counts the peers a comparison leaves out, by reason, and never reads 0 left out", () => {
    const own = fact({ id: "own" });
    const peer = (id: number, overrides: Partial<HamiltonEvidenceFact> = {}) => fact({ id: `p${id}`, scope: { ...fact().scope, institutionId: 10 + id }, ...overrides });
    const coverage = peerComparisonCoverage(own, [
      peer(1), peer(2, { status: "provisional" }), peer(3, { status: "provisional" }),
      peer(4, { scope: { ...fact().scope, institutionId: 14, accountApplicability: "unknown" } }),
      peer(5, { scope: { ...fact().scope, institutionId: 15, reportingDate: "2024-06-30" } }),
    ]);
    expect(coverage).toEqual({ context: "peer_comparison", total: 5, leftOut: 4, byReason: { not_verified: 2, audience_unknown: 1, not_comparable: 1 } });
    expect(readPeerCoverage(coverage)).toBe("4 of 5 peers left out: 2 not yet verified, 1 audience unknown, 1 not the same fee, unit or date.");
    expect(peerComparisonCoverage(own, [peer(1), peer(2, { frequency: null })])).toBeNull();
    expect(readPeerCoverage({ context: "peer_comparison", total: 14, leftOut: 0, byReason: {} })).toBeNull();
    expect(readPeerCoverage(null)).toBeNull();
    expect(readPeerCoverage({ context: "peer_comparison", total: 1, leftOut: 1, byReason: { frequency_unknown: 1 } })).toBe("1 of 1 peer left out: no stated frequency.");
    // The bank's own fee not comparable is the bank's problem, not the peers'.
    expect(peerComparisonCoverage(fact({ id: "own", status: "provisional" }), [peer(1)])).toBeNull();
  });

  it("rejects missing published row lineage and provisional observations", () => {
    const a = fact();
    const variants = [
      fact({ source: { ...a.source, recordId: null } }),
      fact({ source: { ...a.source, sourceDocumentIds: [] } }),
      fact({ status: "provisional" }),
    ];
    for (const other of variants) expect(deriveDifference("bad", a, other).problems).toContain("source_record_unverified");
  });

  it("rejects NaN, infinity, and negative fees while keeping a real zero", () => {
    const a = fact({ value: 25 });
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(deriveDifference("bad", a, fact({ value })).problems).toContain("non_numeric_value");
    }
    expect(deriveDifference("bad", a, fact({ value: -5 })).problems).toContain("invalid_fee_amount");
    expect(deriveDifference("valid-zero", a, fact({ value: 0 })).fact?.value).toBe(25);
  });

  it("rejects nesting a source-less derived delta as an observed fee", () => {
    const a = fact({ value: 25 });
    const b = fact({ value: 35, scope: { ...a.scope, institutionId: 2 } });
    const delta = deriveDifference("delta", b, a).fact;
    expect(delta).not.toBeNull();
    expect(deriveDifference("nested", a, delta!).problems).toContain("untraceable_derivation_input");
  });

  it("rejects audience and charge-basis mismatches in a dated percent change", () => {
    const current = fact({ value: 25 });
    const previous = fact({ value: 20, scope: { ...current.scope, reportingDate: "2025-06-30" } });
    expect(derivePercentChange("bad", current, { ...previous, frequency: "monthly" }).problems).toContain("fee_frequency_mismatch");
    expect(derivePercentChange("bad", current, { ...previous,
      scope: { ...previous.scope, accountApplicability: "unknown" } }).problems).toContain("consumer_audience_unverified");
    expect(derivePercentChange("valid", current, previous).fact?.value).toBe(25);
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
