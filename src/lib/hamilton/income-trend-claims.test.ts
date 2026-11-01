/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures mutate a tool output shape */
import { describe, expect, it } from "vitest";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import { financialRecordValue } from "@/lib/data-store/filing-reread";
import { supportedFilingClaims } from "./answer-correctness";
import { claimEvidenceFacts, filingFactId } from "./claim-evidence";
import { writtenAnswerBinding } from "./answer-save";
import type { AnswerToolEvidence } from "./written-answer-evidence";

// Synthetic institutions only: Bank A 9001 and Bank B 9002 (evidence-regression-set.ts).
const BANK_A = 9001;
const BANK_B = 9002;
const ENDS = ["03-31", "06-30", "09-30", "12-31"];
const end = (quarter: string) => `${quarter.slice(0, 4)}-${ENDS[Number(quarter.slice(6)) - 1]}`;

/**
 * A bank's getInstitution read in the shape research/tools.ts returns: FDIC standalone quarters
 * (thousands) as financial records and as the revenue trend, with the trend's year-over-year
 * change computed as getInstitutionRevenueTrend computes it (the same quarter one year earlier).
 */
function bankRead(id: number, quarters: Record<string, number>, change: (output: Record<string, any>) => void = () => {}): AnswerToolEvidence {
  const rows = Object.entries(quarters).sort(([a], [b]) => b.localeCompare(a));
  const records = rows.map(([quarter, income]) => ({ institution_id: id, report_date: end(quarter), source: "fdic", service_charge_income: income,
    total_assets: 900_000, total_deposits: 780_000, total_revenue: null, fee_income_ratio: null, field_units: { fee_income_ratio: "fraction" } }));
  const output: Record<string, any> = {
    identity: { id, name: id === BANK_A ? "Bank A" : "Bank B", charter_type: "bank" },
    fees: { verified: [], provisional: [] },
    financials: { units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
      definition: { ...financialMeasureDefinition("fdic"), period_basis: "standalone_quarter" }, latest: records[0] ?? null, records },
    revenue_trend: rows.map(([quarter, income], index) => {
      const prior = rows.find(([other], at) => at > index && other === `${Number(quarter.slice(0, 4)) - 1}${quarter.slice(4)}`);
      return { quarter, service_charge_income: income, fee_income_ratio: null,
        yoy_change_pct: prior ? Math.round(((income - prior[1]) / prior[1]) * 1000) / 10 : null,
        source: "fdic", units: "thousands of dollars", field_units: { fee_income_ratio: "fraction", yoy_change_pct: "percent" } };
    }),
    revenue_trend_definition: { ...financialMeasureDefinition("fdic"), ratio_definition: "Quarterly deposit-account service charges divided by quarterly total revenue", ratio_period_basis: "standalone_quarter" },
  };
  change(output);
  return { toolName: "getInstitution", input: { id }, output };
}

/** Bank A: $1.5 million in Q2 2025 to $1.437 million in Q2 2026, a 4.2% fall; Q1 2026 $1.46 million (QoQ -1.6%). */
const A_TREND = { "2026-Q2": 1437, "2026-Q1": 1460, "2025-Q4": 1480, "2025-Q3": 1490, "2025-Q2": 1500 };
const quarter = (id: number, date: string, source: "fdic" | "ncua" = "fdic") => filingFactId(source, id, date, "service_charge_income", "standalone_quarter");
const YOY = `change:fdic:${BANK_A}:2026-06-30:service_charge_income:standalone_quarter:year_over_year`;
const QOQ = `change:fdic:${BANK_A}:2026-06-30:service_charge_income:standalone_quarter:quarter_over_quarter`;

describe("the profile's revenue trend as claim facts (#1077, Cycle A defect 10)", () => {
  it("makes each trend quarter a filing fact of the subject, keyed as its filed standalone quarter", () => {
    const evidence = claimEvidenceFacts([bankRead(BANK_A, A_TREND)], BANK_A);
    const facts = new Map(evidence.facts.map((fact) => [fact.id, fact]));
    for (const [q, income] of Object.entries(A_TREND)) {
      expect(facts.get(quarter(BANK_A, end(q))), q).toMatchObject({ value: income * 1000, unit: "usd",
        scope: { institutionId: BANK_A, reportingDate: end(q), metric: "service_charge_income", periodBasis: "standalone_quarter" },
        source: { evidenceClass: "filing", table: "institution_financial_records", recordKey: quarter(BANK_A, end(q)) } });
    }
    // The trend's row and the financial record for one quarter are one fact, never two.
    expect(evidence.facts.filter((fact) => fact.id === quarter(BANK_A, "2026-06-30"))).toHaveLength(1);
    // The tool's own percent is never a fact: no observed fact is a percent.
    expect(evidence.facts.filter((fact) => fact.unit === "percent")).toEqual([]);
  });

  it("derives the four-quarter and prior-quarter changes from two filed quarters, naming both", () => {
    const derivations = new Map(claimEvidenceFacts([bankRead(BANK_A, A_TREND)], BANK_A).derivations.map((d) => [d.id, d]));
    expect(derivations.get(YOY)).toMatchObject({ value: -4.2, unit: "percent",
      scope: { institutionId: BANK_A, reportingDate: "2026-06-30", metric: "service_charge_income", periodBasis: "standalone_quarter" },
      derivation: { kind: "percent_change", inputFactIds: [quarter(BANK_A, "2026-06-30"), quarter(BANK_A, "2025-06-30")],
        denominatorFactId: quarter(BANK_A, "2025-06-30"), formula: "(current - prior) / prior * 100" } });
    expect(derivations.get(QOQ)).toMatchObject({ value: -1.6, derivation: { inputFactIds: [quarter(BANK_A, "2026-06-30"), quarter(BANK_A, "2026-03-31")] } });
  });

  it("gives no year-over-year change across a missing filing quarter", () => {
    const gap = { "2026-Q2": 1365, "2026-Q1": 1400, "2025-Q4": 1450, "2025-Q3": 1480, "2025-Q1": 1490, "2024-Q2": 1500 };
    const evidence = claimEvidenceFacts([bankRead(BANK_A, gap)], BANK_A);
    const yoy = evidence.derivations.filter((d) => d.id.endsWith(":year_over_year")).map((d) => [d.scope.reportingDate, d.value]);
    expect(yoy).toEqual([["2026-03-31", -6]]);
  });

  it("gives no fact for a trend row with no unit of its own, a definition that is not the source's, or another bank's profile", () => {
    const noUnit = bankRead(BANK_A, A_TREND, (o) => { delete o.revenue_trend[0].units; delete o.financials.records; o.financials.latest = null; });
    expect(claimEvidenceFacts([noUnit], BANK_A).facts.map((f) => f.id)).not.toContain(quarter(BANK_A, "2026-06-30"));
    const ytdTrend = bankRead(BANK_A, A_TREND, (o) => { o.revenue_trend_definition.period_basis = "year_to_date"; delete o.financials.records; });
    expect(claimEvidenceFacts([ytdTrend], BANK_A).facts).toEqual([]);
    const publisher = bankRead(BANK_A, A_TREND, (o) => { o.revenue_trend_definition.publisher = "A spreadsheet"; delete o.financials.records; });
    expect(claimEvidenceFacts([publisher], BANK_A).facts).toEqual([]);
    const swapped = { ...bankRead(BANK_B, A_TREND), input: { id: BANK_A } };
    expect(claimEvidenceFacts([swapped], BANK_A).facts).toEqual([]);
  });

  it("drops a credit union's trend quarter that is not its year-to-date filings' difference, and every change from it", () => {
    const ncua = (q2: number): AnswerToolEvidence => ({
      toolName: "getInstitution", input: { id: BANK_A },
      output: {
        identity: { id: BANK_A, name: "Bank A", charter_type: "credit_union" }, fees: { verified: [], provisional: [] },
        financials: { units: "dollar amounts in thousands", definition: { ...financialMeasureDefinition("ncua"), period_basis: "year_to_date" },
          latest: null, records: [["2026-06-30", 2600], ["2026-03-31", 1200]].map(([report_date, income]) => ({ institution_id: BANK_A, report_date, source: "ncua",
            service_charge_income: income, field_units: { fee_income_ratio: "fraction" } })) },
        revenue_trend: [["2026-Q2", q2], ["2026-Q1", 1200]].map(([q, income]) => ({ quarter: q, service_charge_income: income, source: "ncua", units: "thousands of dollars" })),
        revenue_trend_definition: { ...financialMeasureDefinition("ncua") },
      },
    });
    const agrees = claimEvidenceFacts([ncua(1400)], BANK_A);
    expect(agrees.facts.find((f) => f.id === quarter(BANK_A, "2026-06-30", "ncua"))?.value).toBe(1_400_000);
    expect(agrees.derivations.map((d) => d.id)).toContain(`change:ncua:${BANK_A}:2026-06-30:service_charge_income:standalone_quarter:quarter_over_quarter`);
    const disagrees = claimEvidenceFacts([ncua(1500)], BANK_A);
    expect(disagrees.facts.map((f) => f.id)).not.toContain(quarter(BANK_A, "2026-06-30", "ncua"));
    expect(disagrees.derivations.filter((d) => d.derivation.kind === "percent_change")).toEqual([]);
  });
});

describe("a sentence stating the change binds for the right bank, span and quarter only", () => {
  const reads = [bankRead(BANK_A, A_TREND), bankRead(BANK_B, { "2026-Q2": 2300 })];
  const bind = (text: string, institutionId = BANK_A) => writtenAnswerBinding(text, reads.map((r) => r.output), undefined, { toolResults: reads, institutionId })!;
  const outcome = (text: string) => {
    const binding = bind(text);
    return binding.supported.length === 1 && binding.supported[0].factIds.length > 0 ? binding.supported[0].factIds[0]
      : binding.omitted[0]?.reason ?? (binding.interpretation.length ? "interpretation" : "supported without a fact");
  };

  it("supports the change for its institution, span and quarter, citing the change and both filings", () => {
    expect(outcome("Service-charge income fell 4.2% over four quarters.")).toBe(YOY);
    expect(outcome("Bank A's service charge income fell 4.2% from Q2 2025 to Q2 2026.")).toBe(YOY);
    expect(outcome("Bank A's service charge income fell 4.2% in Q2 2026 from a year earlier.")).toBe(YOY);
    expect(outcome("Bank A's service charge income fell 1.6% from the prior quarter.")).toBe(QOQ);
    expect(bind("Service-charge income fell 4.2% over four quarters.").supported[0].factIds.sort())
      .toEqual([YOY, quarter(BANK_A, "2025-06-30"), quarter(BANK_A, "2026-06-30")].sort());
  });

  it("rejects the wrong bank, period, span or direction", () => {
    expect(outcome("Bank B's service charge income fell 4.2% over four quarters.")).toBe("wrong_institution");
    expect(outcome("Bank A's service charge income fell 4.2% from Q1 2025 to Q1 2026.")).toBe("wrong_period");
    expect(outcome("Bank A's service charge income fell 4.2% from the prior quarter.")).toBe("wrong_period");
    // Q1 2026's own change (-1.4%) stated with no quarter is read as the latest quarter's, which is -1.6%.
    expect(outcome("Bank A's service charge income fell 1.4% from the prior quarter.")).toBe("wrong_period");
    expect(outcome("Bank A's service charge income rose 4.2% over four quarters.")).toBe("wrong_direction");
    expect(outcome("Bank A's year-to-date service charge income fell 4.2% from a year earlier.")).toBe("wrong_basis");
  });

  it("binds nothing when the sentence states no span or names no fee-income metric", () => {
    expect(outcome("Bank A's service charge income fell 4.2%.")).toBe("interpretation");
    expect(outcome("Bank A's deposits fell 4.2% over four quarters.")).toBe("interpretation");
  });

  it("re-reads both input filings live, with the keys the filing re-read takes", () => {
    const evidence = claimEvidenceFacts(reads, BANK_A);
    const claims = supportedFilingClaims(bind("Service-charge income fell 4.2% over four quarters."), evidence);
    expect(claims.map((c) => [c.key.id, c.key.basis, c.key.table, c.value])).toEqual([
      [quarter(BANK_A, "2026-06-30"), "standalone_quarter", "institution_financial_records", 1_437_000],
      [quarter(BANK_A, "2025-06-30"), "standalone_quarter", "institution_financial_records", 1_500_000],
    ]);
    const live = [{ institution_id: BANK_A, report_date: "2025-06-30", source: "fdic", service_charge_income: 1500 }];
    expect(financialRecordValue(claims[1].key, live)).toBe(1_500_000);
  });
});
