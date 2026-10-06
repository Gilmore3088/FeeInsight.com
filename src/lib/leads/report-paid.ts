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
import { sql } from "@/lib/data-store/connection";
import { adminLeadsUrl } from "@/lib/email/lead-notification";
import { handleLeadDeliveryOutcome, sendLeadAlert } from "./lead-alerts";
import { formatUsd } from "./report-payment";

export function privateReportUrl(institutionId: number | null): string | null {
  const token = institutionId ? createReportToken(institutionId) : null;
  return token ? `${SITE_URL.replace(/\/$/, "")}${reportPath(token)}` : null;
}

export async function deliverPaidReport(paid: ReportPaidEffect): Promise<void> {
  try {
    const institution = paid.institutionId ? await getInstitutionLabel(paid.institutionId) : null;
    const reportUrl = institution ? privateReportUrl(institution.id) : null;
    const outcome = await sendReportPaidEmails({
      leadId: paid.leadId,
      name: paid.name,
      email: paid.email,
      institution: institution?.name ?? "your institution",
      cents: paid.cents,
      reportUrl,
      checkoutSessionId: paid.checkoutSessionId,
    });
    await handleLeadDeliveryOutcome({ id: paid.leadId, email: paid.email, name: paid.name, source: "paid report" }, outcome);
    // Paid with no link sent: James owes them the report, so the request stays in his queue.
    if (!reportUrl) await sql`UPDATE leads SET status = 'needs_reply' WHERE id = ${paid.leadId} AND status = 'paid'`;
  } catch (error) {
    console.error("[report-payment] paid report delivery failed", {
      leadId: paid.leadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A second card payment for a request already paid (two tabs, a resubmit): James refunds it. */
export async function alertDuplicateReportPayment(duplicate: { leadId: number; cents: number; checkoutSessionId: string }): Promise<void> {
  try {
    await sendLeadAlert({
      subject: `Refund needed: second payment of ${formatUsd(duplicate.cents)} for report request ${duplicate.leadId}`,
      status: { label: "Refund needed", tone: "warn" },
      lines: [
        `Request ${duplicate.leadId} was already paid, and Stripe just confirmed another payment of ${formatUsd(duplicate.cents)} for it.`,
        "",
        `Stripe checkout: ${duplicate.checkoutSessionId}`,
        "",
        "Refund this payment in the Stripe dashboard (Payments, search the checkout id). Nothing else changed.",
      ],
      cta: { label: "Open /admin/leads", href: adminLeadsUrl() },
    });
  } catch (error) {
    console.error("[report-payment] duplicate alert failed", { leadId: duplicate.leadId, error: error instanceof Error ? error.message : String(error) });
  }
}
