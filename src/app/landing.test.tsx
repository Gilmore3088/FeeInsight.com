import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import { LandingHero } from "./landing-hero";
import { LandingProof } from "./landing-proof";
import { LandingEveryFee, LandingEveryMarket, LandingOneWorkspace } from "./landing-pillars";
import { LandingPricing } from "./landing-pricing";
import { LandingFaq } from "./landing-faq";
import { LandingClose } from "./landing-close";
import { nationalRange } from "./landing-shared";

const summary = {
  institutionsLabel: "1,234",
  observationsLabel: "5,678",
  categoriesLabel: "40",
  statesLabel: "50",
  refreshedOn: "Oct 14, 2026",
  freshnessLabel: "Data refreshed Oct 14, 2026",
};

function category(fee_category: string, overrides: Partial<FeeCategorySummary> = {}): FeeCategorySummary {
  return {
    fee_category,
    institution_count: 321,
    total_observations: 400,
    min_amount: 0,
    max_amount: 38,
    avg_amount: 26,
    median_amount: 29,
    p25_amount: 25,
    p75_amount: 32,
    bank_count: 200,
    cu_count: 121,
    zero_count: 10,
    bank_median_amount: 30,
    cu_median_amount: 27,
    ...overrides,
  } as FeeCategorySummary;
}

const categories = [category("overdraft"), category("nsf"), category("monthly_maintenance")];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("homepage (site v3, Direction A)", () => {
  it("shows the live counts in the hero microcopy and the sample chip only while the sample is live", () => {
    const overdraft = nationalRange(categories, "overdraft");
    const off = text(renderToStaticMarkup(<LandingHero summary={summary} overdraft={overdraft} sampleLive={false} />));
    expect(off).toContain("1,234 institutions with published fees · Data refreshed Oct 14, 2026. Free to search.");
    expect(off).toContain("National range · 321 institutions · Data refreshed Oct 14, 2026");
    expect(off).toContain(REPORT_PRICE_INLINE);
    expect(off).not.toContain("Sample competitive report");
    const on = renderToStaticMarkup(<LandingHero summary={summary} overdraft={overdraft} sampleLive />);
    expect(on).toContain("/reports/sample-competitive-fee-position");
  });

  it("submits the search to /institutions?q= and skips a range with a missing figure", () => {
    const html = renderToStaticMarkup(
      <LandingHero summary={summary} overdraft={nationalRange([category("overdraft", { p25_amount: null })], "overdraft")} sampleLive={false} />,
    );
    expect(html).toMatch(/<form[^>]*action="\/institutions"[^>]*method="get"/);
    expect(html).toContain('name="q"');
    expect(html).not.toContain("National range");
  });

  it("renders Pro prices from PRO_TIERS", () => {
    const html = text(renderToStaticMarkup(<LandingPricing />));
    for (const tier of PRO_TIERS) {
      expect(html).toContain(tier.assetsLabel);
      expect(html).toContain(tierPriceLabel(tier.key, "monthly"));
    }
  });

  it("keeps the copy rules: no em dashes, exclamation marks or banned words", () => {
    const html = text(
      renderToStaticMarkup(
        <>
          <LandingHero summary={summary} overdraft={nationalRange(categories, "overdraft")} sampleLive />
          <LandingProof summary={summary} />
          <LandingEveryFee categories={categories} summary={summary} />
          <LandingEveryMarket overdraft={nationalRange(categories, "overdraft")} summary={summary} />
          <LandingOneWorkspace />
          <LandingPricing />
          <LandingFaq summary={summary} />
          <LandingClose />
        </>,
      ),
    );
    expect(html).not.toMatch(/—|!|real-time|recommend|\bAI\b|verified|99%/i);
  });
});
