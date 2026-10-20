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

  it("recalculates a peer median whose inputs spell the same frequency differently (#1975)", () => {
    const peer = (id: number, value: number, frequency: string | null) => ({
      ...originalFact,
      id: `fee:published:${id}`,
      value,
      frequency,
      scope: { ...originalFact.scope, institutionId: id },
      source: { ...originalFact.source, recordId: id },
    });
    const peers = [peer(30001, 29, "per item"), peer(30002, 30, "Per_Item"), peer(30003, 31, " per-item ")];
    const median: HamiltonDerivedFact = {
      id: "derived:peer-median:overdraft",
      kind: "derived",
      scope: { ...originalFact.scope, institutionId: null },
      value: 30,
      unit: "usd",
      currency: "USD",
      status: "derived",
      derivation: {
        kind: "peer_median",
        inputFactIds: peers.map((row) => row.id),
        denominatorFactId: null,
        formula: "median",
        rounding: "stored",
      },
    };
    const input = saved(originalFact, [median]);
    input.factEvidence!.facts = peers;
    expect(savedEvidenceAppendix(input).derivations[0].problems).not.toContain("input_frequency_mismatch");
    input.factEvidence!.facts = [peers[0], peers[1], peer(30003, 31, "monthly")];
    expect(savedEvidenceAppendix(input).derivations[0].problems).toContain("input_frequency_mismatch");
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
  it("marks unverified observations, unknown values and numeric text as incomplete, preserving true zero", () => {
    const nonPublished = { ...originalFact, status: "provisional" as const };
    const unknown = { ...originalFact, value: null };
    const textual = { ...originalFact, value: "0" };
    expect(savedEvidenceAppendix(saved(nonPublished)).facts[0].problems).toContain("unverified_observation_status");
    expect(savedEvidenceAppendix(saved(unknown)).facts[0].problems).toContain("unknown_observed_value");
    expect(savedEvidenceAppendix(saved(textual)).facts[0].problems).toContain("non_numeric_observed_value");
    expect(savedEvidenceAppendix(saved(originalFact)).facts[0].problems).toEqual([]);
    expect(savedEvidenceAppendix(saved(originalFact)).facts[0].value).toBe(0);
  });

  it("does not certify an own aggregate using another institution or category record ID", () => {
    const alien = {
      ...originalFact,
      id: "fee:published:20002",
      scope: { ...originalFact.scope, institutionId: 9201, feeCategory: "nsf" },
      source: { ...originalFact.source, recordId: 20002 },
    };
    const derived: HamiltonDerivedFact = {
      id: "derived:current:8109:overdraft",
      kind: "derived",
      scope: { ...originalFact.scope },
      value: 0,
      unit: "usd",
      currency: "USD",
      status: "derived",
      derivation: {
        kind: "institution_value",
        inputFactIds: [alien.id],
        denominatorFactId: null,
        formula: "highest published tier",
        rounding: "stored",
      },
    };
    const appendix = savedEvidenceAppendix(saved(alien, [derived]));
    expect(appendix.derivations[0].problems).toEqual(expect.arrayContaining([
      "input_fee_category_mismatch", "input_institution_mismatch",
    ]));
    expect(appendix.narrativeClaimsVerified).toBe(false);
  });

  it("rejects a dollar difference backed by a percentage observation and an undated comparison", () => {
    const percent: HamiltonEvidenceFact = {
      ...originalFact,
      id: "fee:published:20003",
      unit: "percent",
      currency: null,
      value: 2,
      source: { ...originalFact.source, recordId: 20003 },
    };
    const derived: HamiltonDerivedFact = {
      id: "derived:diff:8109:overdraft",
      kind: "derived",
      scope: { ...originalFact.scope },
      value: 2,
      unit: "usd",
      currency: "USD",
      status: "derived",
      derivation: {
        kind: "difference",
        inputFactIds: [originalFact.id, percent.id],
        denominatorFactId: null,
        formula: "left - right",
        rounding: "cent",
      },
    };
    const input = saved();
    input.factEvidence!.facts.push(percent);
    input.factEvidence!.derivations.push(derived);
    const row = savedEvidenceAppendix(input).derivations[0];
    expect(row.problems).toEqual(expect.arrayContaining([
      "input_unit_mismatch", "input_currency_mismatch", "comparison_period_mismatch",
    ]));
  });

  it("requires chronological same-institution percent-change records and a linked denominator", () => {
    const older: HamiltonEvidenceFact = {
      ...originalFact,
      id: "fee:published:20004",
      value: 20,
      scope: { ...originalFact.scope, reportingDate: "2026-09-30", institutionId: 9201 },
      source: { ...originalFact.source, recordId: 20004 },
    };
    const newer: HamiltonEvidenceFact = {
      ...originalFact,
      value: 30,
      scope: { ...originalFact.scope, reportingDate: "2026-06-30" },
    };
    const derived: HamiltonDerivedFact = {
      id: "derived:percent-change",
      kind: "derived",
      scope: { ...originalFact.scope, reportingDate: "2026-06-30" },
      value: 50,
      unit: "percent",
      currency: null,
      status: "derived",
      derivation: {
        kind: "percent_change",
        inputFactIds: [newer.id, older.id],
        denominatorFactId: "fee:published:unknown",
        formula: "(current-prior)/prior*100",
        rounding: "one decimal",
      },
    };
    const input = saved(newer, [derived]);
    input.factEvidence!.facts.push(older);
    const row = savedEvidenceAppendix(input).derivations[0];
    expect(row.problems).toEqual(expect.arrayContaining([
      "input_institution_mismatch", "change_period_invalid", "missing_denominator", "denominator_not_input",
    ]));
  });

  it("flags source frequency conflicts even when both fee amounts and IDs are present", () => {
    const other: HamiltonEvidenceFact = {
      ...originalFact,
      id: "fee:published:20005",
      frequency: "monthly",
      source: { ...originalFact.source, recordId: 20005 },
    };
    const derived: HamiltonDerivedFact = {
      id: "derived:current:8109:overdraft",
      kind: "derived",
      scope: { ...originalFact.scope },
      value: 0,
      unit: "usd",
      currency: "USD",
      status: "derived",
      derivation: {
        kind: "institution_value",
        inputFactIds: [originalFact.id, other.id],
        denominatorFactId: null,
        formula: "max",
        rounding: "stored",
      },
    };
    const input = saved(originalFact, [derived]);
    input.factEvidence!.facts.push(other);
    expect(savedEvidenceAppendix(input).derivations[0].problems).toContain("input_frequency_mismatch");
  });

  // Arithmetic integrity is distinct from matching identifiers or source inspection.
  function arithmeticCase(
    kind: HamiltonDerivedFact["derivation"]["kind"],
    amounts: number[],
    derivedValue: number,
    formula: string,
    denominatorIndex: number | null = null,
  ) {
    const observations: HamiltonEvidenceFact[] = amounts.map((amount, index) => ({
      ...originalFact,
      id: `fee:published:${24001 + index}`,
      value: amount,
      scope: {
        ...originalFact.scope,
        reportingDate: kind === "percent_change" && index > 0 ? "2026-06-30" : "2026-09-30",
      },
      source: { ...originalFact.source, recordId: 24001 + index },
    }));
    const derivative: HamiltonDerivedFact = {
      id: "derived:synthetic-arithmetic",
      kind: "derived",
      scope: { ...observations[0].scope },
      value: derivedValue,
      unit: kind === "percent_change" ? "percent" : "usd",
      currency: kind === "percent_change" ? null : "USD",
      status: "derived",
      derivation: {
        kind,
        inputFactIds: observations.map((fact) => fact.id),
        denominatorFactId: kind === "percent_change"
          ? observations[denominatorIndex ?? 1]?.id ?? null : null,
        formula,
        rounding: kind === "percent_change" ? "one decimal percentage point" : "stored",
      },
    };
    const answer = saved(observations[0], [derivative]);
    answer.factEvidence!.facts = observations;
    return savedEvidenceAppendix(answer).derivations[0];
  }

  it("detects an inverted dollar delta although both source fact IDs resolve", () => {
    const correct = arithmeticCase("difference", [10, 35], -25, "left - right");
    const inverted = arithmeticCase("difference", [10, 35], 25, "left - right");
    expect(correct.problems).not.toContain("derived_value_mismatch");
    expect(inverted.problems).toContain("derived_value_mismatch");
  });

  it("rejects a claimed increase when chronological evidence calculates a decline", () => {
    const correct = arithmeticCase("percent_change", [90, 100], -10, "(current - prior) / prior * 100");
    const falseIncrease = arithmeticCase("percent_change", [90, 100], 10, "(current - prior) / prior * 100");
    expect(correct.problems).not.toContain("derived_value_mismatch");
    expect(falseIncrease.problems).toContain("derived_value_mismatch");
  });

  it("rejects percent-change zero denominator or wrong linked denominator", () => {
    expect(arithmeticCase("percent_change", [90, 0], -10, "(current - prior) / prior * 100").problems)
      .toContain("zero_denominator");
    expect(arithmeticCase("percent_change", [90, 100], -10, "(current - prior) / prior * 100", 0).problems)
      .toContain("wrong_percent_denominator");
  });

  it("detects wrong highest published tier and supports legitimate median arithmetic", () => {
    expect(arithmeticCase("institution_value", [10, 35], 10, "highest published tier for the institution").problems)
      .toContain("derived_value_mismatch");
    expect(arithmeticCase("institution_value", [10, 35], 35, "highest published tier for the institution").problems)
      .not.toContain("derived_value_mismatch");
    expect(arithmeticCase("institution_value", [10, 20, 30, 40], 25, "median of published institution amounts").problems)
      .not.toContain("derived_value_mismatch");
    expect(arithmeticCase("institution_value", [10, 20, 30, 40], 30, "median of published institution amounts").problems)
      .toContain("derived_value_mismatch");
  });

  it("withholds numeric integrity when a saved derivation advertises an unknown formula", () => {
    expect(arithmeticCase("difference", [10, 35], -25, "right - left").problems)
      .toContain("unrecognized_derivation_formula");
  });


  it("does not mislabel rates as dollar-denominated evidence or accept missing USD currency", () => {
    const rate: HamiltonEvidenceFact = { ...originalFact, value: 2.5, unit: "percent", currency: null };
    expect(savedEvidenceAppendix(saved(rate)).facts[0].problems).toEqual([]);
    expect(savedEvidenceAppendix(saved({ ...rate, currency: "USD" })).facts[0].problems)
      .toContain("currency_mismatch");
    expect(savedEvidenceAppendix(saved({ ...originalFact, currency: null })).facts[0].problems)
      .toContain("currency_mismatch");
  });

  it("keeps negative observed counts distinct from legitimate fee deltas", () => {
    const observedCount: HamiltonEvidenceFact = { ...originalFact, value: -1, unit: "count", currency: null };
    expect(savedEvidenceAppendix(saved(observedCount)).facts[0].problems).toContain("invalid_count");
    expect(savedEvidenceAppendix(saved({ ...observedCount, value: 0 })).facts[0].problems)
      .not.toContain("invalid_count");
  });

  it("rejects whitespace-only fee scope and frequency fields", () => {
    const incomplete: HamiltonEvidenceFact = {
      ...originalFact,
      scope: { ...originalFact.scope, feeCategory: "  ", product: "  " },
      frequency: " \t ",
    };
    expect(savedEvidenceAppendix(saved(incomplete)).facts[0].problems).toEqual(expect.arrayContaining([
      "unknown_fee_category", "unknown_product", "unknown_frequency",
    ]));
  });

  it("does not treat URL-looking invalid hosts or unsupported protocols as inspectable sources", () => {
    const invalid: HamiltonEvidenceFact = {
      ...originalFact,
      source: { ...originalFact.source, urls: ["https://", "ftp://fixture.invalid/fee"] },
    };
    expect(savedEvidenceAppendix(saved(invalid)).facts[0].problems).toContain("uninspectable_source_url");
    const valid = { ...invalid, source: { ...invalid.source, urls: ["https://fixture.invalid/fee"] } };
    expect(savedEvidenceAppendix(saved(valid)).facts[0].problems).not.toContain("uninspectable_source_url");
  });

  it("reopens a legacy saved source missing array fields without inventing provenance", () => {
    const malformed: HamiltonEvidenceFact = {
      ...originalFact,
      source: {
        ...originalFact.source,
        sourceDocumentIds: undefined as unknown as number[],
        urls: undefined as unknown as string[],
      },
    };
    const appendix = savedEvidenceAppendix(JSON.parse(JSON.stringify(saved(malformed))) as EvidenceBoundAnalyzeResponse);
    expect(appendix.facts[0].source.sourceDocumentIds).toEqual([]);
    expect(appendix.facts[0].source.urls).toEqual([]);
    expect(appendix.facts[0].problems).toEqual(expect.arrayContaining([
      "missing_source_document_id", "uninspectable_source_url",
    ]));
    expect(appendix.narrativeClaimsVerified).toBe(false);
  });

});
