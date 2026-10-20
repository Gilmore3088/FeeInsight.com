/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown invalidates
 * the public read cache its reads carry. During `next build` its reads get 15 s
 * (`readOnRequest`): a busy database held its build-time reads past Next's 60-second page limit
 * (#1048). A render with a failed read, a late build read included, is cached for a minute
 * (`shortenPageLife`), so the first request after a deploy brings back the live figures.
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import {
  getPublicCategorySummaries,
  getPublicStatsSummary,
  UNAVAILABLE_LABEL,
  UNAVAILABLE_PUBLIC_STATS,
} from "@/lib/public-stats";
import { CONTACT_EMAIL, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { getStatsCached } from "@/lib/data-store/public-cached-reads";
import { COUNT_SHARED_SCHEDULE_ONCE } from "@/lib/data-store/fee-stats";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { readOnRequest } from "@/lib/build-phase";
import { computeRules, nextAction, pickExampleBenchmark, pipelineStages } from "./methodology-view";
import { ComputeRules, ContactLine, Limits, MedianExhibit, MethodologyHero, NextAction, PipelineFlow } from "./methodology-exhibits";

const METHODOLOGY_URL = `${SITE_URL}/methodology`;
const TITLE = `Methodology: how the ${PRODUCT_NAME} works`;
const DESCRIPTION =
  "How a bank or credit union fee goes from the institution's own schedule to a published, verified number, and how medians and ranges are computed.";

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: `How the ${PRODUCT_NAME} works`,
  description: DESCRIPTION,
  url: METHODOLOGY_URL,
  datePublished: "2026-04-06T00:00:00Z",
  author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
};

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: METHODOLOGY_URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: METHODOLOGY_URL,
    siteName: SITE_NAME,
    type: "article",
    publishedTime: "2026-04-06T00:00:00Z",
    authors: [SITE_NAME],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/** A count from the shared snapshot, or null when its read failed (its label is then UNAVAILABLE_LABEL). */
function liveCount(value: number, label: string): number | null {
  return label === UNAVAILABLE_LABEL ? null : value;
}

export default async function MethodologyPage() {
  // Every read is served from the public cache between publishes; a failed read hides its number.
  const [summary, categories, collection, sampleLive] = await readOnRequest(
    () =>
      Promise.all([
        getPublicStatsSummary(),
        getPublicCategorySummaries(),
        getStatsCached().catch(() => null),
        sampleReportAvailable().catch(() => false),
      ]),
    [UNAVAILABLE_PUBLIC_STATS, [], null, false],
  );
  if (!summary.complete || categories.length === 0 || !collection) await shortenPageLife();

  const stages = pipelineStages({
    monitored: liveCount(summary.monitored, summary.monitoredLabel),
    scheduleLinks: collection?.with_fee_url ?? null,
    institutions: liveCount(summary.institutions, summary.institutionsLabel),
    observations: liveCount(summary.observations, summary.observationsLabel),
  });
  const example = pickExampleBenchmark(categories);

  return (
    <div className="bg-paper">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <MethodologyHero freshnessLabel={summary.freshnessLabel} />

      <div className="mx-auto max-w-page space-y-14 px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-3xl">
          <PipelineFlow stages={stages} />
        </div>

        <section aria-labelledby="compute-heading" id="compute" className="scroll-mt-24">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">How it is computed</p>
            <h2
              id="compute-heading"
              className="mt-1.5 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]"
              style={{ fontFamily: "var(--fi-font-sans)" }}
            >
              One rule set behind every figure
            </h2>
          </div>
          <div
            className={`mt-5 grid gap-5 ${example ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start" : "max-w-3xl"}`}
          >
            {example && <MedianExhibit example={example} freshnessLabel={summary.freshnessLabel} />}
            <ComputeRules rules={computeRules(COUNT_SHARED_SCHEDULE_ONCE)} />
          </div>
        </section>

        <Limits />

        <NextAction action={nextAction(sampleLive)} />

        <ContactLine email={CONTACT_EMAIL} />
      </div>
    </div>
  );
}
