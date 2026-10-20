import { SITE_URL } from "@/lib/constants";

export const CHECK_TITLE = "Check a Bank's Fees Against the Market";
export const CHECK_DESCRIPTION =
  "Name a bank or credit union to see its published fees beside the U.S. and state medians, each linked to its own fee schedule.";
export const CHECK_URL = `${SITE_URL}/check`;

// Describe the tool, not any individual answer: query/result URLs use the base canonical
// and noindex, and an institution with sparse evidence may have no comparison to show.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${CHECK_URL}#webpage`,
  url: CHECK_URL,
  name: CHECK_TITLE,
  description: CHECK_DESCRIPTION,
  inLanguage: "en",
  isAccessibleForFree: true,
  mainEntity: {
    "@type": "WebApplication",
    "@id": `${CHECK_URL}#application`,
    url: CHECK_URL,
    name: "Fee Check",
    description: CHECK_DESCRIPTION,
    applicationCategory: "FinanceApplication",
    inLanguage: "en",
    isAccessibleForFree: true,
    audience: { "@type": "Audience", audienceType: "Consumers" },
  },
};

export function CheckJsonLd() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />;
}
