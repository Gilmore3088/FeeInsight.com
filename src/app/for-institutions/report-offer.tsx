import Image from "next/image";
import Link from "next/link";
import { REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { SAMPLE_REPORT_HREF, SANS } from "@/app/landing-shared";
import { EYEBROW, SECTION_H2, SECTION_INNER } from "./section-styles";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { ReportFormLink } from "./report-form-link";

/**
 * The paid report as the no-subscription option (site v3 brief 03 section 4, 08 B.10). `#report`
 * is linked from sent emails, /subscribe history and the /waitlist redirect, so the anchor stays;
 * the form itself lives on /reports (05 section 3-4), and this section links to it. The pages
 * shown are the committed sample report's own (the same images /subscribe shows).
 */
export function ReportOfferSection({ sampleLive }: { sampleLive: boolean }) {
  return (
    <section id="report" aria-labelledby="report-heading" className="scroll-mt-20 border-b border-border bg-surface-0">
      <div className={`${SECTION_INNER} grid gap-10 lg:grid-cols-2 lg:items-center`}>
        <div>
          <p className={EYEBROW}>One report</p>
          <h2 id="report-heading" className={`mt-3 ${SECTION_H2}`} style={SANS}>
            {REPORT_OFFER.name}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            Your fees against named local competitors in one PDF, {REPORT_PRICE_INLINE}, with no subscription.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <ReportFormLink className="fi-btn fi-btn-secondary justify-center">
              {REPORT_OFFER.institutionCtaLabel}
            </ReportFormLink>
            {sampleLive ? (
              <Link href={SAMPLE_REPORT_HREF} className="text-[14px] font-semibold text-ink underline underline-offset-2">
                Read the full sample report
              </Link>
            ) : null}
          </div>
        </div>
        <SamplePages />
      </div>
    </section>
  );
}

/** The sample report's cover and findings page, as delivered. */
export function SamplePages() {
  return (
    <div className="relative mx-auto h-[300px] w-full max-w-[460px] sm:h-[340px]">
      <Image
        src={REPORT_SHOWCASE.pages[0].src}
        alt="Cover of the sample Competitive Fee Position report"
        width={850}
        height={1100}
        sizes="(min-width: 1024px) 220px, 45vw"
        className="absolute left-[4%] top-4 w-[46%] -rotate-2 rounded-sm shadow-[0_10px_30px_-12px_rgba(26,24,21,0.45)] ring-1 ring-border"
      />
      <Image
        src={REPORT_SHOWCASE.pages[1].src}
        alt="Summary of findings page from the sample report"
        width={850}
        height={1100}
        sizes="(min-width: 1024px) 240px, 50vw"
        className="absolute right-[4%] top-8 w-[50%] rotate-1 rounded-sm shadow-[0_14px_36px_-12px_rgba(26,24,21,0.5)] ring-1 ring-border"
      />
    </div>
  );
}
