import { TrackLink } from "@/components/track-link";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { CONTACT_EMAIL, REPORT_INCLUDES, REPORT_OFFER, SAMPLE_REPORT_LIVE } from "@/lib/constants";
import { BAND, BODY, CheckList, EYEBROW, GLASS_SOFT, H2 } from "@/components/public/site-look";

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

const WHAT_YOU_GET = REPORT_INCLUDES;

const NEXT_STEPS = [
  "Pick a report. National and Fed district reports are free and open right away.",
  "Want your own institution against named competitors? Pick the institution report.",
  `${REPORT_OFFER.nextStep}. You pay by card once you agree to the quote.`,
];

/**
 * The bank and credit union path: what the report is, the real first pages of the public
 * sample, and the same request form as /for-institutions, so the lead is captured right here.
 * Desktop: two equal columns (the pitch and its checklist; the form), the /subscribe layout.
 */
export function LandingBankOffer({ sampleLive = false }: { sampleLive?: boolean }) {
  return (
    <section id="for-banks" aria-labelledby="for-banks-title" className={`scroll-mt-16 ${BAND}`}>
      <div className="mx-auto grid max-w-page gap-10 px-4 py-12 sm:px-6 sm:py-16 xl:grid-cols-2 xl:items-start xl:gap-14">
        <div className="min-w-0">
          <p className={EYEBROW}>For banks and credit unions</p>
          <h2 id="for-banks-title" className={`mt-3 ${H2}`}>
            See where your fees sit against your competitors
          </h2>
          <p className={`mt-3 text-pretty ${BODY}`}>
            National and Fed district reports are free. The {REPORT_OFFER.name} for your
            institution starts at $300: we read your fee schedule and your
            competitors&apos;, then show where you stand.
          </p>

          <CheckList items={WHAT_YOU_GET} className="mt-6" />

          {SAMPLE_REPORT_LIVE && (
            <div className="mt-6">
              <SamplePages />
            </div>
          )}
          {sampleLive && (
            <>
              <TrackLink
                event="see_sample_report"
                eventProps={{ placement: "home_bank_section" }}
                href={SAMPLE_REPORT_HREF}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[#A93D25] underline underline-offset-2 hover:text-[#8E2A17]"
              >
                Read the full sample report
              </TrackLink>
            </>
          )}

          <div className={`mt-8 p-5 sm:p-6 ${GLASS_SOFT}`}>
            <h3 className="text-sm font-semibold text-[#1A1815]">What happens next</h3>
            <ol className="mt-3 space-y-3">
              {NEXT_STEPS.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-snug text-[#3D3830]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1A1815] text-xs font-semibold tabular-nums text-white">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="min-w-0 xl:sticky xl:top-20">
          <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="homepage" />
        </div>
      </div>
    </section>
  );
}

// Pages 1-3 of public/reports/sample-competitive-fee-position.pdf, rendered as images.
// Re-render these whenever the sample PDF is regenerated so the preview matches it.
const SAMPLE_PAGES = [
  { src: "/reports/sample-preview/page-1.webp", label: "Cover" },
  { src: "/reports/sample-preview/page-2.webp", label: "Summary of findings" },
  { src: "/reports/sample-preview/page-3.webp", label: "Every fee against the peer range" },
];

/** The actual first three pages of the sample report, each opening the full sample. */
function SamplePages() {
  return (
    <figure className={`min-w-0 p-3 sm:p-4 ${GLASS_SOFT}`}>
      <ul className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {SAMPLE_PAGES.map((page, index) => (
          <li key={page.src} className="min-w-0">
            <TrackLink
              event="see_sample_report"
              eventProps={{ placement: "home_sample_page", page: index + 1 }}
              href={SAMPLE_REPORT_HREF}
              className="group block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static pre-rendered page image */}
              <img
                src={page.src}
                alt={`Sample report, page ${index + 1}: ${page.label}`}
                width={850}
                height={1100}
                loading="lazy"
                className="block h-auto w-full rounded-[3px] bg-white shadow-[0_1px_2px_rgba(26,24,21,0.12),0_10px_24px_-14px_rgba(26,24,21,0.45)] ring-1 ring-[#E0D7C9] transition-transform group-hover:-translate-y-0.5"
              />
              <span className="mt-2 block text-balance text-[11px] leading-snug text-[#5A5347] group-hover:text-[#A93D25]">
                {page.label}
              </span>
            </TrackLink>
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-pretty text-[11px] leading-snug text-[#6B6255]">
        The first pages of the sample report, prepared for a real community bank ($300M to $1B in assets) with its
        name removed. Your report covers your institution and your peers.
      </figcaption>
    </figure>
  );
}
