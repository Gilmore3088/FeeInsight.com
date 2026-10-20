import { getDistrictFeeRevenue, type DistrictFeeRevenue } from "./call-reports";
import { financialMeasureDefinition } from "./financial-peer-contract";
import { FINANCIAL_SOURCES, type FinancialSource } from "./financial-sources";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./fee-stats";

const THOUSANDS = 1_000;

/**
 * One regulator's call-report income for a Fed district at that regulator's newest filing.
 * FDIC deposit service charges and NCUA broad fee income are different measures, so a district
 * gets one group per regulator and never a pooled total or mean (#2416).
 */
export interface DistrictFinancialGroup extends Omit<ReturnType<typeof financialMeasureDefinition>, "unit"> {
  fed_district: number;
  /** "unavailable": no filing on record; "failed": the read itself errored, so we don't know. */
  status: "reported" | "unavailable" | "failed";
  report_date: string | null;
  /** Institutions with positive single-quarter income at report_date. */
  institution_count: number;
  total_income_usd: number | null;
  /** Null below the five-institution floor. */
  mean_income_usd: number | null;
  unit: "USD";
  stored_unit: "thousands of dollars";
  minimum_mean_count: number;
}

export function districtFinancialGroup(
  district: number,
  source: FinancialSource,
  row: DistrictFeeRevenue | null,
  missingStatus: "unavailable" | "failed" = "unavailable",
): DistrictFinancialGroup {
  const base = {
    // The stored "thousands of dollars" unit is replaced: this group carries converted USD.
    ...financialMeasureDefinition(source),
    fed_district: district,
    unit: "USD" as const,
    stored_unit: "thousands of dollars" as const,
    minimum_mean_count: MIN_INSTITUTIONS_FOR_MEDIAN,
  };
  const usable = row !== null && row.source === source && row.institution_count > 0
    && Number.isFinite(row.total_sc_income);
  if (!usable) {
    return { ...base, status: missingStatus, report_date: null, institution_count: 0, total_income_usd: null, mean_income_usd: null };
  }
  const totalUsd = row.total_sc_income * THOUSANDS;
  return {
    ...base,
    status: "reported",
    report_date: row.report_date,
    institution_count: row.institution_count,
    total_income_usd: totalUsd,
    mean_income_usd: row.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN ? totalUsd / row.institution_count : null,
  };
}

export async function getDistrictFinancialGroups(district: number): Promise<DistrictFinancialGroup[]> {
  return Promise.all(FINANCIAL_SOURCES.map(async (source) => {
    try {
      return districtFinancialGroup(district, source, await getDistrictFeeRevenue(district, undefined, source));
    } catch (error) {
      console.error(`[district-financial-summary] district ${district} ${source} read failed`, error);
      return districtFinancialGroup(district, source, null, "failed");
    }
  }));
}
