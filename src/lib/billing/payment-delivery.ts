import { CONTACT_EMAIL, SITE_URL } from "@/lib/constants";
import { createReportToken, reportPath } from "@/lib/custom-report/link";
import { buildProWelcomeEmail } from "@/lib/email/pro-welcome";
import { reportPaidEmails } from "@/lib/email/report-payment";
import { getLeadNotificationFromAddress, renderLeadEmailHtml, renderLeadEmailText, type LeadEmailContent } from "@/lib/email/lead-notification";
import { getResendApiKey, sendResendEmail, type ResendMessage } from "@/lib/email/resend";
import { enqueuePaymentEmail, claimPaymentEmail, finishPaymentEmail, paymentEmailStatus } from "@/lib/data-store/payment-outbox";
import type { sql } from "@/lib/data-store/connection";
import type { StripeEventEffects } from "@/lib/stripe-webhook";

function envelope(to: string, content: LeadEmailContent): ResendMessage {
  return { from: getLeadNotificationFromAddress(), to, replyTo: CONTACT_EMAIL,
    subject: content.subject, html: renderLeadEmailHtml(content), text: renderLeadEmailText(content) };
}
/** This is part of the payment transaction. Rendering and insertion never send email. */
export async function stagePaymentEmails(tx: typeof sql, eventId: string, effects: StripeEventEffects): Promise<void> {
  for (const [index, welcome] of effects.welcome.entries()) {
    await enqueuePaymentEmail(tx, { eventId, key: `${eventId}/welcome/${index}`, kind: "welcome",
      message: envelope(welcome.email, buildProWelcomeEmail(welcome.name)) });
  }
  for (const paid of effects.reportPaid) {
    const [institution] = paid.institutionId
      ? await tx<{ id: number; institution_name: string }[]>`SELECT id,institution_name FROM institution_sources WHERE id=${paid.institutionId}` : [];
    const token = institution ? createReportToken(Number(institution.id)) : null;
    const reportUrl = token ? `${SITE_URL.replace(/\/$/, "")}${reportPath(token)}` : null;
    const content = reportPaidEmails({ ...paid, institution: institution?.institution_name ?? "your institution", reportUrl });
    // The internal message must not say delivery happened before the provider accepted it.
    content.notification.lines[0] = `${paid.name}'s report payment was recorded. Customer email delivery is tracked separately in the Publishing room.`;
    await enqueuePaymentEmail(tx, { eventId, key: `${eventId}/report-customer/${paid.leadId}`, kind: "report_customer", leadId: paid.leadId,
      message: envelope(paid.email, content.confirmation), ...(!reportUrl ? { reviewReason: "No verified institution report link can be generated. Fulfill manually; do not mark delivered." } : {}) });
    await enqueuePaymentEmail(tx, { eventId, key: `${eventId}/report-admin/${paid.leadId}`, kind: "report_admin", leadId: paid.leadId,
      message: envelope(CONTACT_EMAIL, content.notification) });
    if (!reportUrl) await tx`UPDATE leads SET status='needs_reply' WHERE id=${paid.leadId} AND status='paid' AND refunded_at IS NULL`;
  }
  for (const duplicate of effects.reportDuplicate) {
    await enqueuePaymentEmail(tx, { eventId, key: `${eventId}/duplicate/${duplicate.checkoutSessionId}`, kind: "duplicate_admin", leadId: duplicate.leadId,
      message: envelope(CONTACT_EMAIL, { subject: `Review duplicate report payment: request ${duplicate.leadId}`,
        lines: [`An additional payment of $${(duplicate.cents/100).toFixed(2)} was recorded for an already-paid report.`,
          `Checkout: ${duplicate.checkoutSessionId}`, "Review and refund the duplicate in Stripe. No automatic refund has been made."] }) });
  }
  for (const refund of effects.reportRefunded) {
    await enqueuePaymentEmail(tx, { eventId, key: `${eventId}/refund/${refund.chargeId}`, kind: "refund_admin", leadId: refund.leadId,
      message: envelope(CONTACT_EMAIL, { subject: `Report refund recorded: request ${refund.leadId}`,
        lines: [`A full refund of $${(refund.cents/100).toFixed(2)} was recorded for ${refund.name}.`,
          `Stripe charge: ${refund.chargeId}`, "The report access check uses the refunded payment state. No customer email was sent by this alert."] }) });
  }
}

/** Safe to run again after an interrupted webhook. An accepted envelope is never claimed. */
export async function drainPaymentEmails(eventId: string | null, jobId: string | null = null): Promise<void> {
  const from = getResendApiKey() ? getLeadNotificationFromAddress() : null;
  const deadline = Date.now() + 45_000;
  for (let count = 0; count < 8 && Date.now() < deadline - 12_000; count++) {
    const job = await claimPaymentEmail(eventId, jobId, from || null);
    if (!job) break;
    let result;
    try { result = await sendResendEmail(job.message, `the payment ${job.kind} email`); }
    catch { result = { status: "failed" as const, error: "Email operation interrupted; retry with the saved envelope." }; }
    const receipt = result.status === "sent" ? { providerId: result.providerId }
      : { error: result.status === "failed" ? result.error : result.reason };
    await finishPaymentEmail(job, receipt);
    if (jobId) break;
  }
}
export { paymentEmailStatus };
