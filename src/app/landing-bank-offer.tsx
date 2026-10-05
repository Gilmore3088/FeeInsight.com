import { TrackLink } from "@/components/track-link";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { CONTACT_EMAIL, REPORT_OFFER } from "@/lib/constants";
import type { ReportFinding } from "@/lib/hosted-reports";

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const SERIF_STYLE = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

const WHAT_YOU_GET = [
  "Your published fees next to your competitors', line by line",
  "Each fee marked above, inside or below the market range",
  "Named peers, not anonymous averages",
  "A source for every figure: the document, the page, the date",
];

const NEXT_STEPS = [
  "You send this form. We save your request right away.",
  "We email you to confirm which competitors to compare you with.",
  `Your PDF report arrives, ${REPORT_OFFER.turnaround}. No payment, no card. We only email you about your report.`,
];

/**
 * The bank and credit union path: what the report is, real findings from the public
 * sample, and the same request form as /for-institutions, so the lead is captured right here.
 */
export function LandingBankOffer({ findings }: { findings: ReportFinding[] }) {
  return (
    <section id="for-banks" className="scroll-mt-16 border-b border-[#E0D7C9] bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
            For banks and credit unions
          </p>
          <h2 className="mt-2 text-[1.75rem] leading-tight text-[#1A1815] sm:text-[2.1rem]" style={SERIF_STYLE}>
            See where your fees sit against your competitors
          </h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5A5347]">
            The {REPORT_OFFER.name} is free for your institution ({REPORT_OFFER.valueLabel}). We
            read your fee schedule and your competitors&apos;, then show where you stand.
          </p>

          <ul className="mt-5 space-y-2">
            {WHAT_YOU_GET.map((item) => (
              <li key={item} className="flex gap-2.5 text-[14px] leading-snug text-[#3D3830]">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C44B2E]" />
                {item}
              </li>
            ))}
          </ul>

          {findings.length > 0 && (
            <div className="mt-6">
              <SampleFindings findings={findings.slice(0, 3)} />
            </div>
          )}
          <TrackLink
            event="see_sample_report"
            eventProps={{ placement: "home_bank_section" }}
            href={SAMPLE_REPORT_HREF}
            className="mt-3 inline-block text-sm font-semibold text-[#A93D25] hover:text-[#8E2A17]"
          >
            Read the full sample report →
          </TrackLink>
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

/** A report "page" with the sample's real executive-summary findings, so the offer is concrete. */
function SampleFindings({ findings }: { findings: ReportFinding[] }) {
  return (
    <figure className="min-w-0 rounded-lg border border-[#E0D7C9] bg-[#FDFBF8] p-2 shadow-[0_1px_0_#E0D7C9,0_12px_32px_-18px_rgba(26,24,21,0.35)]">
      <div className="rounded-md border border-[#EDE6DA] bg-white px-5 py-5 sm:px-6">
        <div className="flex items-baseline justify-between gap-3 border-b-2 border-[#1A1815] pb-2">
          <p className="text-[13px] font-semibold text-[#1A1815]" style={SERIF_STYLE}>
            {REPORT_OFFER.name}
          </p>
          <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">Sample</p>
        </div>
        <ol className="divide-y divide-[#F0EBE3]">
          {findings.map((finding) => (
            <li key={finding.headline} className="grid grid-cols-[6.5rem_1fr] gap-4 py-4">
              <div>
                <p className="text-[1.3rem] font-semibold leading-tight tabular-nums text-[#C44B2E]" style={SERIF_STYLE}>
                  {finding.stat}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-[#6B6255]">{finding.statLabel}</p>
              </div>
              <p className="text-[14px] font-semibold leading-snug text-[#1A1815]">{finding.headline}</p>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="px-3 pb-1 pt-2.5 text-[11px] leading-snug text-[#6B6255]">
        Findings from the sample report, prepared for a real ~$400M community bank with its name
        removed. Your report covers your institution and your peers.
      </figcaption>
    </figure>
  );
}
