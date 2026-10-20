/** The private report link for a paid institution report request. */
import { SITE_URL } from "@/lib/constants";
import { createReportToken, reportPath } from "@/lib/custom-report/link";

export function privateReportUrl(institutionId: number | null): string | null {
  const token = institutionId ? createReportToken(institutionId) : null;
  return token ? `${SITE_URL.replace(/\/$/, "")}${reportPath(token)}` : null;
}
