import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { LandingHero } from "./landing-hero";
import { LandingProducts } from "./landing-products";
import { sampleShowcaseRow, sampleWorkflowReport } from "./landing-workflow.test-fixture";
import { LandingHamilton } from "./landing-hamilton";
import { parseShowcaseAnswer } from "./landing-hamilton-answer";
import { LandingPricing } from "./landing-pricing";
import { LandingFaq, faqItems } from "./landing-faq";
import { buildHomeData, buildSampleView, homeReadsCacheable } from "./landing-shared";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { buildScenario } from "./subscribe/scenario";

// TrackLink as a plain anchor that shows its event, so the markup says what each click records.
vi.mock("@/components/track-link", () => ({
  TrackLink: ({ event, eventProps, href, children, className }: {
    event: string; eventProps?: { placement?: string }; href: string; children: React.ReactNode; className?: string;
  }) => (
    <a href={href} className={className} data-event={event} data-placement={eventProps?.placement}>
      {children}
    </a>
  ),
}));

const summary: PublicStatsSummary = {
  institutions: 1234,
  institutionsLabel: "1,234",
  monitored: 4321,
  monitoredLabel: "4,321",
  observations: 5678,
  observationsLabel: "5,678",
  categories: 40,
  categoriesLabel: "40",
  states: 50,
  statesLabel: "50",
  refreshedOn: "Oct 14, 2026",
  freshnessLabel: "Data refreshed Oct 14, 2026",
  complete: true,
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

function district(n: number, overrides: Partial<DimensionBreakdown> = {}): DimensionBreakdown {
  return { dimension_value: `District ${n}`, count: 40, min_amount: 5, max_amount: 44, avg_amount: 28, median_amount: 27 + n / 4, ...overrides };
}

const categories = [category("overdraft"), category("nsf"), category("monthly_maintenance"), category("stop_payment")];
const districts = [district(1), district(2, { count: 3, median_amount: null }), district(12, { median_amount: 25 })];
function reportLine(
  key: string,
  label: string,
  amount: number,
  fee_name: string,
  source_line: string,
  position: ReportLine["position"],
): ReportLine {
  return {
    key,
    label,
    own: { amount, fee_name, source_url: null, updated_at: null, schedule_read_on: "2026-10-08", source_line },
    peers: { n: 9, p25: 20, median: 25, p75: 30, min: 10, max: 40 },
    comparable: true,
    position,
    percentile: 50,
    chargingLess: 4,
    peerFigures: [],
  };
}

// The sample's stored source rows can carry a neighbouring fee; only the cell that states the fee shows.
const report = {
  data: { subject: { institution_name: "Sample Bank", state_code: "MI", charter_type: "bank" } },
  analysis: {
    readiness: { competitorsWithData: 15 },
    lines: [
      reportLine("overdraft", "Overdraft (per item)", 10, "Overdraft (items paid)", "Overdraft (items paid)…… $10.00 | Lost Key…… $25.00", "below_market"),
      reportLine("wire_intl_outgoing", "Outgoing international wire", 40, "Outgoing International Wires", "Zipper Bags (Small)…… $4.00 | Outgoing International Wires…… $40.00/ea", "below_market"),
      reportLine("stop_payment", "Stop payment", 35, "Stop Payment", "Stop Payment…… $35.00 | Over $300 USD…… $40.00", "above_market"),
      reportLine("cashiers_check", "Cashier's check", 4, "Cashier's Checks", "Activity/Statement Printout…… $5.00", "in_market"),
    ],
  },
} as unknown as MarketReport;
const data = buildHomeData(summary, categories, districts, {
  sample: buildSampleView(report),
  scenario: buildScenario("Overdraft", categories[0]),
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const words = (html: string) => text(html).split(" ").filter((w) => /[A-Za-z0-9$]/.test(w)).length;

const wholePage = () =>
  renderToStaticMarkup(
    <>
      <LandingHero />
      <LandingProducts data={data} summary={summary} />
      <LandingHamilton report={sampleWorkflowReport()} answer={parseShowcaseAnswer(sampleShowcaseRow())} />
      <LandingPricing />
      <LandingFaq summary={summary} />
    </>,
  );

describe("homepage (site v3 brief 06 §4.3)", () => {
  it("builds every exhibit figure from live reads, with thin districts left without a median", () => {
    expect(data.lines.map((line) => line.key)).toEqual(["overdraft", "nsf", "stop_payment", "monthly_maintenance"]);
    expect(data.overdraft?.median_amount).toBe(29);
    expect(data.districts.map((d) => [d.name, d.median])).toEqual([
      ["Boston", 27.25],
      ["New York", null],
      ["San Francisco", 25],
    ]);
    expect(buildHomeData(summary, [category("overdraft", { p25_amount: null })], null).overdraft).toBeNull();
  });

  it("leads with James's promise and two actions, nothing else", () => {
    const html = renderToStaticMarkup(<LandingHero />);
    const t = text(html);
    expect(t).toContain("Your next fee review doesn't need to take weeks.");
    expect(t).not.toMatch(/cost thousands/);
    expect(t).toContain(
      "Fee Insight helps you compare your fees with competitors using the Bank Fee Index. Turn the evidence into analysis and board reports with Hamilton.",
    );
    expect(html).toMatch(/<a href="\/subscribe"[^>]*fi-btn-primary[^>]*data-event="upgrade_click" data-placement="home_hero">See plans</);
    expect(html).toMatch(/<a href="\/reports\/sample-competitive-fee-position"[^>]*>Explore a sample report</);
    // The search moved to the Bank Fee Index, out of the hero.
    expect(html).not.toContain("<form");
    expect(t).not.toContain(REPORT_PRICE_INLINE);
  });

  it("introduces the Index with the search and the map, then Hamilton in its own section", () => {
    const html = renderToStaticMarkup(<LandingProducts data={data} summary={summary} />);
    const t = text(html);
    const at = (marker: string) => html.indexOf(marker);
    expect(html).toMatch(/<h2 id="products-heading"[\s\S]*?<span class="sr-only">Bank Fee Index<\/span><\/h2>/);
    expect(html).not.toContain(">Hamilton</span>");
    // Index: search, live count, map with its ranking folded away.
    expect(html).toMatch(/<form[^>]*action="\/institutions"[^>]*method="get"/);
    expect(t).toContain("1,234 institutions · Data refreshed Oct 14, 2026");
    expect(at("<form")).toBeLessThan(at("data-district-map"));
    expect(html).toMatch(/data-district-takeaway=""/);
    expect(html).toContain('href="/methodology"');
    // The $9 sample answer and the separate report preview are gone.
    expect(html).not.toContain("data-example-question");
    expect(html).not.toContain("data-workflow-report");
    // Without a map: the Index stays, with no empty frame.
    const bare = renderToStaticMarkup(<LandingProducts data={buildHomeData(summary, [], null)} summary={summary} />);
    expect(bare).not.toContain("fi-window");
    expect(bare).toContain("<form");
    const page = wholePage();
    expect(page.indexOf('id="hamilton-heading"')).toBeGreaterThan(page.indexOf("data-district-map"));
  });

  it("renders Pro prices from PRO_TIERS with the report as one line", () => {
    const t = text(renderToStaticMarkup(<LandingPricing />));
    for (const tier of PRO_TIERS) {
      expect(t).toContain(tier.assetsLabel);
      expect(t).toContain(tierPriceLabel(tier.key, "monthly"));
    }
    expect(t).toContain(`Competitive Fee Position Report , ${REPORT_PRICE_INLINE}`);
    expect(renderToStaticMarkup(<LandingPricing />)).toContain("/reports?report=institution#request");
  });

  it("runs promise, the Index, Hamilton with its three steps, then plans and the FAQ", () => {
    const page = wholePage();
    const at = (marker: string) => page.indexOf(marker);
    expect(at("<h1")).toBeLessThan(at('id="products-heading"'));
    expect(at('id="products-heading"')).toBeLessThan(at('id="hamilton-heading"'));
    expect(at('id="hamilton-heading"')).toBeLessThan(at("data-workflow-report"));
    expect(at("data-workflow-report")).toBeLessThan(at('id="plans"'));
    expect(page).not.toContain("weeks of gathering");
    expect(page).toContain("Full Bank Fee Index access");
  });

  it("keeps at most five short FAQ answers", () => {
    const items = faqItems(summary);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const item of items) {
      const answer = text(renderToStaticMarkup(<>{item.a}</>));
      expect(answer.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the copy rules and the word budget", () => {
    // The report page is the report's own section, in its words; tables are names and figures, not copy.
    // Hamilton's three views are product output (the saved answer and the report), not page copy.
    const full = wholePage();
    const panels = full.lastIndexOf("<div", full.indexOf('role="tabpanel"'));
    const html = (full.slice(0, panels) + full.slice(full.lastIndexOf("<div", full.indexOf("data-hamilton-actions"))))
      .replace(/<table[\s\S]*?<\/table>/g, "");
    expect(text(html)).not.toMatch(/—|!|real-time|recommend|\bAI\b|verified|99%/i);
    // Under the old page's 889 words, with every reveal's contents counted.
    expect(words(html)).toBeLessThan(800);
    // No section paragraph runs past one sentence of about twenty words.
    for (const [, para] of html.matchAll(/<p class="mt-4 text-\[17px\][^"]*"[^>]*>(.*?)<\/p>/g)) {
      expect(text(para).split(" ").filter(Boolean).length).toBeLessThanOrEqual(20);
    }
  });

  it("tracks every Pro and demo click with its own placement", () => {
    const tracked = [...wholePage().matchAll(/<a href="([^"]+)"[^>]*data-event="([^"]+)" data-placement="([^"]+)">([^<]+)</g)].map(
      ([, href, event, placement, label]) => `${event} ${placement} ${href} ${label}`,
    );
    expect(tracked).toEqual([
      "upgrade_click home_hero /subscribe See plans",
      "upgrade_click home_hamilton /subscribe See Hamilton plans",
      "sample_report_click home_hamilton /reports/sample-competitive-fee-position Open the sample report",
      "upgrade_click home_pricing /subscribe See plans",
      "contact_sales home_pricing_demo /contact?source=demo Or ask for a demo",
    ]);
  });

  it("keeps a render out of the page cache when any read failed, but not when the sample is simply absent", () => {
    const ok = { summary, categories, sampleFailed: false, overdraftFailed: false };
    expect(homeReadsCacheable(ok)).toBe(true);
    expect(homeReadsCacheable({ ...ok, summary: { ...summary, complete: false } })).toBe(false);
    expect(homeReadsCacheable({ ...ok, categories: [] })).toBe(false);
    expect(homeReadsCacheable({ ...ok, sampleFailed: true })).toBe(false);
    expect(homeReadsCacheable({ ...ok, overdraftFailed: true })).toBe(false);
  });
});
