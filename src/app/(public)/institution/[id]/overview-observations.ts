import { formatCompactDollars } from "@/lib/format";
import type { CohortDistribution } from "./fee-share-cohort";
import { ordinal } from "./fee-share-cohort";
import type { FeeIncomeTerms } from "./financial-units";
import type { CompareCounts } from "./profile-view";
import { change, latestOf, valueAt, yearEarlier, type Ledger } from "./quarterly-ledger";

/**
 * "What stands out": up to three observations, each a fact computed from the page's own numbers
 * and a line on what that fact does not establish. Nothing here infers a cause or suggests a
 * price; an observation without the numbers behind it is left out.
 */
export interface Observation {
  key: "share" | "trend" | "fees";
  fact: string;
  notEstablished: string;
}

export function pct(n: number): string {
  return `${Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
}

export function signedPct(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${pct(Math.abs(n))}`;
}

export function signedDollars(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatCompactDollars(Math.abs(n))}`;
}

export function buildObservations(input: {
  ledger: Ledger;
  cohort: CohortDistribution | null;
  cohortName: string | null;
  counts: CompareCounts | null;
  stateName: string | null;
  terms: FeeIncomeTerms;
}): Observation[] {
  const { ledger, cohort, cohortName, counts, stateName, terms } = input;
  const out: Observation[] = [];
  const amountLower = terms.amount.toLowerCase();

  if (cohort?.subject && cohort.percentileRank !== null && cohortName) {
    const own = cohort.subject.sharePct;
    const relation = Math.abs(own - cohort.median) <= cohort.median * 0.01 ? "in line with" : own > cohort.median ? "above" : "below";
    out.push({
      key: "share",
      fact: `${terms.subject} ${terms.was} ${pct(own)} of revenue, ${relation} the ${pct(cohort.median)} median of ${cohort.peers.length.toLocaleString("en-US")} ${cohortName} (${ordinal(cohort.percentileRank)} percentile).`,
      notEstablished: "The share alone does not show whether prices, account volumes or the size of the revenue base set it.",
    });
  }

  const latest = latestOf(ledger, "serviceCharges");
  if (latest) {
    const prior = valueAt(ledger, "serviceCharges", yearEarlier(latest.quarter.reportDate));
    const yoy = change(latest.value.value, prior);
    if (yoy && yoy.pct !== null) {
      const direction = Math.abs(yoy.pct) < 0.5 ? "about level with" : yoy.pct > 0 ? `${pct(yoy.pct)} above` : `${pct(-yoy.pct)} below`;
      out.push({
        key: "trend",
        fact: `${terms.amount} was ${formatCompactDollars(latest.value.value)} in ${latest.quarter.quarter}, ${direction} the same quarter a year earlier (${formatCompactDollars(prior as number)}).`,
        notEstablished: `Two quarters a year apart are two observations, not an established trend in ${amountLower}.`,
      });
    }
  }

  if (counts && counts.compared > 0) {
    const place = counts.level === "state" && stateName ? stateName : "U.S.";
    out.push({
      key: "fees",
      fact: `${counts.above} of ${counts.compared} compared published fees sit above the ${place} median; ${counts.below} below.`,
      notEstablished: "Published prices do not show how often a fee is charged or waived, so they do not size its share of income.",
    });
  }
  return out.slice(0, 3);
}
