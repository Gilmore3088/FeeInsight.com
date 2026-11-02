/**
 * Reads a fee-share screen's peer set from call reports (#2028) and hands it to the pure builder
 * (workspace/fee-share-screen.ts). The peer set is what the question names (charter, asset range,
 * state, the N largest); a question that names no charter screens the researched institution's,
 * and one that names no size and no "largest" screens the researched institution's size band
 * (the band its Hamilton peer ranking uses). Banks and credit unions are never pooled: they file
 * different fee income measures. Money is converted to whole dollars once (call-report-dollars.ts).
 */

import { getInstitutionPeerRanking, getLatestFinancialReportDate, type PeerRanking } from "@/lib/data-store/call-reports";
import { financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import { getFeeShareScreenFilers, type FeeShareCohort, type FeeShareScreenScope } from "@/lib/data-store/institution-quarterly";
import { segmentLabel } from "@/lib/segment-words";
import { callReportDollars } from "./call-report-dollars";
import { charterIn, stateIn } from "./workspace/segment";
import {
  buildFeeShareScreen,
  feeShareScreenUnavailable,
  type FeeShareScreenAsk,
  type FeeShareScreenRow,
} from "./workspace/fee-share-screen";
import type { AskResponse, AskSegment } from "./workspace/types";

export interface FeeShareScreenReaders {
  ranking: (institutionId: number) => Promise<PeerRanking | null>;
  latestDate: (source: "fdic" | "ncua") => Promise<string | null>;
  filers: (scope: FeeShareScreenScope, reportDate: string) => Promise<FeeShareCohort | null>;
}

const READERS: FeeShareScreenReaders = {
  ranking: getInstitutionPeerRanking,
  latestDate: getLatestFinancialReportDate,
  filers: getFeeShareScreenFilers,
};

function rowOf(member: FeeShareCohort["members"][number]): FeeShareScreenRow {
  const share = member.fee_income_ratio;
  const revenue = callReportDollars(member.total_revenue);
  return {
    institutionId: member.id,
    name: member.name,
    stateCode: member.state,
    totalAssets: callReportDollars(member.total_assets),
    serviceCharges: callReportDollars(member.service_charge_income),
    revenue,
    // A share needs revenue to be a share of: none without positive filed revenue.
    share: share !== null && Number.isFinite(share) && revenue !== null && revenue > 0 ? share : null,
  };
}

export async function loadFeeShareScreen(
  institutionId: number,
  question: string,
  screen: FeeShareScreenAsk,
  segment: AskSegment | null,
  subjectName?: string,
  readers: FeeShareScreenReaders = READERS,
): Promise<AskResponse> {
  const ranking = await readers.ranking(institutionId).catch((error) => {
    console.error("[hamilton-ask] fee-share screen: subject filing failed", error);
    return null;
  });
  // The researched institution's latest filing: its charter, size band and date.
  const own = ranking?.comparison ?? null;
  const subjectCharter = own?.charter_type ?? null;
  const asked = segment?.charterType ?? charterIn(question);
  const charter = asked ?? subjectCharter;
  if (!charter) return feeShareScreenUnavailable(screen, "charter");
  const source = financialSourceForCharter(charter);
  if (!source) return feeShareScreenUnavailable(screen, "charter");

  const sized = segment !== null && (segment.minAssets !== null || segment.maxAssets !== null);
  const largest = segment?.largest ?? null;
  // No size and no "largest" named: the researched institution's own size band, when it files the same measure.
  const ownBand = !sized && largest === null && own !== null && subjectCharter === charter ? own.size_criterion : null;
  const minAssets = ownBand ? ownBand.minimum_usd_inclusive / 1_000 : segment?.minAssets ?? null;
  const maxAssets = ownBand ? (ownBand.maximum_usd_exclusive === null ? null : ownBand.maximum_usd_exclusive / 1_000) : segment?.maxAssets ?? null;
  const stateCode = segment?.stateCode ?? stateIn(question);
  const labelOf = (n: number | null) => segmentLabel({ minAssets, maxAssets, charterType: charter, stateCode, largest: n });

  const reportDate =
    own && own.source === source
      ? own.report_date
      : await readers.latestDate(source).catch((error) => {
          console.error("[hamilton-ask] fee-share screen: latest filing date failed", error);
          return null;
        });
  if (!reportDate) return feeShareScreenUnavailable(screen, "quarter", labelOf(largest));

  const scope: FeeShareScreenScope = { charterType: charter, source, minAssets, maxAssets, stateCode };
  const cohort = await readers.filers(scope, reportDate).catch((error) => {
    console.error("[hamilton-ask] fee-share screen: filings failed", error);
    return null;
  });
  if (!cohort) return feeShareScreenUnavailable(screen, "read", labelOf(largest));

  let rows = cohort.members.map(rowOf);
  if (largest !== null) {
    rows = rows
      .filter((r) => r.totalAssets !== null)
      .sort((a, b) => (b.totalAssets ?? 0) - (a.totalAssets ?? 0))
      .slice(0, largest);
  }
  // "The 25 largest" only when 25 filed; fewer are named as the count they are.
  const shownLargest = largest === null || rows.length === 0 ? null : Math.min(largest, rows.length);
  const peerSet: AskSegment = { minAssets, maxAssets, charterType: charter, stateCode, largest: shownLargest, label: labelOf(shownLargest) };
  return buildFeeShareScreen(screen, {
    source,
    reportDate: cohort.report_date,
    peerSet,
    charterFrom: asked ? "question" : "subject",
    ...(ownBand && subjectName ? { sizeOf: subjectName } : {}),
    rows,
  });
}
