import { getCustomReportMarketDataCached } from "@/lib/data-store/public-cached-reads";
import type { CustomReportMarketData } from "@/lib/data-store/custom-report-market";
import { getPaidReportSnapshot } from "@/lib/data-store/report-payments";
import { analyzeMarket, diffReports, type CustomReportAnalysis, type ReportChange } from "./analysis";

export interface MarketReport {
  data: CustomReportMarketData;
  analysis: CustomReportAnalysis;
  /** Set when the live market is thin and the report shows the copy saved at payment. */
  savedAt: string | null;
  /** For a bought report shown live: what moved since the copy saved at payment. */
  sinceBought: { savedAt: string; changes: ReportChange[] } | null;
}

async function loadSnapshot(institutionId: number) {
  try {
    const saved = await getPaidReportSnapshot(institutionId);
    if (!saved?.data.market) return null;
    const analysis = analyzeMarket(saved.data);
    return analysis.readiness.ready ? { data: saved.data, analysis, savedAt: saved.savedAt } : null;
  } catch (error) {
    console.error("[custom-report] saved copy unavailable", {
      institutionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The numbers behind a private report: live when the market passes the readiness bar;
 * otherwise, for a report someone paid for, the copy saved when they paid, so a paid report
 * never opens as "being refreshed". Null when the institution has no local market.
 */
export async function loadMarketReport(institutionId: number): Promise<MarketReport | null> {
  const live = await getCustomReportMarketDataCached(institutionId);
  const liveAnalysis = live?.market ? analyzeMarket(live) : null;
  const saved = await loadSnapshot(institutionId);

  if (live && liveAnalysis?.readiness.ready) {
    const sinceBought = saved ? { savedAt: saved.savedAt, changes: diffReports(saved.analysis, liveAnalysis) } : null;
    return { data: live, analysis: liveAnalysis, savedAt: null, sinceBought };
  }
  if (saved) return { data: saved.data, analysis: saved.analysis, savedAt: saved.savedAt, sinceBought: null };

  if (!live || !live.market || !liveAnalysis) return null;
  return { data: live, analysis: liveAnalysis, savedAt: null, sinceBought: null };
}
