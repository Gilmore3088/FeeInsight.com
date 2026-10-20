"use server";

import { canAccessPremium } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import {
  getFinancialHistory,
  getPeerFinancialMedians,
  getPeerPercentiles,
  type InstitutionFinancialHistoryRow,
} from "@/lib/data-store/financial";
import { getRegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import { createReadBudget } from "@/lib/read-deadline";
import { buildFinancialSeries, computeGrowth, findOutliers, toPeerMedianPoints, toPeerRankRows } from "./financial-history";
import type { ProFinancialProfileData } from "./financial-profile-data";
import { formatReportQuarter } from "./financial-units";
import { PAGE_READ_BUDGET_MS } from "./profile-budget";

/**
 * The per-visitor parts of the institution profile (#1811, #1919). The page itself is cached
 * and served the same to every visitor, so it never reads the session; these run per request
 * from client islands after hydration. Pro data is read here and only for a Pro session, so it
 * never reaches the cached HTML.
 */

function validId(institutionId: unknown): institutionId is number {
  return typeof institutionId === "number" && Number.isInteger(institutionId) && institutionId > 0;
}

/** The signed-in visitor's alert on this institution, or null when signed out or not following it. */
export async function loadAlertSubscription(
  institutionId: number,
): Promise<{ signedIn: boolean; feeCategories: string[] | null; saved: boolean }> {
  if (!validId(institutionId)) return { signedIn: false, saved: false, feeCategories: null };
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { signedIn: false, saved: false, feeCategories: null };
  const budget = createReadBudget(PAGE_READ_BUDGET_MS, "Institution viewer");
  const subscription = await budget.optional(getAlertSubscriptionForInstitution(user.id, institutionId), "alert subscription", null);
  return { signedIn: true, saved: subscription !== null, feeCategories: subscription?.fee_categories ?? null };
}

/** Pro only: chart-ready data, with no client component references in the action response. */
export async function loadProFinancialProfile(input: {
  institutionId: number;
  institutionName: string;
  charterLabel: string;
}): Promise<ProFinancialProfileData | null> {
  const { institutionId: instId } = input;
  if (!validId(instId)) return null;
  const user = await getCurrentUser().catch(() => null);
  if (!canAccessPremium(user)) return null;

  const budget = createReadBudget(PAGE_READ_BUDGET_MS, "Institution Pro profile");
  const [financialHistory, peerMedians, peerPercentiles, regulatoryWatch] = await Promise.all([
    budget.optional(getFinancialHistory(instId), "financial history", [] as InstitutionFinancialHistoryRow[]),
    budget.optional(getPeerFinancialMedians(instId), "peer medians", null),
    budget.optional(getPeerPercentiles(instId), "peer percentiles", null),
    budget.optional(getRegulatoryWatch(instId), "regulatory watch", null),
  ]);
  const financialSeries = buildFinancialSeries(financialHistory);
  if (financialSeries.length === 0 && !regulatoryWatch) return null;
  const financialGrowth = computeGrowth(financialSeries);
  return {
    institutionId: instId,
    points: financialSeries,
    peers: toPeerMedianPoints(peerMedians),
    insights: {
      growth: financialGrowth,
      ranks: toPeerRankRows(peerPercentiles),
      flags: findOutliers(financialSeries, financialGrowth, peerPercentiles),
      peerCount: peerPercentiles?.peer_count ?? null,
      peerQuarter: formatReportQuarter(peerPercentiles?.report_date),
    },
    regulatoryWatch,
  };
}
