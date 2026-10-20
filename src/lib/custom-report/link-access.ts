/**
 * Whether a verified /market-report link may open now. A purchase link opens only while the
 * payment it names is live (paid, not refunded) and is for the same bank, so a refund closes that
 * buyer's link alone (#2000). A bank link (issued before purchase links, or James's preview)
 * keeps the old rule until it expires: it closes only when every payment for the bank was refunded.
 */
import { isPurchaseLive, isReportRevoked } from "@/lib/data-store/report-payments";
import type { VerifiedReportToken } from "./link";

export interface ReportLinkStore {
  isPurchaseLive(purchaseId: number, institutionId: number): Promise<boolean>;
  isReportRevoked(institutionId: number): Promise<boolean>;
}

const defaultStore: ReportLinkStore = { isPurchaseLive, isReportRevoked };

export async function reportLinkOpens(verified: VerifiedReportToken, store: ReportLinkStore = defaultStore): Promise<boolean> {
  if (verified.purchaseId !== null) return store.isPurchaseLive(verified.purchaseId, verified.institutionId);
  return !(await store.isReportRevoked(verified.institutionId));
}
