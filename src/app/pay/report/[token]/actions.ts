"use server";

import { redirect } from "next/navigation";
import { REPORT_OFFER, SITE_URL } from "@/lib/constants";
import { getInstitutionLabel, getReportPaymentLead, saveCheckoutSession } from "@/lib/data-store/report-payments";
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
  const verified = verifyPayToken(token);
  if (!verified) redirect("/");
  const page = `${SITE_URL.replace(/\/$/, "")}${payPath(token)}`;

  const lead = await getReportPaymentLead(verified.leadId);
  if (!lead || !lead.quoteCents || !lead.quoteInstitutionId) redirect(payPath(token));
  if (lead.paidAt) redirect(payPath(token));
  const institution = await getInstitutionLabel(lead.quoteInstitutionId);
  if (!institution) redirect(payPath(token));

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
              description: "Your fees against the banks and credit unions in your branch counties, from live published fee schedules.",
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
