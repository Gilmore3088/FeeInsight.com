/**
 * After Stripe confirms an institution report payment (webhook, after commit): James is
 * alerted and the requester is emailed their private report link. Never throws; a failed
 * email moves the lead to a status that says a reply is owed, like any other lead.
 */
import { SITE_URL } from "@/lib/constants";
import { createReportToken, reportPath } from "@/lib/custom-report/link";
import { getInstitutionLabel } from "@/lib/data-store/report-payments";
import { sendReportPaidEmails } from "@/lib/email/report-payment";
import type { ReportPaidEffect } from "@/lib/stripe-webhook";
import { handleLeadDeliveryOutcome } from "./lead-alerts";

export function privateReportUrl(institutionId: number | null): string | null {
  const token = institutionId ? createReportToken(institutionId) : null;
  return token ? `${SITE_URL.replace(/\/$/, "")}${reportPath(token)}` : null;
}

export async function deliverPaidReport(paid: ReportPaidEffect): Promise<void> {
  try {
    const institution = paid.institutionId ? await getInstitutionLabel(paid.institutionId) : null;
    const outcome = await sendReportPaidEmails({
      leadId: paid.leadId,
      name: paid.name,
      email: paid.email,
      institution: institution?.name ?? "your institution",
      cents: paid.cents,
      reportUrl: institution ? privateReportUrl(institution.id) : null,
      checkoutSessionId: paid.checkoutSessionId,
    });
    await handleLeadDeliveryOutcome({ id: paid.leadId, email: paid.email, name: paid.name, source: "paid report" }, outcome);
  } catch (error) {
    console.error("[report-payment] paid report delivery failed", {
      leadId: paid.leadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
