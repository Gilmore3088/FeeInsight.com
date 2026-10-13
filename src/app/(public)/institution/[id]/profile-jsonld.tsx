import { SITE_NAME, SITE_URL } from "@/lib/constants";

/**
 * Structured data for the public institution profile: a page by Fee Insight about the bank, not
 * the bank's own page (a FinancialService with the bank's name read as if the bank published it).
 */
export function InstitutionJsonLd({
  institutionId,
  institutionName,
  city,
  stateCode,
}: {
  institutionId: number;
  institutionName: string;
  city: string | null;
  stateCode: string | null;
}) {
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${institutionName} fees`,
    description: `Published fees and fee schedule for ${institutionName}`,
    url: `${SITE_URL}/institution/${institutionId}`,
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    about: {
      "@type": "BankOrCreditUnion",
      name: institutionName,
      address: stateCode
        ? { "@type": "PostalAddress", addressLocality: city ?? undefined, addressRegion: stateCode }
        : undefined,
    },
  }).replace(/</g, "\\u003c");

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
