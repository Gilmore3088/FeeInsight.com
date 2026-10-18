// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { REPORT_OFFER } from "@/lib/constants";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_TIERS, tierAmountLabel } from "@/lib/pro-tiers";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { histogram, institutionsFor, statsFor } from "./(public)/fees/(index)/index-view";
import { LandingHero, LandingProof } from "./landing-hero";
import { LandingHamilton, analyzeAnswer, analyzePicks, positionCounts } from "./landing-hamilton";
import { HamiltonCarousel, type HamiltonSlide } from "./landing-hamilton-carousel";
import { buildIndexCard, plainFeeName } from "./landing-index";
import { IndexCard } from "./landing-index-card";
import { cardHref, cellBars, hasMedian, US } from "./landing-index-view";
import { LandingPricing, pricingLine } from "./landing-pricing";
import { EVIDENCE_GROUPS, EVIDENCE_OUTPUTS } from "./landing-research";
import { LandingDeliverable, deliverableCover, deliverableOutline } from "./landing-deliverable";
import type { RevenueContext } from "@/lib/custom-report/revenue-context";
import { LandingResearch } from "./landing-research-section";
import { buildSampleView, homeReadsCacheable } from "./landing-shared";
import { sampleWorkflowReport } from "./landing-workflow.test-fixture";

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

/** Made-up published rows: 30 Florida and 24 Georgia institutions, and 2 in Wyoming (too few for a median). */
function rows(): IndexRow[] {
  const out: IndexRow[] = [];
  let id = 1;
  const add = (state: string, n: number, base: number) => {
    for (let i = 0; i < n; i++, id++) {
      const charter = i % 3 === 0 ? "credit_union" : "bank";
      out.push({ id: id * 10, institution_id: id, institution_name: `Institution ${id}`, amount: base + (i % 9), charter_type: charter, state_code: state });
      // A second price for some institutions, so the count is one value per institution.
      if (i % 4 === 0) out.push({ id: id * 10 + 1, institution_id: id, institution_name: `Institution ${id}`, amount: base + (i % 9) + 2, charter_type: charter, state_code: state });
    }
  };
  add("FL", 30, 4);
  add("GA", 24, 6);
  add("WY", 2, 10);
  return out;
}

const card = buildIndexCard(new Map([["monthly_maintenance", rows()]]));

describe("hero Bank Fee Index card", () => {
  it("works out every pick with the /fees explorer's own functions", () => {
    const all = rows();
    const us = card.cells.monthly_maintenance[US];
    const stats = statsFor(all, "monthly_maintenance", null, "all");
    expect(us[0]).toMatchObject({
      n: stats.institution_count,
      median: Math.round(stats.median_amount! * 100),
      p25: Math.round(stats.p25_amount! * 100),
      p75: Math.round(stats.p75_amount! * 100),
    });
    // The bars rebuild to the /fees histogram's bounds and counts.
    const buckets = histogram(institutionsFor(all, "monthly_maintenance", null, "all"));
    if (!hasMedian(us[0])) throw new Error("expected a median");
    expect(cellBars(us[0]).map((b) => [b.min, b.max, b.total])).toEqual(buckets.map((b) => [b.min, b.max, b.total]));
    const fl = statsFor(all.filter((r) => r.state_code === "FL"), "monthly_maintenance", null, "bank");
    expect(card.cells.monthly_maintenance.FL[1]).toMatchObject({ n: fl.institution_count, median: Math.round(fl.median_amount! * 100) });
    // A thin state carries its count and no median.
    expect(card.cells.monthly_maintenance.WY[0]).toEqual({ n: 2 });
    expect(card.states.map((s) => s.name)).toEqual(["Florida", "Georgia", "Wyoming"]);
    expect(card.fees).toEqual([
      { key: "monthly_maintenance", label: "Monthly maintenance", headline: "Median of each institution's median published price", plural: "institution medians" },
    ]);
  });

  it("names fees plainly", () => {
    expect(plainFeeName("overdraft")).toBe("Overdraft");
    expect(plainFeeName("wire_domestic_outgoing")).toBe("Outgoing domestic wire");
  });

  it("leaves out a fee whose read returned nothing", () => {
    expect(buildIndexCard(new Map([["overdraft", []]])).fees).toEqual([]);
  });

  it("changes the figures and the comparison with the pickers, and links to the same pick on /fees", () => {
    render(<IndexCard data={card} freshness="Oct 14, 2026" />);
    const us = card.cells.monthly_maintenance[US][0];
    if (!hasMedian(us)) throw new Error("expected a median");
    const median = `$${Number.isInteger(us.median / 100) ? us.median / 100 : (us.median / 100).toFixed(2)}`;
    expect(screen.getByText(median, { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("Banks against credit unions")).toBeTruthy();
    // One source line closes the card; the explainer lines are gone (James, Oct 17).
    expect(screen.getByText("Published fee schedules · Oct 14, 2026")).toBeTruthy();
    expect(screen.queryByText(/middle half/)).toBeNull();
    expect(screen.queryByText(/Published fee snapshot/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "FL" } });
    expect(screen.getByText("Florida against the U.S.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Institutions"), { target: { value: "bank" } });
    expect(screen.getByRole("link", { name: /See this fee in the index/ }).getAttribute("href")).toBe(cardHref("monthly_maintenance", "FL", "bank"));
    expect(cardHref("monthly_maintenance", "FL", "bank")).toBe("/fees?fee=monthly_maintenance&state=FL&charter=bank#explorer");
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "WY" } });
    expect(screen.getAllByText("Too few for a median yet").length).toBeGreaterThan(0);
  });
  it("shows the benchmark first on a phone, with the pickers behind Change comparison", () => {
    const { container } = render(<IndexCard data={card} freshness="Oct 14, 2026" />);
    const toggle = screen.getByRole("button", { name: "Change comparison" });
    const group = container.querySelector('[role="group"][aria-label="Benchmark scope"]')!;
    expect(toggle.getAttribute("aria-controls")).toBe(group.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Hidden below sm only; from sm up the pickers always show.
    expect(group.className).toMatch(/(^| )hidden( |$)/);
    expect(group.className).toContain("sm:grid");
    expect(container.querySelector("[data-index-scope]")?.textContent).toBe("Monthly maintenance");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(group.className).not.toMatch(/(^| )hidden( |$)/);
  });
});

describe("hero and proof strip", () => {
  it("names the buyer, carries James's promise, one action and the institution search", () => {
    const html = renderToStaticMarkup(<LandingHero index={card} freshness="Oct 14, 2026" />);
    // James's own eyebrow and headline, and the subhead he chose (Oct 18).
    expect(html).toMatch(/<p[^>]*>For banks and credit unions<\/p>(<!-- -->)?<h1/);
    expect(html).not.toMatch(/uppercase|tracking-\[0\.1/);
    expect(html).toContain("Your next fee review");
    expect(html).toContain("doesn’t need to take weeks.");
    expect(html.replace(/<!-- -->/g, "").replace(/\s+/g, " ")).toContain(
      "Understand your institution’s financial position, compare your fees with competitors, and identify what deserves a closer look, all supported by published data and verifiable sources.",
    );
    expect(html).toMatch(/<a href="#hamilton"[^>]*fi-btn-brick[^>]*>See a live fee comparison</);
    expect(html).not.toContain("Explore the Index");
    // The h1 is set in the homepage serif (James, Oct 17).
    expect(html).toMatch(/<h1 id="hero-title"[^>]*style="font-family:var\(--fi-home-serif/);
    expect(html).toMatch(/<form[^>]*action="\/institutions"[^>]*method="get"/);
    // Both h1 lines stay whole: a word is never left on its own line.
    expect(html.match(/class="block whitespace-nowrap"/g)).toHaveLength(2);
  });

  it("shows the live counts and leaves out one that failed", () => {
    const t = renderToStaticMarkup(<LandingProof summary={summary} feeTypes={47} />);
    expect(t).toContain("1,234");
    expect(t).toContain("institutions with published fees");
    expect(t).toContain(">47<");
    expect(t).toContain("A source for");
    const failed = renderToStaticMarkup(<LandingProof summary={{ institutionsLabel: "—" }} feeTypes={47} />);
    expect(failed).not.toContain("—");
    expect(failed.match(/data-proof-count/g)).toHaveLength(1);
  });
});

describe("Hamilton band", () => {
  const report = sampleWorkflowReport();
  const sample = buildSampleView(report)!;

  it("draws its four examples from the live sample report for Capital City Bank", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={report} />);
    expect(html).toContain("Defend each fee");
    expect(html).toContain("with its source.");
    expect(html).toContain("Capital City Bank");
    expect(html).not.toMatch(/Frost/i);
    expect(html.match(/data-hamilton-slide=/g)).toHaveLength(4);
    expect(html.match(/data-hamilton-card=/g)).toHaveLength(4);
    // Opens on the second example (Prioritize), as James's example does.
    expect(html).toMatch(/data-active="true"[^>]*data-hamilton-slide="analyze"/);
    expect(html).toContain("02 / 04");
    // No timer or progress bar anywhere (James, Oct 17).
    expect(html).not.toMatch(/progress/i);
    // The subscription sits beside the demo; the homepage promotes no standalone report (James, Oct 17).
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_hamilton">Get Hamilton for your institution</);
    expect(html).toMatch(/<a href="\/contact\?source=demo"[^>]*data-event="contact_sales" data-placement="home_hamilton_demo">Or ask for a demo</);
    expect(html).toContain("Prioritize");
    expect(html).toContain("Which local competitors can we watch?");
    expect(html).not.toContain("request_report_click");
    expect(html).not.toContain(REPORT_OFFER.priceLabel);
    // No eyebrows, frame headings, card sub-lines or "illustrative" labels.
    expect(html).not.toMatch(/uppercase|Illustrative|Published sample|Answer:|Analyze your options|Compare local, state and national fees/);
    // Benchmark and Prioritize each name the sample bank under their question.
    expect(html.match(/Sample: Capital City Bank/g)).toHaveLength(2);
    // Every figure in the examples is a sample figure.
    for (const row of analyzePicks(sample.rows)) expect(html).toContain(row.label);
  });

  it("names the fees furthest above the local market first, and counts the report's positions", () => {
    const picks = analyzePicks(sample.rows);
    expect(picks[0].position).toBe("above_market");
    expect(analyzeAnswer(picks)).toMatch(/^Start with your .+ fees?\.$/);
    expect(analyzeAnswer([])).toBe("Start where your fees sit furthest from the market.");
    const counts = positionCounts(sample.rows);
    expect(counts.above + counts.inside + counts.below).toBeLessThanOrEqual(sample.rows.length);
  });

  it("shows the examples without figures when there is no sample", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={null} />);
    expect(html.match(/data-hamilton-slide=/g)).toHaveLength(4);
    expect(html).not.toMatch(/\$\d/);
  });
});

/** jsdom has no matchMedia or IntersectionObserver; these stand-ins report what the test says. */
function stubBrowser({ reduced = false }: { reduced?: boolean } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

const slides: HamiltonSlide[] = (["benchmark", "analyze", "monitor", "report"] as const).map((key) => ({
  key,
  name: key[0].toUpperCase() + key.slice(1),
  body: <p>{key} body</p>,
}));

describe("motion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("advances on its own, stops when paused, and a card picks its slide", () => {
    stubBrowser();
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    expect(screen.getByText("02 / 04")).toBeTruthy();
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByText("03 / 04")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause Hamilton examples" }));
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByText("03 / 04")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Choose a Hamilton example" })).getByRole("button", { name: /Report/ }));
    expect(screen.getByText("04 / 04")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Report/, pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next: Hamilton examples" }));
    expect(screen.getByText("01 / 04")).toBeTruthy();
  });

  it("never advances with reduced motion, and has no pause button there", () => {
    stubBrowser({ reduced: true });
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByText("02 / 04")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
  });

  it("holds while the tab is hidden", () => {
    stubBrowser();
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByText("02 / 04")).toBeTruthy();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
});

describe("evidence flow", () => {
  it("runs the four source groups into Hamilton and out to analysis and board reports, in reading order", () => {
    const html = renderToStaticMarkup(<LandingResearch />);
    expect(html).toMatch(/Ask Hamilton\.<\/span> <span class="block">Every answer shows its sources\./);
    expect(EVIDENCE_GROUPS.map((g) => g.name)).toEqual(["Published fees", "Financial filings", "Branches and markets", "Regulatory sources"]);
    expect(EVIDENCE_OUTPUTS.map((o) => o.name)).toEqual(["Analysis", "Board reports"]);
    // The sources the carousel credited stay credited, each in its group.
    const providers = EVIDENCE_GROUPS.flatMap((g) => g.items.map((i) => i.provider)).join(" | ");
    for (const name of ["FDIC · NCUA", "SEC", "Census · IRS", "CFPB", "Beige Book · FOMC", "Regulators · States"]) expect(providers).toContain(name);
    expect(EVIDENCE_GROUPS.find((g) => g.key === "filings")!.items.map((i) => i.name)).toContain("Industry totals");
    // A screen reader reads three lists: the sources, Hamilton, what it delivers. The lines are decoration.
    const order = ['aria-label="Evidence Hamilton reads"', "data-evidence-hub", "Connect evidence to institutional questions", 'aria-label="What Hamilton delivers"', "Get Hamilton for your institution"].map((m) => html.indexOf(m));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/data-evidence-group=/g)).toHaveLength(EVIDENCE_GROUPS.length);
    for (const g of EVIDENCE_GROUPS) for (const item of g.items) expect(html).toContain(item.provider);
    for (const svg of html.match(/<svg[^>]*fi-home-evidence-lines[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
    expect(html.match(/fi-home-evidence-lines/g)).toHaveLength(4);
    // A phone gets the vertical flow; the side-by-side layout starts at lg.
    expect(html).toContain("lg:grid-cols-[minmax(0,1.5fr)");
    // Nothing rotates: no carousel, controls or slide counter.
    expect(html).not.toMatch(/carousel|Pause|01 \/ 0|Hey Hamilton/);
    // One action, the subscription; the sample link moved to the deliverable.
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_research"[^>]*>Get Hamilton for your institution</);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toMatch(/Illustrative|uppercase/);
    expect(html).not.toMatch(/\b(four|nine|ten|4|9|10) source/i);
  });

  it("credits no source the licence rule or #1885 took off the page", () => {
    const named = [
      renderToStaticMarkup(<LandingResearch />),
      ...EVIDENCE_GROUPS.flatMap((g) => [g.name, ...g.items.map((i) => `${i.name} ${i.provider}`)]),
      ...EVIDENCE_OUTPUTS.map((o) => `${o.name} ${o.detail}`),
    ].join(" ");
    expect(named).not.toMatch(/FRED|USDA|FINRA|regional Fed|Reserve Bank|national deposit rate|deposit rates/i);
  });
});

describe("sample deliverable", () => {
  const report = sampleWorkflowReport();
  const revenue: RevenueContext = { quarters: [{ quarter: "2026-Q2", thousands: 1_850 }], trailingThousands: null, peer: null };
  const preparedOn = new Date("2026-10-18T15:00:00Z");

  it("draws the cover from the live sample report: its bank, date and figures", () => {
    const html = renderToStaticMarkup(<LandingDeliverable report={report} revenue={revenue} preparedOn={preparedOn} />);
    const cover = deliverableCover(report, revenue)!;
    expect(html).toContain("Read the report before you choose a plan.");
    expect(html).toContain("Capital City Bank against its local market");
    expect(html).toContain("Today’s sample for Capital City Bank");
    expect(html).toContain("October 18, 2026");
    expect(html).toContain("Tallahassee, FL area · verified fees for 21 of 24 local competitors");
    // The first comparable lines, each with the bank's amount and the local median.
    const view = buildSampleView(report)!;
    expect(cover.rows.map((r) => r.key)).toEqual(view.rows.slice(0, 3).map((r) => r.key));
    expect(html).toContain('data-deliverable-row="wire_intl_outgoing"');
    expect(html).toMatch(/\$75<\/td><td[^>]*>\$50</);
    // The fee income comes from the Call Report read.
    expect(html).toContain("Deposit service charges, Q2 2026");
    expect(html).toContain("$1.9 million");
    expect(html).not.toMatch(/Frost/i);
    // No price and no buy: the sample shows the work.
    expect(html).not.toContain(REPORT_OFFER.priceLabel);
    expect(html).not.toMatch(/\bbuy\b|request_report_click|\/month/i);
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_deliverable"[^>]*>Get Hamilton for your institution</);
    expect(html).toMatch(/<a href="\/reports\/sample-competitive-fee-position"[^>]*data-event="sample_report_click" data-placement="home_deliverable"[^>]*>Open the full sample/);
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it("outlines only what the sample report contains", () => {
    expect(deliverableOutline(report, revenue).map((i) => i.key)).toEqual(["findings", "pricing", "financial", "peers", "method"]);
    // No Call Report figures: no financial-state line.
    expect(deliverableOutline(report, null).map((i) => i.key)).toEqual(["findings", "pricing", "peers", "method"]);
    const bare = { ...report, analysis: { ...report.analysis, named: [], findings: [] } };
    expect(deliverableOutline(bare, null).map((i) => i.key)).toEqual(["pricing", "method"]);
    // The report has no risk or regulatory section, so the outline names none.
    const words = deliverableOutline(report, revenue).map((i) => `${i.name} ${i.detail}`).join(" ");
    expect(words).not.toMatch(/risk|regulat/i);
    const html = renderToStaticMarkup(<LandingDeliverable report={report} revenue={null} preparedOn={preparedOn} />);
    expect(html).not.toContain("data-deliverable-income");
    expect(html).not.toContain("Current financial state");
  });

  it("hides the figures and keeps the outline when the read failed", () => {
    const html = renderToStaticMarkup(<LandingDeliverable report={null} revenue={revenue} preparedOn={preparedOn} />);
    expect(deliverableCover(null, revenue)).toBeNull();
    expect(html).toContain("Read the report before you choose a plan.");
    expect(html).toContain("Each report is built live, every amount linked to its fee schedule.");
    expect(html).not.toContain("data-deliverable-cover");
    expect(html).not.toMatch(/\$\d|Capital City|October/);
    expect(html.match(/data-outline=/g)).toHaveLength(3);
    // The sample link would land on its "on its way" note, so only the subscription remains.
    expect(html).not.toContain("Open the full sample");
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});

describe("licence rule", () => {
  it("shows no source struck or held under the commercial-use rule (James, Oct 17)", () => {
    const html = renderToStaticMarkup(
      <>
        <LandingHero index={card} freshness="Oct 14, 2026" />
        <LandingProof summary={summary} feeTypes={47} />
        <LandingHamilton report={sampleWorkflowReport()} />
        <LandingResearch />
        <LandingDeliverable report={sampleWorkflowReport()} revenue={null} preparedOn={new Date("2026-10-18T15:00:00Z")} />
        <LandingPricing />
      </>,
    );
    const words = [html, ...EVIDENCE_GROUPS.flatMap((g) => g.items.map((i) => `${i.name} ${i.provider}`))].join(" ");
    expect(words).not.toMatch(
      /FINRA|Zelle|FedNow|\bRTP\b|Clearing House|frbservices|Fed Financial Services|Nacha|Payment services|payment choice|remittance|World Bank|Small Business Credit Survey|small-business lending|Kansas City Fed|KC Fed|Atlanta Fed/i,
    );
    // Every answer starts from published fees, so the flow leads with them.
    expect(EVIDENCE_GROUPS[0].key).toBe("fees");
  });
});

describe("pricing", () => {
  it("takes every price from PRO_TIERS and offers the plan and a conversation", () => {
    const html = renderToStaticMarkup(<LandingPricing />);
    expect(html).toContain("One plan for your whole pricing team.");
    // The billing line is worked out from PRO_TIERS, never typed.
    expect(html).toContain(pricingLine().replace("'", "&#x27;"));
    expect(pricingLine()).toBe(
      `Priced by your institution's total assets, for up to ${WORKSPACE_SEAT_LIMIT} people. Pay annually and get two months free.`,
    );
    expect(pricingLine([{ monthlyUsd: 100, annualUsd: 1_000 }, { monthlyUsd: 100, annualUsd: 1_100 }], 3)).toBe(
      "Priced by your institution's total assets, for up to 3 people. Monthly or annual.",
    );
    for (const tier of PRO_TIERS) {
      expect(html).toContain(tier.assetsLabel);
      expect(html).toContain(tierAmountLabel(tier.key, "monthly"));
      expect(html).toContain(`or ${tierAmountLabel(tier.key, "annual")} / year`);
    }
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_pricing">Choose your plan</);
    expect(html).toMatch(/<a href="\/contact\?source=demo"[^>]*data-event="contact_sales" data-placement="home_pricing_demo">Ask for a demo</);
    // The FAQ link (James, Oct 18) opens the plan page's questions.
    expect(html).toMatch(/<a [^>]*href="\/subscribe#faq"[^>]*>Questions\? Read the FAQ</);
    // No eyebrow; the seat count is said once, in the subhead; no report offer.
    expect(html).not.toMatch(/uppercase/);
    expect(html).not.toContain("users.");
    expect(html.match(new RegExp(`up to ${WORKSPACE_SEAT_LIMIT}`, "gi"))).toHaveLength(1);
    expect(html).not.toContain(REPORT_OFFER.priceLabel);
  });
});

describe("page copy", () => {
  it("keeps the editorial words out", () => {
    const html = renderToStaticMarkup(
      <>
        <LandingHero index={card} freshness="Oct 14, 2026" />
        <LandingProof summary={summary} feeTypes={47} />
        <LandingHamilton report={sampleWorkflowReport()} />
        <LandingResearch />
        <LandingDeliverable report={sampleWorkflowReport()} revenue={null} preparedOn={new Date("2026-10-18T15:00:00Z")} />
        <LandingPricing />
      </>,
    );
    const words = html.replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/—|!|real-time|recommend|cheapest|gouging|\bAI\b|99%|raise your/i);
  });
});

describe("page order", () => {
  it("runs the critique's six sections: hero, live data, Hamilton, evidence, deliverable, plans", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(`${process.cwd()}/src/app/page.tsx`, "utf8");
    const main = source.slice(source.indexOf("<main"), source.indexOf("</main>"));
    expect(main.match(/<Landing\w+/g)).toEqual([
      "<LandingHero",
      "<LandingProof",
      "<LandingHamilton",
      "<LandingResearch",
      "<LandingDeliverable",
      "<LandingPricing",
    ]);
  });
});

describe("page cache", () => {
  const categories = [{ fee_category: "overdraft" } as FeeCategorySummary];
  it("keeps a render out of the page cache when any read failed, but not when the sample is simply absent", () => {
    const ok = { summary, categories, sampleFailed: false, indexFailed: false };
    expect(homeReadsCacheable(ok)).toBe(true);
    expect(homeReadsCacheable({ ...ok, summary: { ...summary, complete: false } })).toBe(false);
    expect(homeReadsCacheable({ ...ok, categories: [] })).toBe(false);
    expect(homeReadsCacheable({ ...ok, sampleFailed: true })).toBe(false);
    expect(homeReadsCacheable({ ...ok, indexFailed: true })).toBe(false);
  });
});
