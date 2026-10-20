/** The private report link for a paid institution report request, tied to that request (#2000). */
import { SITE_URL } from "@/lib/constants";
import { createPurchaseReportToken, reportPath } from "@/lib/custom-report/link";

export function privateReportUrl(institutionId: number | null, leadId: number): string | null {
  const token = institutionId ? createPurchaseReportToken(institutionId, leadId) : null;
  return token ? `${SITE_URL.replace(/\/$/, "")}${reportPath(token)}` : null;
}
