import type { CallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import type { RevenueSnapshot } from "@/lib/data-store/call-reports";
import { financialMeasureDefinition, restatedInDollars } from "@/lib/data-store/financial-peer-contract";
import { callReportDollars } from "@/lib/hamilton/call-report-dollars";
import type { FinancialSource } from "@/lib/data-store/financial-sources";

const FINANCIAL_INCOME_COHORT_RULE = "Canonical same-charter filers with positive, computable standalone-quarter income. Counts are reporting counts; missing filings are not counted. Reporting populations can change; trends are not constant-cohort or merger-adjusted. No selected institution applies to this geographic aggregate.";

export type FinancialIncomeGroup = ReturnType<typeof financialMeasureDefinition> & {
  cohort_rule: string;
  cohort_history?: CallCohortHistory;
  geography: string;
  size_criterion: "all_reported_asset_sizes";
  subject_included: "not_applicable";
  quarters: {
    quarter: string;
    report_date: string;
    total_thousands: number;
    mean_thousands: number;
    reported_count: number;
    eligible_count: null;
    yoy_change_pct: number | null;
  }[];
};

export function financialIncomeLabel(source: FinancialSource): string {
  return source === "ncua" ? "Broad credit-union fee income" : "Bank deposit service charges";
}

/** The caller reads each regulator separately; no combined denominator is constructed. */
export function buildFinancialIncomeGroup(source: FinancialSource, rows: RevenueSnapshot[], limit = 8, geography = "United States", cohortHistory?: CallCohortHistory): FinancialIncomeGroup {
  return {
    ...financialMeasureDefinition(source),
    geography,
    cohort_history: cohortHistory,
    size_criterion: "all_reported_asset_sizes",
    cohort_rule: FINANCIAL_INCOME_COHORT_RULE,
    subject_included: "not_applicable",
    quarters: rows.filter((q) => /^\d{4}-Q[1-4]$/.test(q.quarter) && Number.isSafeInteger(q.total_institutions) && q.total_institutions > 0
      && Number.isFinite(q.total_service_charges) && q.total_service_charges > 0
      && (source === "fdic" ? q.cu_service_charges === 0 && q.bank_service_charges === q.total_service_charges
        : q.bank_service_charges === 0 && q.cu_service_charges === q.total_service_charges)).slice(0, limit).map((q) => {
      const quarter = Number(q.quarter.slice(-1));
      const reportDate = `${q.quarter.slice(0, 4)}-${["03-31", "06-30", "09-30", "12-31"][quarter - 1]}`;
      return { quarter: q.quarter, report_date: reportDate, total_thousands: q.total_service_charges,
        mean_thousands: q.total_service_charges / q.total_institutions,
        reported_count: q.total_institutions, eligible_count: null, yoy_change_pct: null };
    }),
  };
}

/** Saved payloads predate the cohort contract; rendering never revives their unreviewed growth. */
export function historicalIncomeForDisplay(group: FinancialIncomeGroup): FinancialIncomeGroup {
  return { ...group, cohort_rule: FINANCIAL_INCOME_COHORT_RULE,
    quarters: group.quarters.map((quarter) => ({ ...quarter, yoy_change_pct: null })) };
}

/**
 * A financial income group as a writer reads it (#1077): the stored thousands become whole dollars
 * through the one shared conversion (call-report-dollars.ts), the fields say so (`total_dollars`,
 * `mean_dollars`) and the unit is "USD" with the filed unit beside it, so the writer and the
 * figure check read the same dollar value. The stored payload and the rendered tables keep thousands.
 */
export function financialIncomeGroupInDollars(group: FinancialIncomeGroup) {
  const { quarters, ...rest } = group;
  return {
    ...restatedInDollars(rest),
    quarters: quarters.map(({ total_thousands, mean_thousands, ...quarter }) => ({
      ...quarter,
      total_dollars: callReportDollars(total_thousands),
      mean_dollars: callReportDollars(mean_thousands),
    })),
  };
}
