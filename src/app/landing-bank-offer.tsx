import { TrackLink } from "@/components/track-link";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { CONTACT_EMAIL, REPORT_INCLUDES, REPORT_OFFER, SAMPLE_REPORT_LIVE } from "@/lib/constants";

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const SERIF_STYLE = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

const WHAT_YOU_GET = REPORT_INCLUDES;

const NEXT_STEPS = [
  "Pick a report. National and Fed district reports are free and open right away.",
  "Want your own institution against named competitors? Pick the institution report.",
  `${REPORT_OFFER.nextStep}. You pay by card once you agree to the quote.`,
];

/**
 * The bank and credit union path: what the report is, the real first pages of the public
 * sample, and the same request form as /for-institutions, so the lead is captured right here.
 */
export function LandingBankOffer({ sampleLive = false }: { sampleLive?: boolean }) {
  return (
    <section id="for-banks" className="scroll-mt-16 border-b border-[#E0D7C9] bg-white">
      <div className="mx-auto grid max-w-page gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
            For banks and credit unions
          </p>
          <h2 className="mt-2 text-balance text-[1.75rem] leading-tight text-[#1A1815] sm:text-[2.1rem]" style={SERIF_STYLE}>
            See where your fees sit against your competitors
          </h2>
          <p className="mt-3 max-w-xl text-pretty text-[15px] leading-relaxed text-[#5A5347]">
            National and Fed district reports are free. The {REPORT_OFFER.name} for your
            institution starts at $300: we read your fee schedule and your
            competitors&apos;, then show where you stand.
          </p>

          <ul className="mt-5 space-y-2">
            {WHAT_YOU_GET.map((item) => (
              <li key={item} className="flex gap-2.5 text-[14px] leading-snug text-[#3D3830]">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C44B2E]" />
                {item}
              </li>
            ))}
          </ul>

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
                className="mt-3 inline-block text-sm font-semibold text-[#A93D25] hover:text-[#8E2A17]"
              >
                Read the full sample report →
              </TrackLink>
            </>
          )}
        </div>

        <div className="min-w-0 lg:sticky lg:top-20">
          <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="homepage" />
          <div className="mt-5 rounded-lg bg-[#FAF7F2] px-4 py-3.5">
            <p className="text-[12px] font-semibold text-[#1A1815]">What happens next</p>
            <ol className="mt-2 space-y-2">
              {NEXT_STEPS.map((step, index) => (
                <li key={step} className="flex gap-2 text-[12px] leading-snug text-[#5A5347]">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F4EEE5] text-[11px] font-semibold tabular-nums text-[#A93D25]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
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
    <figure className="min-w-0 rounded-lg bg-[#F4EEE5] p-3 sm:p-4">
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
