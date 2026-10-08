"use server";

import { redirect } from "next/navigation";
import { REPORT_OFFER, SITE_URL } from "@/lib/constants";
import { checkInstitutionReport } from "@/lib/custom-report/quote-check";
import {
  flagQuoteNotReady,
  getInstitutionLabel,
  getReportPaymentLead,
  saveCheckoutSession,
  saveReportSnapshot,
} from "@/lib/data-store/report-payments";
import { payPath, verifyPayToken } from "@/lib/leads/pay-link";
import { REPORT_PAYMENT_KIND } from "@/lib/leads/report-payment";
import { getStripe } from "@/lib/stripe";

/**
 * Starts Stripe Checkout for a quoted institution report: a one-time card payment of the
 * price saved on the request (never a price from the link or the form). The webhook marks
 * the request Paid; the success page shows the private report link.
 */
export async function startReportCheckoutAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const { lead, institution } = await readyToPay(token);
  const page = `${SITE_URL.replace(/\/$/, "")}${payPath(token)}`;

  let url: string | null = null;
  try {
    const metadata = { kind: REPORT_PAYMENT_KIND, lead_id: String(lead.id) };
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: lead.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: lead.quoteCents,
            product_data: {
              name: `${REPORT_OFFER.name}: ${institution.name}`,
              description: REPORT_LINE_DESCRIPTION,
            },
          },
        },
      ],
      payment_intent_data: { receipt_email: lead.email, metadata },
      metadata,
      success_url: `${page}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${page}?cancelled=1`,
    });
    await saveCheckoutSession(lead.id, session.id);
    url = session.url;
  } catch (error) {
    console.error("[report-payment] checkout failed", {
      leadId: lead.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  redirect(url ?? `${payPath(token)}?error=1`);
}

const REPORT_LINE_DESCRIPTION =
  "Your fees against the banks and credit unions in your branch counties, from live published fee schedules.";
/** Net 30, the usual term for a bank's accounts payable (James agreed the invoice option, 8 Oct 2026). */
const INVOICE_DAYS_DUE = 30;

/**
 * Opens a Stripe invoice for the quoted report, for finance teams that pay by bank transfer
 * or need a PDF to approve. The buyer asked for it on the page, and it opens on Stripe's
 * hosted invoice page; nothing is emailed from here (auto_advance off, no send call). One
 * invoice per request: a second click reopens the same one. The webhook's `invoice.paid`
 * marks the request Paid, the same as a card payment.
 */
export async function startReportInvoiceAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const { lead, institution } = await readyToPay(token);

  let url: string | null = null;
  try {
    const stripe = getStripe();
    const existing = await stripe.invoices.search({
      query: `metadata['kind']:'${REPORT_PAYMENT_KIND}' AND metadata['lead_id']:'${lead.id}'`,
      limit: 5,
    });
    const reusable = existing.data.find((invoice) => invoice.status === "open" && invoice.hosted_invoice_url);
    if (reusable) {
      url = reusable.hosted_invoice_url ?? null;
    } else {
      const metadata = { kind: REPORT_PAYMENT_KIND, lead_id: String(lead.id) };
      // Its own customer, never a Pro subscriber's, so invoice events can't touch a subscription.
      const customer = await stripe.customers.create({
        email: lead.email,
        name: institution.name,
        description: `Institution report request ${lead.id}`,
        metadata,
      });
      const invoice = await stripe.invoices.create({
        customer: customer.id,
        collection_method: "send_invoice",
        days_until_due: INVOICE_DAYS_DUE,
        auto_advance: false,
        description: `${REPORT_OFFER.name}: ${institution.name}`,
        metadata,
      });
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: lead.quoteCents,
        currency: "usd",
        description: `${REPORT_OFFER.name}: ${institution.name}. ${REPORT_LINE_DESCRIPTION}`,
      });
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id!, { auto_advance: false });
      url = finalized.hosted_invoice_url ?? null;
    }
  } catch (error) {
    console.error("[report-payment] invoice failed", {
      leadId: lead.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  redirect(url ?? `${payPath(token)}?error=invoice`);
}

/** The checks both payment routes run first; redirects back to the pay page when not payable. */
async function readyToPay(token: string) {
  const verified = verifyPayToken(token);
  if (!verified) redirect("/");

  const lead = await getReportPaymentLead(verified.leadId);
  if (!lead || !lead.quoteCents || !lead.quoteInstitutionId) redirect(payPath(token));
  if (lead.paidAt) redirect(payPath(token));
  const institution = await getInstitutionLabel(lead.quoteInstitutionId);
  if (!institution) redirect(payPath(token));
  // The market can thin out between the quote and the payment; never take money for a
  // report that would open as "being refreshed".
  const check = await checkInstitutionReport({ institutionId: institution.id, institutionName: null });
  if (check.status !== "ready") {
    await flagQuoteNotReady(lead.id);
    redirect(payPath(token));
  }
  // What they are paying for: if the live market thins out later, the report shows this copy.
  if (check.data) await saveReportSnapshot(lead.id, check.data);
  return { lead: { ...lead, quoteCents: lead.quoteCents }, institution };
}
