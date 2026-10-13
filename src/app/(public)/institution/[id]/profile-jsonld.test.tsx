import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE_NAME } from "@/lib/constants";
import { InstitutionJsonLd } from "./profile-jsonld";

describe("InstitutionJsonLd (#1166)", () => {
  it("describes our page about the bank, not the bank's own page", () => {
    const html = renderToStaticMarkup(
      <InstitutionJsonLd institutionId={1} institutionName="First Example Bank" city="Austin" stateCode="TX" />,
    );
    const json = JSON.parse(html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
    expect(json["@type"]).toBe("WebPage");
    expect(json.publisher.name).toBe(SITE_NAME);
    expect(json.about).toMatchObject({
      "@type": "BankOrCreditUnion",
      name: "First Example Bank",
      address: { addressLocality: "Austin", addressRegion: "TX" },
    });
  });
});
