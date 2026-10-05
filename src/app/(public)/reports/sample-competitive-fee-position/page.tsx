/**
 * /reports/sample-competitive-fee-position — the one public, anonymized
 * Competitive Fee Position Report. Committed source in Reports/studio/sample/,
 * embedded in a script-free iframe so its print styles stay isolated; the
 * executive summary is also rendered as native page HTML so it reads on phones
 * and is visible to search. Site chrome (nav + footer) comes from the (public) layout.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { ReportExecutiveSummaryBlock } from "@/components/public/report-executive-summary";
import { ReportFrame } from "@/components/public/report-frame";
import { CONTACT_EMAIL, RESEARCH_IMPRINT, SITE_NAME, SITE_URL, REPORT_OFFER, REPORT_OFFER_LINE } from "@/lib/constants";
import { extractExecutiveSummary, prepareReportForEmbed, readSampleReportHtml } from "@/lib/hosted-reports";
import { SampleReportJsonLd } from "./sample-jsonld";

const SAMPLE_PATH = "/reports/sample-competitive-fee-position";
const SAMPLE_PDF_PATH = "/reports/sample-competitive-fee-position.pdf";
const REQUEST_HREF = "/for-institutions#report";
const REPORT_TITLE = "Sample Competitive Fee Position Report";
const REPORT_DESCRIPTION = `An anonymized ${REPORT_OFFER.name} for a ~$400M community bank: its fees against a verified peer set, the lines outside the market range, the revenue lens, and eight named peers. ${REPORT_OFFER_LINE}.`;

export const metadata: Metadata = {
  title: REPORT_TITLE,
  description: `See what the free ${REPORT_OFFER.name} from ${SITE_NAME} contains: your fees against a verified peer set, the lines outside the market range, the revenue lens, and a named peer comparison. Delivered in 48 hours.`,
  alternates: { canonical: SAMPLE_PATH },
  robots: { index: true, follow: true },
  openGraph: {
    type: "article",
    title: REPORT_TITLE,
    description: REPORT_DESCRIPTION,
    url: `${SITE_URL}${SAMPLE_PATH}`,
    siteName: SITE_NAME,
  },
};

const SECTIONS = [
  "Executive summary — three findings that matter",
  "Position map — every fee against the peer cohort",
  "Divergences — where you sit above or below the market",
  "Revenue lens — posted price against Call Report income",
  "Named peer comparison on the headline fees",
  "Methodology, provenance, and the full published schedule",
];

const PRIMARY_BUTTON =
  "inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]";
const SECONDARY_BUTTON =
  "inline-flex items-center rounded-md border border-[#D5CBBF] px-4 py-2.5 text-sm font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]";

export default function SampleReportPage() {
  const rawHtml = readSampleReportHtml();
  const html = prepareReportForEmbed(rawHtml);
  const summary = extractExecutiveSummary(rawHtml);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14">
      <SampleReportJsonLd
        title={REPORT_TITLE}
        description={REPORT_DESCRIPTION}
        pagePath={SAMPLE_PATH}
        pdfPath={SAMPLE_PDF_PATH}
        summary={summary}
      />

      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[12px] text-[#6B6255]">
        <Link href="/reports" className="transition-colors hover:text-[#1A1815]">
          Reports
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347]">Sample</span>
      </nav>

      <header className="grid gap-8 border-b border-[#E0D7C9] pb-10 md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
            Sample — {REPORT_OFFER.name}
          </p>
          <h1
            className="text-[2rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815] sm:text-[2.5rem]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            This is what your free report looks like.
          </h1>
          <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-[#5A5347]">
            Yours is built for your institution and your peer set, delivered in 48 hours. The report
            below was prepared for a real ~$400M community bank; only the client is anonymized, shown
            as Sample Community Bank. The eight peers are named — their fee schedules are public
            disclosures — and every figure is real, drawn from published fee schedules and public
            Call Reports.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href={SAMPLE_PDF_PATH} className={PRIMARY_BUTTON} download>
              Download the sample (PDF)
            </a>
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "sample_report_header" }}
              href={REQUEST_HREF}
              className={SECONDARY_BUTTON}
            >
              {REPORT_OFFER.ctaLabel}
            </TrackLink>
          </div>
          <p className="mt-3 text-[13px] text-[#6B6255]">{REPORT_OFFER_LINE}.</p>
        </div>

        <aside className="rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            What the report contains
          </p>
          <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-[#3D3830]">
            {SECTIONS.map((section, index) => (
              <li key={section} className="flex gap-3">
                <span className="tabular-nums text-[#C44B2E]">{String(index + 1).padStart(2, "0")}</span>
                <span>{section}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] leading-relaxed text-[#6B6255]">
            Prepared by {RESEARCH_IMPRINT}. {REPORT_OFFER.refreshLabel}. Questions:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#5A5347] underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </aside>
      </header>

      <div className="pt-10">
        <ReportExecutiveSummaryBlock summary={summary} heading="Executive summary — Sample Community Bank" />
      </div>

      <section className="pt-8" aria-label="Sample report">
        <ReportFrame html={html} title={REPORT_TITLE} pdfHref={SAMPLE_PDF_PATH} />
      </section>

      <section className="mt-10 flex flex-col items-start gap-4 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p
            className="text-[20px] text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Get this report for your institution.
          </p>
          <p className="mt-1 text-[13px] text-[#6B6255]">{REPORT_OFFER_LINE}. {REPORT_OFFER.refreshLabel}.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "sample_report_footer" }}
            href={REQUEST_HREF}
            className={PRIMARY_BUTTON}
          >
            {REPORT_OFFER.ctaLabel}
          </TrackLink>
          <a href={SAMPLE_PDF_PATH} className={SECONDARY_BUTTON} download>
            Download the sample (PDF)
          </a>
        </div>
      </section>
    </div>
  );
}
