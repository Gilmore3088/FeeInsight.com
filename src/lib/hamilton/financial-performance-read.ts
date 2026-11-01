import { getFinancialPeerMedians, getInstitutionFiledQuarters } from "@/lib/data-store/institution-financial-quarters";
import { buildFinancialPerformance, peerQuarterDates, type FinancialPerformanceView } from "./financial-quarters";

/**
 * The financial performance view for one institution (#1892): its filings, then the peer medians
 * for the quarters shown. A failed peer read leaves the peer column empty and says so; it never
 * hides the institution's own filed figures.
 */
export async function readFinancialPerformance(institutionId: number): Promise<{
  view: FinancialPerformanceView | null;
  peerReadFailed: boolean;
}> {
  const rows = await getInstitutionFiledQuarters(institutionId);
  const dates = peerQuarterDates(rows);
  let peerReadFailed = false;
  const peers = await getFinancialPeerMedians(institutionId, dates).catch(() => {
    peerReadFailed = true;
    return [];
  });
  return { view: buildFinancialPerformance(rows, peers), peerReadFailed };
}
