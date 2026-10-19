export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
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
  const [summary, sampleLive] = await Promise.all([
    getPublicStatsSummary().catch(() => null),
    sampleReportAvailable().catch(() => false),
  ]);
  const proof = summary ? aboutProof(summary) : { figures: [], publishedShare: null, freshness: null };

  // James's order (Oct 19): purpose, the two products, the evidence, the founder, coverage, then the sample report.
  return (
    <div className="bg-paper">
      <AboutHero />
      <div className="mx-auto max-w-page space-y-12 px-4 py-10 sm:px-6 sm:py-14">
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
