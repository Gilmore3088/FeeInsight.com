/**
 * /pay/report/[token] — the private pay page for a quoted institution report. Shows the
 * institution, the price James quoted and what the report covers, then hands off to
 * Stripe Checkout. After payment it shows the private report link. Not indexed.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportChrome } from "@/components/public/report-chrome";
import { CONTACT_EMAIL, REPORT_INCLUDES, REPORT_OFFER } from "@/lib/constants";
import { LINK_LIFETIME_DAYS } from "@/lib/custom-report/link";
import { getInstitutionLabel, getReportPaymentLead } from "@/lib/data-store/report-payments";
import { verifyPayToken } from "@/lib/leads/pay-link";
import { privateReportUrl } from "@/lib/leads/report-paid";
import { REPORT_PAYMENT_KIND, formatUsd } from "@/lib/leads/report-payment";
import { getStripe } from "@/lib/stripe";
import { startReportCheckoutAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay for your fee report",
  robots: { index: false, follow: false, nocache: true },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string; error?: string }>;
}

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const CARD = "rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6";
const BUTTON =
  "inline-flex items-center justify-center rounded-md bg-[#C44B2E] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#A93D25] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1815]";

/**
 * Right after Stripe redirects back, the webhook may not have landed yet. The session id
 * Stripe put in the URL is checked with Stripe directly: paid, and for this request.
 */
async function stripeConfirmsPayment(sessionId: string | undefined, leadId: number): Promise<boolean> {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    return (
      session.payment_status === "paid" &&
      session.metadata?.kind === REPORT_PAYMENT_KIND &&
      session.metadata?.lead_id === String(leadId)
    );
  } catch {
    return false;
  }
}

export default async function PayReportPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const query = await searchParams;
  const verified = verifyPayToken(token);
  if (!verified) notFound();
  const lead = await getReportPaymentLead(verified.leadId);
  if (!lead || !lead.quoteCents || !lead.quoteInstitutionId) notFound();
  const institution = await getInstitutionLabel(lead.quoteInstitutionId);
  if (!institution) notFound();

  const price = formatUsd(lead.quoteCents);
  const paid = Boolean(lead.paidAt) || (await stripeConfirmsPayment(query.paid, lead.id));
  const reportUrl = paid ? privateReportUrl(institution.id) : null;
  const place = [institution.city, institution.stateCode].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ReportChrome preparedFor={institution.name} />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-10 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">{REPORT_OFFER.name}</p>
        <h1 className="mt-2 text-[1.6rem] leading-tight tracking-[-0.02em] text-[#1A1815] sm:text-[2rem]" style={SERIF}>
          {institution.name}
        </h1>
        {place && <p className="mt-1 text-[14px] text-[#5A5347]">{place}</p>}

        {paid ? (
          <section className={`mt-8 ${CARD}`} aria-labelledby="paid-heading">
            <h2 id="paid-heading" className="text-xl text-[#1A1815]" style={SERIF}>
              Payment received. Thank you.
            </h2>
            {reportUrl ? (
              <>
                <p className="mt-2 text-[15px] leading-relaxed text-[#5A5347]">
                  Your report is ready. The link is private to you and works for {LINK_LIFETIME_DAYS} days; we also
                  emailed it to {lead.email}. Stripe emails your receipt.
                </p>
                <a href={reportUrl} className={`mt-5 ${BUTTON}`}>
                  Open your report
                </a>
              </>
            ) : (
              <p className="mt-2 text-[15px] leading-relaxed text-[#5A5347]">
                We will email your report link to {lead.email} within one business day. Stripe emails your receipt.
              </p>
            )}
          </section>
        ) : (
          <>
            {query.cancelled && (
              <p className="mt-6 rounded-md border border-[#E0D7C9] bg-[#FDFBF8] px-4 py-3 text-sm text-[#5A5347]" role="status">
                Payment cancelled. Nothing was charged.
              </p>
            )}
            {query.error && (
              <p className="mt-6 rounded-md border border-[#E7B8AA] bg-[#FBE9E4] px-4 py-3 text-sm text-[#A93D25]" role="alert">
                The card payment page could not be opened. Nothing was charged. Try again, or write to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            )}
            {query.paid && (
              <p className="mt-6 rounded-md border border-[#E0D7C9] bg-[#FDFBF8] px-4 py-3 text-sm text-[#5A5347]" role="status">
                Stripe is still confirming your payment. Refresh this page in a minute; we also email your report link once it
                is confirmed.
              </p>
            )}
            <section className={`mt-8 ${CARD}`} aria-labelledby="quote-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="quote-heading" className="text-xl text-[#1A1815]" style={SERIF}>
                  Your quote
                </h2>
                <p className="text-[1.75rem] font-semibold tabular-nums text-[#1A1815]">
                  {price}
                  <span className="ml-1 text-sm font-normal text-[#6B6255]">one time</span>
                </p>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5A5347]">
                {institution.name} against the banks and credit unions in its own branch counties, built from their live
                published fee schedules.
              </p>
              <ul className="mt-4 space-y-2 text-[15px] leading-relaxed text-[#1A1815]">
                {REPORT_INCLUDES.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-[#A93D25]" aria-hidden="true">
                      ●
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <form action={startReportCheckoutAction} className="mt-6">
                <input type="hidden" name="token" value={token} />
                <button type="submit" className={`w-full sm:w-auto ${BUTTON}`}>
                  Pay {price} by card
                </button>
              </form>
              <p className="mt-3 text-[13px] leading-relaxed text-[#6B6255]">
                You pay on Stripe&apos;s secure checkout page; we never see your card number. Your private report link opens
                as soon as the payment goes through.
              </p>
            </section>
            <p className="mt-6 text-[13px] text-[#6B6255]">
              Questions about the scope? Write to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                {CONTACT_EMAIL}
              </a>{" "}
              or <Link href="/contact?source=report" className="underline">use the contact form</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
