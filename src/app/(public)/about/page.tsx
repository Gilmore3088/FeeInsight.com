/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown
 * invalidates the public read cache its reads carry (#1811). The page reads no session,
 * cookies or search params; the header's signed-in parts are client islands. A render
 * with a failed read is cached for a minute instead (`shortenPageLife`, as the homepage).
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { CONTACT_EMAIL, LEGAL_ENTITY_LINE, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { ABOUT_BLOCKS, aboutNextAction, aboutProof } from "./about-view";
import { AboutBlocks, AboutContact, AboutHero, AboutNextAction } from "./about-sections";

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
  const [summary, sample] = await Promise.all([
    getPublicStatsSummary().catch(() => null),
    loadSampleReport().then(
      (report) => ({ live: report !== null, failed: false }),
      () => ({ live: false, failed: true }),
    ),
  ]);
  if (!summary?.complete || sample.failed) await shortenPageLife();
  const sampleLive = sample.live;
  const proof = summary ? aboutProof(summary) : { figures: [], publishedShare: null, freshness: null };

  return (
    <div className="bg-paper">
      <AboutHero proof={proof} />
      <div className="mx-auto max-w-page space-y-10 px-4 py-10 sm:px-6 sm:py-14">
        <AboutBlocks blocks={ABOUT_BLOCKS} />
        <AboutNextAction action={aboutNextAction(sampleLive)} />
        <AboutContact email={CONTACT_EMAIL} legalLine={LEGAL_ENTITY_LINE} />
      </div>
    </div>
  );
}
