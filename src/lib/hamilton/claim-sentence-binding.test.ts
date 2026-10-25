import { describe, expect, it } from "vitest";
import { filingFactId } from "./claim-evidence";
import {
  claimBindingMatches,
  HAMILTON_EVIDENCE_CONTRACT_VERSION,
  type HamiltonDerivedFact,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
  type HamiltonPeriodBasis,
} from "./evidence-contract";
import { bindNarrative, FILING_CONTRADICTED_LIMITATION } from "./narrative-bound";
import { readNarrativeBinding } from "./written-answer-binding";

// Synthetic institutions only: Bank A 9001, Bank B 9002 (evidence-regression-set.ts).
const BANK_A = 9001;
const BANK_B = 9002;
const names = new Map([[BANK_A, "Bank A"], [BANK_B, "Bank B"]]);

function filing(institutionId: number, reportDate: string, metric: string, basis: HamiltonPeriodBasis, value: number, change: Partial<HamiltonEvidenceFact["source"]> = {}): HamiltonEvidenceFact {
  const id = filingFactId("fdic", institutionId, reportDate, metric, basis);
  return {
    id, kind: "observed",
    scope: { institutionId, feeCategory: null, product: null, reportingDate: reportDate, effectiveDate: null, accountApplicability: "unknown", metric, periodBasis: basis, cohortKey: null },
    value, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
    source: { label: "FDIC call report", table: "institution_financial_records", recordId: null, recordKey: id, evidenceClass: "filing", sourceDocumentIds: [], urls: [], asOf: reportDate, verificationEventId: null, ...change },
  };
}

function quarter(current: HamiltonEvidenceFact, prior: HamiltonEvidenceFact, value: number, kind: HamiltonDerivedFact["derivation"]["kind"] = "ytd_to_quarter"): HamiltonDerivedFact {
  return {
    id: `derived:${current.id}`, kind: "derived",
    scope: { ...current.scope, periodBasis: "standalone_quarter" },
    value, unit: "usd", currency: "USD", status: "derived",
    derivation: { kind, inputFactIds: [current.id, prior.id], denominatorFactId: null, formula: "current - prior", rounding: "none" },
  };
}

const bundle = (facts: HamiltonEvidenceFact[], derivations: HamiltonDerivedFact[] = []): HamiltonEvidenceBundle =>
  ({ version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts, derivations, limitations: [] });

const A_Q2 = filing(BANK_A, "2026-06-30", "service_charge_income", "standalone_quarter", 1_100_000);
const B_Q2 = filing(BANK_B, "2026-06-30", "service_charge_income", "standalone_quarter", 2_300_000);
const A_YTD_Q1 = filing(BANK_A, "2026-03-31", "service_charge_income", "ytd", 1_200_000);
const A_YTD_Q2 = filing(BANK_A, "2026-06-30", "service_charge_income", "ytd", 2_600_000);
const bind = (text: string, evidence: HamiltonEvidenceBundle, extra: { accountInstitutionId?: number; researchInstitutionId?: number } = {}) =>
  bindNarrative({ text, evidence, names, ...extra });
const reasons = (binding: ReturnType<typeof bind>) => binding.omitted.map((o) => o.reason);

describe("filing figures bind to the institution, metric, quarter and basis the sentence states (#1077 step 2)", () => {
  it("supports a bank's own filed figure and leaves out another bank's", () => {
    const evidence = bundle([A_Q2, B_Q2]);
    expect(bind("Bank A's service charge income was $1.1 million in Q2 2026.", evidence).supported[0].factIds).toEqual([A_Q2.id]);
    const swapped = bind("Bank A's service charge income was $2.3 million in Q2 2026.", evidence);
    expect(reasons(swapped)).toEqual(["wrong_institution"]);
    expect(swapped.limitations).toContain(FILING_CONTRADICTED_LIMITATION);
  });

  it("leaves out another quarter's figure and a year-to-date total stated as a quarter", () => {
    const evidence = bundle([A_YTD_Q1, A_YTD_Q2], [quarter(A_YTD_Q2, A_YTD_Q1, 1_400_000)]);
    expect(reasons(bind("Bank A earned $1.2 million in fee income in Q2 2026.", evidence))).toEqual(["wrong_period"]);
    expect(reasons(bind("Bank A's fee income in the second quarter of 2026 was $2.6 million.", evidence))).toEqual(["wrong_basis"]);
    expect(bind("Bank A's year-to-date fee income through June 30, 2026 was $2.6 million.", evidence).supported).toHaveLength(1);
    expect(bind("Bank A earned $1.4 million in fee income in Q2 2026.", evidence).supported[0].factIds).toEqual([`derived:${A_YTD_Q2.id}`, A_YTD_Q2.id, A_YTD_Q1.id]);
    // A first quarter's year-to-date total is that quarter.
    expect(bind("Bank A earned $1.2 million in fee income in Q1 2026.", evidence).supported).toHaveLength(1);
  });

  it("reads each figure's period and basis from its own clause (PR #2571 review)", () => {
    const evidence = bundle([A_YTD_Q1, A_YTD_Q2, filing(BANK_A, "2025-06-30", "service_charge_income", "standalone_quarter", 1_000_000)],
      [quarter(A_YTD_Q2, A_YTD_Q1, 1_400_000)]);
    const supported = (text: string) => {
      const binding = bind(text, evidence);
      expect(binding.omitted, text).toEqual([]);
      expect(binding.supported, text).toHaveLength(1);
      return binding.supported[0].factIds;
    };
    expect(supported("Bank A's fee income was $1.4 million in Q2 2026 and $2.6 million year to date.")).toContain(A_YTD_Q2.id);
    expect(supported("Bank A's fee income was $2.6 million year to date and $1.4 million in Q2 2026.")).toContain(`derived:${A_YTD_Q2.id}`);
    expect(supported("Bank A's fee income was $1.4 million in Q2 2026, up from $1.2 million in the prior quarter.")).toContain(A_YTD_Q1.id);
    expect(supported("Bank A's fee income was $1.4 million in Q2 2026, against $1.0 million a year earlier."))
      .toContain(filingFactId("fdic", BANK_A, "2025-06-30", "service_charge_income", "standalone_quarter"));
    expect(supported("Bank A earned $1.4 million in fee income in 2Q26.")).toContain(`derived:${A_YTD_Q2.id}`);
    // A relative period with no quarter to count from binds nothing.
    expect(bind("Bank A's fee income was $1.2 million in the prior quarter.", evidence).interpretation).toHaveLength(1);
    // The mixed-basis fix does not let a year-to-date total pass as the quarter it names.
    expect(reasons(bind("Bank A's fee income was $2.6 million in Q2 2026 and $1.2 million in Q1 2026.", evidence))).toEqual(["wrong_basis"]);
  });

  it("reads only second person as the reader's own institution, never \"our\", \"we\" or \"US\" (PR #2571 review)", () => {
    const evidence = bundle([A_Q2, B_Q2]);
    const research = { researchInstitutionId: BANK_A, accountInstitutionId: BANK_B };
    expect(bind("Based on our data, service charge income was $1.1 million in Q2 2026.", evidence, research).supported[0].factIds).toEqual([A_Q2.id]);
    expect(bind("Bank A's service charge income was $1.1 million in Q2 2026, among the highest of US banks.", evidence, research).supported[0].factIds).toEqual([A_Q2.id]);
    expect(bind("We read service charge income of $1.1 million in Q2 2026.", evidence, research).supported[0].factIds).toEqual([A_Q2.id]);
  });

  it("binds only where the sentence names the figure's metric", () => {
    const evidence = bundle([A_Q2]);
    expect(bind("Bank A's overdraft revenue was $1.1 million in Q2 2026.", evidence).interpretation).toHaveLength(1);
    expect(bind("Bank A reported $1.1 million in Q2 2026.", evidence).interpretation).toHaveLength(1);
  });

  it("reads \"your\" as the reader's own institution, and binds nothing to it when that is unknown", () => {
    const evidence = bundle([A_Q2, B_Q2]);
    expect(reasons(bind("Your service charge income was $2.3 million in Q2 2026.", evidence, { accountInstitutionId: BANK_A }))).toEqual(["account_as_subject"]);
    expect(bind("Your service charge income was $1.1 million in Q2 2026.", evidence, { accountInstitutionId: BANK_A }).supported[0].factIds).toEqual([A_Q2.id]);
    expect(bind("Your service charge income was $2.3 million in Q2 2026.", evidence).interpretation).toHaveLength(1);
    // A sentence naming nobody is about the research subject, and binds nothing when there is none.
    expect(reasons(bind("Service charge income was $2.3 million in Q2 2026.", evidence, { researchInstitutionId: BANK_A }))).toEqual(["wrong_institution"]);
    expect(bind("Service charge income was $2.3 million in Q2 2026.", evidence).interpretation).toHaveLength(1);
  });

  it("never treats a filing with no natural key, or another evidence class, as a record", () => {
    const keyless = filing(BANK_A, "2026-06-30", "service_charge_income", "standalone_quarter", 1_100_000, { recordKey: null });
    expect(bind("Bank A's service charge income was $1.1 million in Q2 2026.", bundle([keyless])).interpretation).toHaveLength(1);
    const statistic = filing(BANK_A, "2026-06-30", "service_charge_income", "standalone_quarter", 1_100_000, { evidenceClass: "index_statistic" });
    expect(bind("Bank A's service charge income was $1.1 million in Q2 2026.", bundle([statistic])).supported).toHaveLength(0);
  });
});

describe("derivationHolds recomputes ytd_to_quarter and ratio and passes no unknown kind (#1077 step 2)", () => {
  const sentence = "Bank A earned $1.4 million in fee income in Q2 2026.";
  it("drops a quarter that does not recompute, or whose inputs are not this quarter and the prior one", () => {
    expect(bind(sentence, bundle([A_YTD_Q1, A_YTD_Q2], [quarter(A_YTD_Q2, A_YTD_Q1, 1_400_000)])).supported).toHaveLength(1);
    expect(bind(sentence, bundle([A_YTD_Q1, A_YTD_Q2], [{ ...quarter(A_YTD_Q2, A_YTD_Q1, 1_400_000), value: 1_400_000 + 1 }])).supported).toHaveLength(0);
    const swappedInputs = quarter(A_YTD_Q2, A_YTD_Q1, 1_400_000);
    swappedInputs.derivation.inputFactIds.reverse();
    expect(bind(sentence, bundle([A_YTD_Q1, A_YTD_Q2], [swappedInputs])).supported).toHaveLength(0);
  });

  it("recomputes a ratio and never lets a kind it does not know hold", () => {
    const income = filing(BANK_A, "2026-06-30", "service_charge_income", "ytd", 260);
    const revenue = filing(BANK_A, "2026-06-30", "total_revenue", "ytd", 2_600);
    const ratio = (value: number): HamiltonDerivedFact => ({
      id: "ratio:a", kind: "derived", scope: { ...income.scope, metric: "fee_income_ratio" }, value, unit: "percent", currency: null, status: "derived",
      derivation: { kind: "ratio", inputFactIds: [income.id, revenue.id], denominatorFactId: revenue.id, formula: "income / revenue", rounding: "none" },
    });
    const text = "Bank A's fee income ratio was 10% in Q2 2026 year to date.";
    expect(bind(text, bundle([income, revenue], [ratio(10)])).supported[0].factIds).toContain("ratio:a");
    expect(bind(text, bundle([income, revenue], [ratio(10.5)])).supported).toHaveLength(0);
    const unknown = { ...ratio(10), derivation: { ...ratio(10).derivation, kind: "made_up" as never } };
    expect(bind(text, bundle([income, revenue], [unknown])).supported).toHaveLength(0);
  });
});

describe("the claim binding's new fields", () => {
  it("matches metric, period basis and cohort only when the claim states them", () => {
    expect(claimBindingMatches(A_Q2, { metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey: null })).toBe(true);
    expect(claimBindingMatches(A_Q2, { metric: "total_assets" })).toBe(false);
    expect(claimBindingMatches(A_Q2, { periodBasis: "ytd" })).toBe(false);
    expect(claimBindingMatches(A_Q2, { cohortKey: "filed_peers:fdic:2026-06-30:00000000" })).toBe(false);
    expect(claimBindingMatches(A_Q2, {})).toBe(true);
  });

  it("reads back a saved binding with the new omit reasons", () => {
    const binding = bind("Bank A's fee income in the second quarter of 2026 was $2.6 million. Your service charge income was $2.3 million in Q2 2026.",
      bundle([A_YTD_Q1, A_YTD_Q2, B_Q2]), { accountInstitutionId: BANK_A });
    expect(reasons(binding)).toEqual(["wrong_basis", "account_as_subject"]);
    expect(readNarrativeBinding(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
  });
});
