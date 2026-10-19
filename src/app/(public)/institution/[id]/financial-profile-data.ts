import type { RegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import type { FinancialPoint, GrowthRow, OutlierFlag, PeerMedianPoints, PeerRankRow } from "./financial-history";

export interface FinancialInsightData {
  growth: GrowthRow[];
  ranks: PeerRankRow[];
  flags: OutlierFlag[];
  peerCount: number | null;
  peerQuarter: string | null;
}

/** Plain data returned by the Pro-only action; the viewer owns the component tree. */
export interface ProFinancialProfileData {
  institutionId: number;
  points: FinancialPoint[];
  peers: PeerMedianPoints | null;
  insights: FinancialInsightData;
  regulatoryWatch: RegulatoryWatch | null;
}
