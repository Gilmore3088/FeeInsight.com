// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { PRO_TIERS, tierAmountLabel } from "@/lib/pro-tiers";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { histogram, institutionsFor, statsFor } from "./(public)/fees/(index)/index-view";
import { LandingHero, LandingProof } from "./landing-hero";
import { LandingHamilton, analyzeAnswer, analyzePicks, positionCounts } from "./landing-hamilton";
import { HamiltonCarousel, type HamiltonSlide } from "./landing-hamilton-carousel";
import { buildIndexCard, plainFeeName } from "./landing-index";
import { IndexCard } from "./landing-index-card";
import { cardHref, cellBars, hasMedian, US } from "./landing-index-view";
import { LandingPricing } from "./landing-pricing";
import { RESEARCH_EXAMPLES, ResearchStage, SOURCES } from "./landing-research";
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
    render(<IndexCard data={card} freshness="Oct 14, 2026 snapshot" />);
    const us = card.cells.monthly_maintenance[US][0];
    if (!hasMedian(us)) throw new Error("expected a median");
    const median = `$${Number.isInteger(us.median / 100) ? us.median / 100 : (us.median / 100).toFixed(2)}`;
    expect(screen.getByText(median, { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("Banks against credit unions")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Headquartered in"), { target: { value: "FL" } });
    expect(screen.getByText("Florida against the U.S.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Institutions"), { target: { value: "bank" } });
    expect(screen.getByRole("link", { name: /Open the Bank Fee Index/ }).getAttribute("href")).toBe(cardHref("monthly_maintenance", "FL", "bank"));
    expect(cardHref("monthly_maintenance", "FL", "bank")).toBe("/fees?fee=monthly_maintenance&state=FL&charter=bank#explorer");
    fireEvent.change(screen.getByLabelText("Headquartered in"), { target: { value: "WY" } });
    expect(screen.getAllByText(/too few for a median/).length).toBeGreaterThan(0);
  });
});

describe("hero and proof strip", () => {
  it("carries James's promise, the two actions and the institution search", () => {
    const html = renderToStaticMarkup(<LandingHero index={card} freshness="Oct 14, 2026 snapshot" />);
    expect(html).toContain("Know your market.");
    expect(html).toContain("Price with confidence.");
    expect(html).toMatch(/<a href="#hamilton"[^>]*fi-btn-brick[^>]*>See Hamilton in action</);
    expect(html).toMatch(/<a [^>]*href="\/fees"[^>]*>Explore the Index/);
    expect(html).toMatch(/<form[^>]*action="\/institutions"[^>]*method="get"/);
    // Both h1 lines stay whole: a word is never left on its own line.
    expect(html.match(/class="block whitespace-nowrap"/g)).toHaveLength(2);
  });

  it("shows the live counts and leaves out one that failed", () => {
    const t = renderToStaticMarkup(<LandingProof summary={summary} feeTypes={47} />);
    expect(t).toContain("1,234");
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
    expect(html).toContain("From market data");
    expect(html).toContain("Capital City Bank");
    expect(html).not.toMatch(/Frost/i);
    expect(html.match(/data-hamilton-slide=/g)).toHaveLength(4);
    expect(html.match(/data-hamilton-card=/g)).toHaveLength(4);
    // Opens on Analyze, as James's example does.
    expect(html).toMatch(/data-active="true"[^>]*data-hamilton-slide="analyze"/);
    expect(html).toContain("02 / 04");
    // No timer or progress bar anywhere (James, Oct 17).
    expect(html).not.toMatch(/progress/i);
    // Funnel step 2: the paid report, from constants, next to the sample.
    expect(html).toMatch(/<a href="\/reports\?report=institution&amp;src=home#request"[^>]*data-event="request_report_click" data-placement="home_report">Request your institution report · From \$300</);
    expect(html).toContain("Weigh service costs and waiver policies alongside the market.");
    expect(html).not.toContain("before you settle on a price");
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
  line: `${key} line`,
  heading: `${key} heading`,
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

describe("research, already connected", () => {
  it("renders the first question and its answer on the server, so the panel is never empty", () => {
    const html = renderToStaticMarkup(<LandingResearch />);
    expect(html).toContain("The research, already connected.");
    expect(html).toContain(RESEARCH_EXAMPLES[0].question);
    expect(html).toContain(RESEARCH_EXAMPLES[0].title);
    expect(html).toContain('data-answered="true"');
    expect(html).toContain("Illustrative research workflow");
    expect(html.match(/data-source=/g)).toHaveLength(SOURCES.length);
    // The first question's sources are lit from the start.
    for (const key of RESEARCH_EXAMPLES[0].sources) expect(html).toContain(`data-source="${key}" data-lit="true"`);
    expect(html).toContain("01 / 05");
  });

  it("lands on the finished example when moved while paused, never half-drawn", () => {
    vi.useFakeTimers();
    stubBrowser();
    const { container } = render(<ResearchStage />);
    fireEvent.click(screen.getByRole("button", { name: "Pause research examples" }));
    expect(screen.getByRole("button", { name: "Pause research examples" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next: research examples" }));
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector("[data-research-output]")?.getAttribute("data-answered")).toBe("true");
    const lit = [...container.querySelectorAll('[data-lit="true"]')].map((el) => el.getAttribute("data-source"));
    expect(lit.sort()).toEqual([...RESEARCH_EXAMPLES[1].sources].sort());
    // The visitor's move is announced.
    expect(screen.getByText(RESEARCH_EXAMPLES[1].question).getAttribute("aria-live")).toBe("polite");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves to the next question with the arrow", () => {
    stubBrowser({ reduced: true });
    render(<ResearchStage />);
    fireEvent.click(screen.getByRole("button", { name: "Next: research examples" }));
    expect(screen.getByText(RESEARCH_EXAMPLES[1].question)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("pricing", () => {
  it("takes every price from PRO_TIERS and offers the plan and a conversation", () => {
    const html = renderToStaticMarkup(<LandingPricing />);
    expect(html).toContain("Hamilton, for your institution.");
    for (const tier of PRO_TIERS) {
      expect(html).toContain(tier.assetsLabel);
      expect(html).toContain(tierAmountLabel(tier.key, "monthly"));
      expect(html).toContain(`or ${tierAmountLabel(tier.key, "annual")} / year`);
    }
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_pricing">Choose your plan</);
    expect(html).toMatch(/<a href="\/contact\?source=demo"[^>]*data-event="contact_sales" data-placement="home_pricing_demo">Talk to us</);
  });
});

describe("page copy", () => {
  it("keeps the editorial words out", () => {
    const html = renderToStaticMarkup(
      <>
        <LandingHero index={card} freshness="Oct 14, 2026 snapshot" />
        <LandingProof summary={summary} feeTypes={47} />
        <LandingHamilton report={sampleWorkflowReport()} />
        <LandingResearch />
        <LandingPricing />
      </>,
    );
    const words = html.replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/—|!|real-time|recommend|cheapest|gouging|\bAI\b|99%|raise your/i);
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
