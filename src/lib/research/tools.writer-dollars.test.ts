/**
 * #1077: call-report money is stored in thousands, and the written answer's tools hand it to the
 * writer in whole dollars, converted once (call-report-dollars.ts). The answer gate traces the
 * writer's figures against those same dollar values, so "$649,000" holds and "$649" does not.
 * No database: the readers are stubbed with an invented bank and credit union.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writtenAnswerCheck } from "@/lib/hamilton/answer-save";
import { checkNarrativeFigures } from "@/lib/hamilton/figure-check";
import { checkAnswerInterpretations } from "@/lib/hamilton/answer-interpretations";
import { profileQuarterCalculations } from "@/lib/hamilton/profile-quarter-evidence";
import { asFiledFinancialUnit, financialMeasureDefinition, financialPeerComparison, restatedInDollars } from "@/lib/data-store/financial-peer-contract";
import { buildFinancialIncomeGroup, financialIncomeGroupInDollars } from "@/lib/report-assemblers/financial-income";

const readers = vi.hoisted(() => ({
  charter: "bank",
  name: "First Example Bank",
  financials: [] as Array<Record<string, unknown>>,
  trend: [] as Array<Record<string, unknown>>,
  ranking: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/data-store", () => ({
  getFeeCategorySummaries: vi.fn(), getFeeCategoryDetail: vi.fn(), getNationalIndex: vi.fn(), getPeerIndex: vi.fn(), getInstitutionsByFilter: vi.fn(),
  getInstitutionById: async (id: number) => ({ id, institution_name: readers.name, state_code: "ZZ", charter_type: readers.charter, asset_size: 1_200_000 }),
  getFeesByInstitution: async () => [],
  getFinancialsByInstitution: async () => readers.financials,
}));
vi.mock("@/lib/data-store/call-reports", () => ({
  getInstitutionPeerRanking: async () => readers.ranking,
  getInstitutionRevenueTrend: async () => readers.trend,
}));
vi.mock("@/lib/data-store/institution", () => ({ getInstitutionFeeScheduleEvidence: async () => null }));

async function profile(id: number) {
  const { getInstitution } = await import("./tools");
  const output = await getInstitution.execute!({ id }, { toolCallId: "t1", messages: [] }) as Record<string, unknown>;
  return { output, toolResults: [{ toolName: "getInstitution", input: { id }, output }] };
}

describe("the written answer's institution profile states call-report money in dollars (#1077)", () => {
  beforeEach(() => {
    readers.charter = "bank";
    readers.name = "First Example Bank";
    readers.financials = [{ institution_id: 7001, source: "fdic", report_date: "2026-06-30", total_assets: 1_200_000, total_deposits: 950_000,
      service_charge_income: 649, overdraft_revenue: 604, total_revenue: 797, fee_income_ratio: 0.0814 }];
    readers.trend = [{ quarter: "2026-Q2", service_charge_income: 649, fee_income_ratio: 0.0814, yoy_change_pct: null }];
    readers.ranking = null;
  });

  it("converts every money field once with the shared helper and labels it in dollars", async () => {
    const { output } = await profile(7001);
    expect(output).toMatchObject({
      identity: { name: "First Example Bank", asset_size: 1_200_000_000, field_units: { asset_size: "USD" } },
      financials: {
        units: expect.stringMatching(/^whole dollar amounts;/),
        definition: { source: "fdic", unit: "USD", filed_unit: "thousands of dollars" },
        latest: { service_charge_income: 649_000, overdraft_revenue: 604_000, total_revenue: 797_000, total_assets: 1_200_000_000,
          total_deposits: 950_000_000, fee_income_ratio: 0.0814 },
      },
      revenue_trend: [{ quarter: "2026-Q2", service_charge_income: 649_000, units: "USD" }],
      revenue_trend_definition: { unit: "USD", filed_unit: "thousands of dollars" },
    });
    expect(JSON.stringify(output)).not.toContain("thousands;");
  });

  it("lets the gate trace the dollar figure the writer saw, and holds the stored thousands stated as dollars", async () => {
    const { output, toolResults } = await profile(7001);
    const question = "What did First Example Bank earn in deposit service charges in Q2 2026?";
    const check = (answer: string) => writtenAnswerCheck(answer, [output], question, { institutionId: 7001, toolResults });
    expect(check("First Example Bank reported $649,000 in deposit service charges in Q2 2026.")).toMatchObject({ figureCheck: { unmatched: [] } });
    expect(check("First Example Bank reported $649 thousand in deposit service charges in Q2 2026.")).toMatchObject({ figureCheck: { unmatched: [] } });
    const held = check("First Example Bank reported $649 in deposit service charges in Q2 2026.");
    expect(held.passed).toBe(false);
    expect(held.figureCheck.unmatched).toEqual(["$649"]);
    // The registry's asset size is dollars too: $1.2 billion traces, the stored $1,200,000 does not.
    expect(checkNarrativeFigures("First Example Bank holds $1.2 billion in assets.", [output]).unmatched).toEqual([]);
    expect(checkNarrativeFigures("First Example Bank holds $1,200,000 in assets.", [output]).unmatched).toEqual(["$1,200,000"]);
  });

  it("states the peer ranking in dollars and keeps its filed comparison contract readable", async () => {
    readers.ranking = {
      institution_name: "First Example Bank", tier: "community", sc_income: 649, sc_rank: 3, peer_count: 12, peer_median_sc: 410,
      fee_income_ratio: 0.0814, peer_median_fee_ratio: 0.06,
      comparison: financialPeerComparison({ source: "fdic", reportDate: "2026-06-30", tier: "community", minimumAssetsUsd: 1e8, maximumAssetsUsd: 1e9,
        subjectIncluded: true, eligibleCount: 12, reportedCount: 12, ratioReportedCount: 12, minimumMedianCount: 5 }),
    };
    const { output, toolResults } = await profile(7001);
    expect(output.peer_ranking).toMatchObject({ sc_income: 649_000, peer_median_sc: 410_000, units: "USD", comparison: { unit: "USD", filed_unit: "thousands of dollars" } });
    expect(asFiledFinancialUnit((output.peer_ranking as Record<string, unknown>).comparison)).toMatchObject({ dollarsPerUnit: 1, filed: { unit: "thousands of dollars" } });
    const check = (answer: string) => writtenAnswerCheck(answer, [output], "How do First Example Bank's service charges compare with peers?", { institutionId: 7001, toolResults });
    expect(check("In Q2 2026 First Example Bank reported $649,000 in deposit service charges, against a peer median of $410,000.")).toMatchObject({ figureCheck: { unmatched: [] } });
    expect(check("In Q2 2026 First Example Bank reported $649 in deposit service charges, against a peer median of $410.").figureCheck.unmatched).toEqual(["$649", "$410"]);
  });

  it("derives a credit union's standalone quarter in dollars from a profile restated in dollars", async () => {
    readers.charter = "credit_union";
    readers.name = "Example Community Credit Union";
    readers.financials = [
      { institution_id: 7002, source: "ncua", report_date: "2026-06-30", service_charge_income: 900, fee_income_ratio: 0.05 },
      { institution_id: 7002, source: "ncua", report_date: "2026-03-31", service_charge_income: 400, fee_income_ratio: 0.05 },
    ];
    readers.trend = [{ quarter: "2026-Q2", service_charge_income: 500, fee_income_ratio: 0.05, yoy_change_pct: null }];
    const { toolResults } = await profile(7002);
    expect(profileQuarterCalculations(toolResults)).toEqual([expect.objectContaining({
      value: 500_000, unit: "USD", expression: "(900000 - 400000)", report_date: "2026-06-30",
    })]);
  });
});

describe("a trend row's own unit governs its amount in the interpretation rules (#1077)", () => {
  it("reads a thousands-labelled row under a USD definition as thousands, and a row with an unreadable unit as no evidence", async () => {
    readers.charter = "credit_union";
    readers.name = "Example Community Credit Union";
    readers.financials = [];
    readers.ranking = null;
    readers.trend = [{ quarter: "2026-Q2", service_charge_income: 500, fee_income_ratio: 0.05, yoy_change_pct: null }];
    const { output } = await profile(7002);
    const question = "What was Example Community Credit Union's fee income in Q2 2026?";
    const answer = "Q2 2026 Example Community Credit Union broad fee income was $500,000.";
    const interpretations = (data: Record<string, unknown>) => checkAnswerInterpretations(answer, [{ toolName: "getInstitution", input: { id: 7002 }, output: data }], question);
    expect(interpretations(output)).toEqual([]);
    // The definition says USD, but this row states its own unit: thousands of dollars.
    const thousandsRow = structuredClone(output);
    (thousandsRow.revenue_trend as Array<Record<string, unknown>>)[0] = { quarter: "2026-Q2", source: "ncua", service_charge_income: 500, units: "thousands of dollars" };
    expect((thousandsRow.revenue_trend_definition as Record<string, unknown>).unit).toBe("USD");
    expect(interpretations(thousandsRow)).toEqual([]);
    const unreadable = structuredClone(thousandsRow);
    (unreadable.revenue_trend as Array<Record<string, unknown>>)[0].units = "members";
    expect(interpretations(unreadable)).not.toEqual([]);
  });
});

describe("the filed-unit contract (#1077)", () => {
  it("reads a filed definition at 1,000 dollars a unit and a restated one at 1, and never guesses", () => {
    const filed = financialMeasureDefinition("fdic");
    expect(asFiledFinancialUnit(filed)).toEqual({ filed, dollarsPerUnit: 1000 });
    expect(asFiledFinancialUnit(restatedInDollars(filed))).toEqual({ filed, dollarsPerUnit: 1 });
    expect(asFiledFinancialUnit({ ...filed, unit: "USD" })).toBeNull();
    expect(asFiledFinancialUnit({ ...filed, filed_unit: "thousands of dollars" })).toBeNull();
    expect(asFiledFinancialUnit(null)).toBeNull();
  });

  it("gives the report writer national income groups in dollars, and the figure check reads the same values", () => {
    const group = buildFinancialIncomeGroup("fdic", [{ quarter: "2026-Q2", total_service_charges: 1_250_000, bank_service_charges: 1_250_000,
      cu_service_charges: 0, total_institutions: 4_000, yoy_change_pct: null } as never]);
    const writer = financialIncomeGroupInDollars(group);
    expect(writer).toMatchObject({ unit: "USD", filed_unit: "thousands of dollars", quarters: [{ total_dollars: 1_250_000_000, mean_dollars: 312_500 }] });
    expect(JSON.stringify(writer)).not.toContain("_thousands");
    expect(group.quarters[0]).toMatchObject({ total_thousands: 1_250_000 }); // The stored payload is unchanged.
    expect(checkNarrativeFigures("Banks reported $1.25 billion in deposit service charges, $312,500 per bank.", { groups: [writer] }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Banks reported $1,250,000 in deposit service charges.", { groups: [writer] }).unmatched).toEqual(["$1,250,000"]);
  });
});
