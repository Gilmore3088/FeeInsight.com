import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./maturity";
import type { CraRatingCode } from "@/lib/regulatory/cra";

/**
 * Summaries over CRA data loaded by Magellan's 'cra' registry source (cra_ratings,
 * cra_small_business_lending): rating distributions, lender shares of a county, county
 * summaries and lending by group. Every median carries the number of institutions behind it and
 * is null below MIN_INSTITUTIONS_FOR_MEDIAN.
 */

/** Median of the values, or null when fewer than `min` values back it. */
export function medianOrNull(values: number[], min: number = MIN_INSTITUTIONS_FOR_MEDIAN): number | null {
  if (values.length === 0 || values.length < min) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------------------------

export interface CraRatingDistributionRow {
  group: string | null;
  institutions: number;
  outstanding: number;
  satisfactory: number;
  needsToImprove: number;
  substantialNoncompliance: number;
  /** Share rated Outstanding, 0-1; null when the group is empty. */
  outstandingShare: number | null;
  /** Share rated below Satisfactory, 0-1. */
  belowSatisfactoryShare: number | null;
  /** Median age of the latest exam in days, with its institution count. */
  medianExamAgeDays: number | null;
  examAgeInstitutions: number;
}

export function distributionRow(
  group: string | null,
  counts: Partial<Record<CraRatingCode, number>>,
  examAgesDays: number[],
): CraRatingDistributionRow {
  const outstanding = counts[1] ?? 0;
  const satisfactory = counts[2] ?? 0;
  const needsToImprove = counts[3] ?? 0;
  const substantialNoncompliance = counts[4] ?? 0;
  const institutions = outstanding + satisfactory + needsToImprove + substantialNoncompliance;
  return {
    group,
    institutions,
    outstanding,
    satisfactory,
    needsToImprove,
    substantialNoncompliance,
    outstandingShare: institutions > 0 ? outstanding / institutions : null,
    belowSatisfactoryShare: institutions > 0 ? (needsToImprove + substantialNoncompliance) / institutions : null,
    medianExamAgeDays: medianOrNull(examAgesDays),
    examAgeInstitutions: examAgesDays.length,
  };
}

export interface CraLenderInput {
  agencyCode: string;
  respondentId: string;
  institutionId: number | null;
  name: string | null;
  loans: number;
  amountThousands: number;
  loansRevUnder1m: number | null;
}

export interface CraLenderShare extends CraLenderInput {
  /** Share of all reporters' loans in the county, 0-1; null when the county total is zero. */
  loanShare: number | null;
  amountShare: number | null;
}

/** Each lender's share of the county's reported loans and dollars, largest first. */
export function withLenderShares(lenders: CraLenderInput[]): { totalLoans: number; totalAmountThousands: number; shares: CraLenderShare[] } {
  const totalLoans = lenders.reduce((a, l) => a + l.loans, 0);
  const totalAmountThousands = lenders.reduce((a, l) => a + l.amountThousands, 0);
  const shares = lenders
    .map((l) => ({
      ...l,
      loanShare: totalLoans > 0 ? l.loans / totalLoans : null,
      amountShare: totalAmountThousands > 0 ? l.amountThousands / totalAmountThousands : null,
    }))
    .sort((a, b) => b.amountThousands - a.amountThousands || b.loans - a.loans);
  return { totalLoans, totalAmountThousands, shares };
}

export interface CraCountySummaryRow {
  stateFips: string;
  countyFips: string;
  lenders: number;
  totalLoans: number;
  totalAmountThousands: number;
  /** Median loans per lender in the county, with the lender count behind it. */
  medianLenderLoans: number | null;
  /** Largest single lender's share of the county's dollars, 0-1. */
  topLenderAmountShare: number | null;
  /** Herfindahl-Hirschman index of dollar shares (0-10,000). */
  hhi: number | null;
}

export function summarizeCounties(
  rows: Array<{ stateFips: string; countyFips: string; loans: number; amountThousands: number }>,
): CraCountySummaryRow[] {
  const counties = new Map<string, Array<{ loans: number; amountThousands: number }>>();
  for (const r of rows) {
    const key = `${r.stateFips}${r.countyFips}`;
    const list = counties.get(key) ?? [];
    list.push({ loans: r.loans, amountThousands: r.amountThousands });
    counties.set(key, list);
  }
  return [...counties]
    .map(([key, lenders]) => {
      const totalLoans = lenders.reduce((a, l) => a + l.loans, 0);
      const totalAmountThousands = lenders.reduce((a, l) => a + l.amountThousands, 0);
      const shares = totalAmountThousands > 0 ? lenders.map((l) => l.amountThousands / totalAmountThousands) : [];
      return {
        stateFips: key.slice(0, 2),
        countyFips: key.slice(2),
        lenders: lenders.length,
        totalLoans,
        totalAmountThousands,
        medianLenderLoans: medianOrNull(lenders.map((l) => l.loans)),
        topLenderAmountShare: shares.length > 0 ? Math.max(...shares) : null,
        hhi: shares.length > 0 ? Math.round(shares.reduce((a, s) => a + (s * 100) ** 2, 0)) : null,
      };
    })
    .sort((a, b) => b.totalAmountThousands - a.totalAmountThousands);
}

export interface CraLendingDimensionRow {
  group: string | null;
  /** Linked institutions that reported any loans of this type in the year. */
  institutions: number;
  medianLoans: number | null;
  medianAmountThousands: number | null;
  totalLoans: number;
  totalAmountThousands: number;
}

export function groupLending(rows: Array<{ group: string | null; loans: number; amountThousands: number }>): CraLendingDimensionRow[] {
  const groups = new Map<string | null, Array<{ loans: number; amountThousands: number }>>();
  for (const r of rows) {
    const list = groups.get(r.group) ?? [];
    list.push(r);
    groups.set(r.group, list);
  }
  return [...groups]
    .map(([group, list]) => ({
      group,
      institutions: list.length,
      medianLoans: medianOrNull(list.map((l) => l.loans)),
      medianAmountThousands: medianOrNull(list.map((l) => l.amountThousands)),
      totalLoans: list.reduce((a, l) => a + l.loans, 0),
      totalAmountThousands: list.reduce((a, l) => a + l.amountThousands, 0),
    }))
    .sort((a, b) => b.institutions - a.institutions);
}
