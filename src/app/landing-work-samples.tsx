import { H2 } from "@/components/public/site-look";
import { LandingLeadAction } from "./landing-lead-action";
import { LandingReportDocument } from "./landing-report-document";

/** Read the exact report offered by the download CTA. */
export function LandingWorkSamples() {
  return <section id="sample-work" aria-labelledby="work-samples-title">
    <div className="mx-auto max-w-page px-6 py-12 sm:py-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#A93D25]">Read the sample</p><h2 id="work-samples-title" className={`mt-3 ${H2}`}>The complete report. All ten pages.</h2></div>
        <LandingLeadAction offer="sample" />
      </div>
      <LandingReportDocument />
    </div>
  </section>;
}
