/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown
 * invalidates the public read cache its reads carry (#1811). The page reads no session,
 * cookies or search params; the header's signed-in parts are client islands. A render
 * with a failed read is cached for a minute instead (`shortenPageLife`, as the homepage).
 * `next build` renders it without the database (`readOnRequest`), as such a render: a busy
 * database held its build-time reads past Next's 60-second page limit (#1048).
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import { PAGE_HERO_WRAP } from "@/components/public/page-hero";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { readOnRequest } from "@/lib/build-phase";
import { CONTACT_EMAIL, LEGAL_ENTITY_LINE, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { aboutNextAction, aboutProof } from "./about-view";
import {
  AboutCoverage,
  AboutEvidence,
  AboutFounder,
  AboutHero,
  AboutLegal,
  AboutNextAction,
  AboutProducts,
} from "./about-sections";

const ABOUT_URL = `${SITE_URL}/about`;
const DESCRIPTION = `${SITE_NAME} publishes the ${PRODUCT_NAME}: what U.S. banks and credit unions charge, read from each institution's own fee schedule.`;

export const metadata: Metadata = {
  title: "About",
  description: DESCRIPTION,
  alternates: { canonical: ABOUT_URL },
  openGraph: { title: `About ${SITE_NAME}`, description: DESCRIPTION, url: ABOUT_URL, siteName: SITE_NAME, type: "website" },
};

export default async function AboutPage() {
  // Both reads come from the public cache; a failed read hides its number or falls back to the request form.
  const [summary, sample] = await readOnRequest(
    () =>
      Promise.all([
        getPublicStatsSummary().catch(() => null),
        loadSampleReport().then(
          (report) => ({ live: report !== null, failed: false }),
          () => ({ live: false, failed: true }),
        ),
      ]),
    [null, { live: false, failed: true }],
  );
  if (!summary?.complete || sample.failed) await shortenPageLife();
  const sampleLive = sample.live;
  const proof = summary ? aboutProof(summary) : { figures: [], publishedShare: null, freshness: null };

  // James's order (Oct 19): purpose, the two products, the evidence, the founder, coverage, then the sample report.
  return (
    <div className="bg-paper">
      <AboutHero />
      <div className={`${PAGE_HERO_WRAP} space-y-12 py-10 sm:py-14`}>
        <AboutProducts />
        <AboutEvidence />
        <AboutFounder email={CONTACT_EMAIL} />
        <AboutCoverage proof={proof} />
        <AboutNextAction action={aboutNextAction(sampleLive)} />
        <AboutLegal legalLine={LEGAL_ENTITY_LINE} />
      </div>
    </div>
  );
}
