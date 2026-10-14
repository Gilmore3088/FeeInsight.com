import { REPORT_OFFER } from "@/lib/constants";
import { CONTAINER, H2, LEAD } from "./look";
import { SampleReportForm } from "./sample-report-form";
import { SAMPLE_REPORT_PAGE_COUNT } from "./home-stats";

/**
 * Pages 1 to 3 of public/reports/sample-competitive-fee-position.pdf, rendered with
 * pdftoppm at 150 dpi and saved at 1200px wide (AVIF first, WebP for every other browser).
 * Re-render them whenever the sample PDF changes.
 */
export const SAMPLE_PAGES = [
  { stem: "/reports/sample-preview/page-1", label: "Cover" },
  { stem: "/reports/sample-preview/page-2", label: "Summary of findings" },
  { stem: "/reports/sample-preview/page-3", label: "Benchmark page: each fee against the peer range" },
] as const;

const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 1553;

/** The report: one headline, one sentence, the email form, then the three real pages. */
export function HomeReport() {
  return (
    <section id="sample-report" aria-labelledby="sample-report-title" className="scroll-mt-20 bg-white">
      <div className={`${CONTAINER} py-14 sm:py-20`}>
        <div className="max-w-2xl">
          <h2 id="sample-report-title" className={H2}>
            The report your board will actually read
          </h2>
          <p className={`mt-4 ${LEAD}`}>
            The {REPORT_OFFER.name} puts your published fees beside named competitors&apos;, marks each
            one above, inside or below the market range, and cites the document, page and date behind every figure.
          </p>
          <div className="mt-7">
            <SampleReportForm />
          </div>
        </div>
        <SampleSpread />
      </div>
    </section>
  );
}

/**
 * One static fanned spread: page 1 in front, pages 2 and 3 behind it. The fan is a
 * transform on each page, so the images stay plain files that lazy-load at their real
 * size; on phones the three pages sit in a row instead.
 */
function SampleSpread() {
  return (
    <figure className="mt-12 sm:mt-16">
      <div className="rounded-[8px] bg-index-cloud px-4 pb-6 pt-8 sm:px-10 sm:pb-10 sm:pt-12">
        <ul className="grid grid-cols-3 gap-3 sm:gap-5 lg:relative lg:mx-auto lg:block lg:h-[560px] lg:max-w-4xl">
          {SAMPLE_PAGES.map((page, index) => (
            <li key={page.stem} className={`min-w-0 ${FAN[index]}`}>
              <picture>
                <source srcSet={`${page.stem}.avif`} type="image/avif" />
                <img
                  src={`${page.stem}.webp`}
                  alt={`Sample report, page ${index + 1} of ${SAMPLE_REPORT_PAGE_COUNT}: ${page.label}`}
                  width={PAGE_WIDTH}
                  height={PAGE_HEIGHT}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full rounded-[4px] bg-white shadow-[0_2px_4px_rgba(14,26,43,0.08),0_24px_40px_-20px_rgba(14,26,43,0.5)] ring-1 ring-index-line"
                />
              </picture>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 font-mono text-[12px] text-index-muted">
        Sample report, pages 1 to 3 of {SAMPLE_REPORT_PAGE_COUNT}
      </figcaption>
    </figure>
  );
}

/** Desktop fan: page 1 in front and level, 2 and 3 behind it, each turned a little. */
const FAN = [
  "lg:absolute lg:left-1/2 lg:top-0 lg:z-30 lg:w-[400px] lg:-translate-x-1/2",
  "lg:absolute lg:left-1/2 lg:top-8 lg:z-20 lg:w-[360px] lg:-translate-x-[118%] lg:-rotate-6",
  "lg:absolute lg:left-1/2 lg:top-8 lg:z-10 lg:w-[360px] lg:translate-x-[18%] lg:rotate-6",
] as const;
