import { H2 } from "@/components/public/site-look";
import { LandingLeadAction } from "./landing-lead-action";
import { LandingReportDocument } from "./landing-report-document";
import { LandingProductVideo } from "./landing-product-video";

/** Read the exact report offered by the download CTA. */
export function LandingWorkSamples() {
  return <section id="sample-work" aria-labelledby="work-samples-title">
    <div className="mx-auto max-w-page px-6 py-12 sm:py-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#A93D25]">See Hamilton in action</p><h2 id="work-samples-title" className={`mt-3 ${H2}`}>From your question to your report.</h2></div>
        <LandingLeadAction offer="sample" />
      </div>
      <LandingProductVideo />
      <p className="mt-3 text-xs text-[#6B6255]">30-second illustrative walkthrough using the actual sample report. Fictional institution and dated sample findings.</p>
      <details className="mt-6"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-[#A93D25]">Read the complete 10-page sample report</summary><div className="mt-3"><LandingReportDocument /></div></details>
    </div>
  </section>;
}
