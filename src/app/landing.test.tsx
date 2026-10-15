import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { LandingHero } from "./landing-hero";
import { LandingSizzle } from "./landing-sizzle";
import { LandingPillars } from "./landing-pillars";
import { LandingProvenance } from "./landing-provenance";
import { LandingPricing } from "./landing-pricing";
import { LandingFaq, faqItems } from "./landing-faq";
import { LandingClose } from "./landing-close";
import { buildHomeData, buildSampleView } from "./landing-shared";
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
const ladder = {
  institutionName: "Sample Bank",
  feeLabel: "Overdraft (per item)",
  value: 10,
  rows: [
    { label: "Local competitors", min: 15, q1: 22.5, median: 29.5, q3: 35, max: 36, institutions: 8 },
    { label: "The nation", min: 0, q1: 25, median: 30, q3: 33, max: 50, institutions: 2493 },
  ],
};
const data = buildHomeData(summary, categories, districts, {
  sample: buildSampleView(report),
  ladder,
  scenario: buildScenario("Overdraft", categories[0]),
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const words = (html: string) => text(html).split(" ").filter((w) => /[A-Za-z0-9$]/.test(w)).length;

const wholePage = () =>
  renderToStaticMarkup(
    <>
      <LandingHero summary={summary} />
      <LandingSizzle data={data} />
      <LandingPillars data={data} />
      <LandingProvenance summary={summary} />
      <LandingPricing />
      <LandingFaq summary={summary} />
      <LandingClose />
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

  it("keeps the hero to the promise, one sentence, the search, live microcopy and working chips", () => {
    const html = renderToStaticMarkup(<LandingHero summary={summary} />);
    expect(html).toMatch(/<form[^>]*action="\/institutions"[^>]*method="get"/);
    expect(html).toContain('name="q"');
    const t = text(html);
    expect(t).toContain("Know where your fees stand, with a source for every figure");
    expect(t).toContain("1,234 institutions with published fees · Data refreshed Oct 14, 2026");
    expect(t).toContain("Hamilton, the Fee Insight Pro workspace");
    expect(html).not.toContain("text-brick");
    for (const href of ["/fees/overdraft", "/research/national-fee-index", "/subscribe"]) expect(html).toContain(`href="${href}"`);
    expect(t).not.toContain(REPORT_PRICE_INLINE);
    const unavailable = text(renderToStaticMarkup(<LandingHero summary={{ ...summary, institutionsLabel: "—" }} />));
    expect(unavailable).not.toContain("institutions with published fees");
  });

  it("server-renders the sizzle's composed end frame with all four chapters", () => {
    const html = renderToStaticMarkup(<LandingSizzle data={data} />);
    for (const label of ["Every fee", "Every market", "One workspace", "Reports"]) expect(html).toContain(label);
    expect(html).toContain('data-motion="off"');
    expect(html).toMatch(/id="sizzle-reports"[^>]*aria-hidden="false"/);
    expect(html).not.toContain("Watch the tour");
    expect(renderToStaticMarkup(<LandingSizzle data={buildHomeData(summary, [], null)} />)).toBe("");
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

  it("shows the provenance steps as one strip, with its count only where a live field exists", () => {
    const t = text(renderToStaticMarkup(<LandingProvenance summary={summary} />));
    for (const step of ["Schedule read", "Fee recorded", "Checked against source", "Published"]) expect(t).toContain(step);
    expect(t).toContain("5,678 fee entries from 1,234 institutions");
    const failed = text(renderToStaticMarkup(<LandingProvenance summary={{ ...summary, observationsLabel: "—" }} />));
    expect(failed).not.toMatch(/fee entries/);
    expect(t).not.toMatch(/rolling calendar|every month/i);
  });

  it("quotes only source lines that pass the shared check, and never a neighbouring fee", () => {
    expect(data.sample?.fees.map((f) => f.key)).toEqual(["overdraft", "wire_intl_outgoing", "stop_payment"]);
    const t = text(renderToStaticMarkup(<LandingPillars data={data} />));
    expect(t).toContain("Outgoing International Wires … $40.00/ea");
    expect(t).not.toMatch(/Zipper|Lost Key|Over \$300|Statement Printout/);
  });

  it("draws a different exhibit in each pillar and each sizzle chapter", () => {
    const pillars = renderToStaticMarkup(<LandingPillars data={data} />);
    // Every market is the ladder; One workspace answers in figures, with no box plot.
    expect(pillars).toContain("Sample Bank");
    expect(pillars.match(/aria-label="Local competitors: market/g)?.length).toBe(1);
    expect(pillars).not.toContain("the nation: market");
    const sizzle = renderToStaticMarkup(<LandingSizzle data={data} />);
    expect(sizzle).toContain("Try a price");
    expect(text(sizzle)).toContain("Sample Bank against 15 local competitors");
    const ask = renderToStaticMarkup(<LandingSizzle data={data} workspace="ask" topPadding />);
    expect(ask).not.toContain("Scenario price");
    expect(ask).toContain("pt-16");
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
    const html = wholePage();
    expect(text(html)).not.toMatch(/—|!|real-time|recommend|\bAI\b|verified|99%/i);
    // The markup holds all four sizzle chapters (three hidden), every figure and every label, and
    // still stays under the old page's 889 visible words; the visible count is far lower.
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
      "upgrade_click home_hero /subscribe See Hamilton plans",
      "upgrade_click home_workspace /subscribe See Hamilton plans",
      "contact_sales home_workspace_demo /contact?source=demo Or ask for a demo",
      "upgrade_click home_pricing /subscribe See Hamilton plans",
      "contact_sales home_pricing_demo /contact?source=demo Or ask for a demo",
      "upgrade_click home_closing /subscribe See Hamilton plans",
    ]);
  });
});
