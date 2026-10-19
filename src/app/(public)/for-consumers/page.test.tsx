import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/constants";

vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));
vi.mock("../institutions/search-bar", () => ({ InstitutionSearchBar: () => null }));
vi.mock("@/components/public/consumer-market-lookup", () => ({ ConsumerMarketLookup: () => null }));

import ForConsumersPage, { metadata } from "./page";

function renderedPage() {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(<ForConsumersPage />), "text/html");
  const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((script) => JSON.parse(script.textContent ?? ""));
  return { document, structuredData };
}

describe("consumer hub structured data", () => {
  it("describes the canonical free consumer collection and preserves its breadcrumbs", () => {
    const { structuredData } = renderedPage();
    expect(structuredData.map((item) => item["@type"])).toEqual(["BreadcrumbList", "CollectionPage"]);
    const [breadcrumbs, collection] = structuredData;
    expect(collection).toMatchObject({
      "@context": "https://schema.org",
      "@id": `${SITE_URL}/for-consumers#webpage`,
      url: metadata.alternates?.canonical,
      name: metadata.title,
      description: metadata.description,
      inLanguage: "en",
      isAccessibleForFree: true,
      audience: { "@type": "Audience", audienceType: "Consumers" },
    });
    expect(breadcrumbs.itemListElement.map((item: { item: string }) => item.item))
      .toEqual([`${SITE_URL}/`, collection.url]);
  });

  it("keeps every structured guide in the same order as the visible links, without upcoming tools", () => {
    const { document, structuredData } = renderedPage();
    const collection = structuredData.find((item) => item["@type"] === "CollectionPage");
    const list = collection.mainEntity;
    const visibleGuides = Array.from(document.querySelectorAll('#consumer-guides li > a'))
      .map((link, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "WebPage",
          url: new URL(link.getAttribute("href") ?? "", SITE_URL).href,
          name: link.querySelector("h3")?.textContent,
          description: link.querySelector("p")?.textContent,
        },
      }));
    expect(visibleGuides).toHaveLength(10);
    expect(list).toMatchObject({
      "@type": "ItemList",
      "@id": `${SITE_URL}/for-consumers#consumer-guides`,
      numberOfItems: visibleGuides.length,
      itemListElement: visibleGuides,
    });
    expect(list.itemListElement.map((entry: { item: { url: string } }) => entry.item.url))
      .not.toContain(`${SITE_URL}/check`);
    expect(JSON.stringify(structuredData)).not.toMatch(/Fee Check|FAQPage|SoftwareApplication|Offer/);
  });
});
