// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { REPORT_OFFER } from "@/lib/constants";
import { buildRevenueContext, incomeLabel } from "@/lib/custom-report/revenue-context";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_TIERS, tierAmountLabel } from "@/lib/pro-tiers";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { histogram, institutionsFor, statsFor } from "./(public)/fees/(index)/index-view";
import { LandingHero, LandingProof } from "./landing-hero";
import { LandingHamilton, analyzePicks, positionCounts } from "./landing-hamilton";
import { HamiltonCarousel, type HamiltonSlide } from "./landing-hamilton-carousel";
import { buildIndexCard, plainFeeName } from "./landing-index";
import { institutionCardFees } from "./landing-index-actions";
import { IndexCard } from "./landing-index-card";
import { cardHref, cellBars, hasMedian, noFeeSentence, positionSentence, US, type IndexCardData } from "./landing-index-view";
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

// The card's server action, so a pick's fee read is under the test's control.
vi.mock("./landing-index-actions", () => ({ institutionCardFees: vi.fn(async () => null) }));
const institutionCardFeesMock = vi.mocked(institutionCardFees);

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
      { key: "monthly_maintenance", label: "Monthly maintenance", headline: "Median of each institution's median published price", plural: "institution medians", measure: "institution median" },
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
    expect(screen.getByText("U.S. banks against credit unions")).toBeTruthy();
    // Every scope names its place and its charter.
    expect(screen.getByText("U.S. banks and credit unions", { selector: "h3" })).toBeTruthy();
    expect(screen.getByText("U.S. banks")).toBeTruthy();
    expect(screen.getByText("U.S. credit unions")).toBeTruthy();
    // One source line closes the card; the explainer lines are gone (James, Oct 17).
    expect(screen.getByText("Published fee schedules · Oct 14, 2026")).toBeTruthy();
    expect(screen.queryByText(/middle half/)).toBeNull();
    expect(screen.queryByText(/Published fee snapshot/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "FL" } });
    expect(screen.getByText("Florida against the U.S.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Institutions"), { target: { value: "bank" } });
    expect(screen.getByText("Florida banks", { selector: "h3" })).toBeTruthy();
    expect(screen.getByText("U.S. banks")).toBeTruthy();
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

describe("hero Bank Fee Index card: your institution", () => {
  const all = rows();
  // Institution 5 is a Florida bank; its value is the one the chart counts for it.
  const ownValue = institutionsFor(all, "monthly_maintenance", null, "all").find((i) => i.id === 5)!.value;
  const withInstitution = buildIndexCard(new Map([["monthly_maintenance", all]]), [5, 9999]);
  const dollars = (cents: number) => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
  const medianOf = (data: IndexCardData, place: string, ci: number) => {
    const c = data.cells.monthly_maintenance[place][ci];
    if (!hasMedian(c)) throw new Error("expected a median");
    return c.median;
  };

  afterEach(() => vi.unstubAllGlobals());

  it("reads the demo institution ahead from the same rows, and leaves out one with no published row", () => {
    expect(withInstitution.institutions).toEqual([
      { id: 5, name: "Institution 5", state: "FL", fees: { monthly_maintenance: Math.round(ownValue * 100) } },
    ]);
    expect(buildIndexCard(new Map([["monthly_maintenance", all]]), [9999]).institutions).toBeUndefined();
  });

  it("marks the institution's fee on the distribution and says where it sits against the benchmark on screen", () => {
    const { container } = render(<IndexCard data={withInstitution} freshness="Oct 14, 2026" />);
    const ownCents = Math.round(ownValue * 100);
    const marker = container.querySelector("[data-index-marker]");
    expect(marker?.textContent).toBe(`Institution 5median${dollars(ownCents)}`);
    expect(container.querySelectorAll("[data-marker-bar]")).toHaveLength(1);
    const usMedian = medianOf(withInstitution, US, 0);
    expect(container.querySelector("[data-index-position]")?.textContent).toBe(positionSentence("Institution 5", "institution median", ownCents, usMedian, "U.S."));
    expect(container.querySelector("[data-index-position]")?.textContent).toMatch(/^Institution 5’s institution median, \$[\d.]+, (is (higher|lower) than the U\.S\. median of \$[\d.]+|matches the U\.S\. median)\.$/);
    // The scope follows the pickers: state, then charter.
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "FL" } });
    fireEvent.change(screen.getByLabelText("Institutions"), { target: { value: "bank" } });
    expect(container.querySelector("[data-index-position]")?.textContent).toBe(
      positionSentence("Institution 5", "institution median", ownCents, medianOf(withInstitution, "FL", 1), "Florida bank"),
    );
    // The selection carries through: the index with its name search, its own page on this fee, the plans priced for it.
    expect(screen.getByRole("link", { name: /See this fee in the index/ }).getAttribute("href")).toBe(
      "/fees?fee=monthly_maintenance&state=FL&charter=bank&q=Institution+5#explorer",
    );
    expect(screen.getByRole("link", { name: /See its fees/ }).getAttribute("href")).toBe("/institution/5?fee=monthly_maintenance");
    expect(screen.getByRole("link", { name: /See Hamilton plans/ }).getAttribute("href")).toBe("/subscribe?inst=5");
  });

  it("words the position neutrally", () => {
    // The counted value is a calculation, so it is named, never "charged" (James, Oct 16).
    expect(positionSentence("Capital City Bank", "institution median", 800, 500, "Florida")).toBe("Capital City Bank’s institution median, $8, is higher than the Florida median of $5.");
    expect(positionSentence("Capital City Bank", "highest published price", 395, 500, "U.S. credit union")).toBe("Capital City Bank’s highest published price, $3.95, is lower than the U.S. credit union median of $5.");
    expect(positionSentence("Capital City Bank", "institution median", 500, 500, "Florida bank")).toBe("Capital City Bank’s institution median, $5, matches the Florida bank median.");
    expect(noFeeSentence("Capital City Bank", "Monthly maintenance")).toBe("No published monthly maintenance fee for Capital City Bank yet.");
    expect(noFeeSentence("Capital City Bank", "NSF")).toBe("No published NSF fee for Capital City Bank yet.");
  });

  it("shows the card without a marker when the institution's fees could not be read, never a zero", () => {
    const { container } = render(<IndexCard data={card} freshness="Oct 14, 2026" />);
    expect(container.querySelector("[data-index-marker]")).toBeNull();
    expect(container.querySelector("[data-marker-bar]")).toBeNull();
    expect(container.querySelector("[data-index-position]")).toBeNull();
    expect(screen.getByLabelText("Your institution").getAttribute("role")).toBe("combobox");
    expect(container.textContent).not.toMatch(/\$0(?![.\d])/);
    expect(screen.getByRole("link", { name: /See this fee in the index/ }).getAttribute("href")).toBe(cardHref("monthly_maintenance", US, "all"));
  });

  it("says plainly when the institution publishes no fee of the picked type, with no marker", () => {
    const other: IndexCardData = { ...card, institutions: [{ id: 5, name: "Institution 5", state: "FL", fees: { overdraft: 3000 } }] };
    const { container } = render(<IndexCard data={other} freshness="Oct 14, 2026" />);
    expect(container.querySelector("[data-index-marker]")).toBeNull();
    expect(container.querySelector("[data-index-position]")?.textContent).toBe("No published monthly maintenance fee for Institution 5 yet.");
  });

  /** Changes the pick to Harbor Bank (id 77) through the search, with fetch mocked. */
  async function pickHarbor() {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [{ id: 77, institution_name: "Harbor Bank", city: "Tampa", state_code: "FL" }] })));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Your institution"), { target: { value: "Harbor" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(String((vi.mocked(fetch).mock.calls[0] as unknown[])[0])).toBe("/api/institutions?q=Harbor");
    fireEvent.mouseDown(screen.getByRole("option", { name: /Harbor Bank/ }));
  }

  it("keeps Capital City's stand-in preselected without asking the server", () => {
    institutionCardFeesMock.mockClear();
    render(<IndexCard data={withInstitution} freshness="Oct 14, 2026" />);
    expect(institutionCardFeesMock).not.toHaveBeenCalled();
  });

  it("reads another pick's fees from the server action, shows a quiet wait, then its marker and sentence", async () => {
    vi.useFakeTimers();
    let answer: (v: Record<string, number> | null) => void = () => undefined;
    institutionCardFeesMock.mockClear();
    institutionCardFeesMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    try {
      const { container } = render(<IndexCard data={withInstitution} freshness="Oct 14, 2026" />);
      await pickHarbor();
      expect(institutionCardFeesMock).toHaveBeenCalledWith(77, ["monthly_maintenance"]);
      expect(container.querySelector("[data-index-reading]")?.textContent).toBe("Finding Harbor Bank’s fees…");
      expect(container.querySelector("[data-index-marker]")).toBeNull();
      await act(async () => answer({ monthly_maintenance: 1200 }));
      expect(container.querySelector("[data-index-reading]")).toBeNull();
      expect(container.querySelector("[data-index-marker]")?.textContent).toBe("Harbor Bankmedian$12");
      expect(container.querySelector("[data-index-position]")?.textContent).toBe(
        positionSentence("Harbor Bank", "institution median", 1200, medianOf(withInstitution, US, 0), "U.S."),
      );
      expect(screen.getByRole("link", { name: /See its fees/ }).getAttribute("href")).toBe("/institution/77?fee=monthly_maintenance");
      expect(screen.getByRole("link", { name: /See Hamilton plans/ }).getAttribute("href")).toBe("/subscribe?inst=77");
      expect(screen.getByRole("link", { name: /See this fee in the index/ }).getAttribute("href")).toBe(
        "/fees?fee=monthly_maintenance&q=Harbor+Bank#explorer",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the pick publishes no fee of this type, and shows no marker when the read failed", async () => {
    vi.useFakeTimers();
    try {
      institutionCardFeesMock.mockResolvedValueOnce({});
      const first = render(<IndexCard data={withInstitution} freshness="Oct 14, 2026" />);
      await pickHarbor();
      await act(async () => undefined);
      expect(first.container.querySelector("[data-index-marker]")).toBeNull();
      expect(first.container.querySelector("[data-index-position]")?.textContent).toBe("No published monthly maintenance fee for Harbor Bank yet.");
      first.unmount();
      vi.unstubAllGlobals();

      institutionCardFeesMock.mockResolvedValueOnce(null);
      const failed = render(<IndexCard data={withInstitution} freshness="Oct 14, 2026" />);
      await pickHarbor();
      await act(async () => undefined);
      expect(failed.container.querySelector("[data-index-reading]")).toBeNull();
      expect(failed.container.querySelector("[data-index-marker]")).toBeNull();
      expect(failed.container.querySelector("[data-index-position]")).toBeNull();
      expect(failed.container.textContent).not.toMatch(/\$0(?![.\d])/);
      expect(screen.getByRole("link", { name: /See its fees/ }).getAttribute("href")).toBe("/institution/77?fee=monthly_maintenance");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hero and proof strip", () => {
  it("names the buyer, carries James's promise, a main action to the card and a quieter one to the sample", () => {
    const html = renderToStaticMarkup(<LandingHero index={card} freshness="Oct 14, 2026" />);
    // James's own eyebrow and headline, and the subhead he chose (Oct 18).
    expect(html).toMatch(/<p[^>]*>For banks and credit unions<\/p>(<!-- -->)?<h1/);
    expect(html).not.toMatch(/uppercase|tracking-\[0\.1/);
    expect(html).toContain("Your next fee review");
    expect(html).toContain("doesn’t need to take weeks.");
    expect(html.replace(/<!-- -->/g, "").replace(/\s+/g, " ")).toContain(
      "Understand your institution’s financial position, compare your fees with competitors, and identify what deserves a closer look, all supported by published data and verifiable sources.",
    );
    expect(html).toMatch(/<a href="#bank-fee-index"[^>]*fi-btn-brick[^>]*>See a live fee comparison</);
    expect(html).toContain('id="bank-fee-index"');
    expect(html).toMatch(/<a href="\/reports\/sample-competitive-fee-position"[^>]*data-event="sample_report_click" data-placement="home_hero"[^>]*>View sample analysis</);
    expect(html).not.toContain("Explore the Index");
    // The h1 is set in the homepage serif (James, Oct 17).
    expect(html).toMatch(/<h1 id="hero-title"[^>]*style="font-family:var\(--fi-home-serif/);
    // The institution is picked inside the card now; the separate search under it is gone.
    expect(html).not.toContain("<form");
    expect(html).toContain("Your institution");
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

  // Made-up call report figures (thousands of dollars), test data only.
  const revenue = buildRevenueContext(
    [
      { quarter: "2026-Q2", service_charge_income: 1_840 },
      { quarter: "2026-Q1", service_charge_income: 1_790 },
      { quarter: "2025-Q4", service_charge_income: 1_760 },
      { quarter: "2025-Q3", service_charge_income: 1_720 },
    ],
    { tier: "community", sc_rank: 12, peer_count: 140, peer_median_sc: 610 },
  );
  const stage = (html: string, key: string) => {
    const at = html.indexOf(`data-hamilton-slide="${key}"`);
    const next = html.indexOf("data-hamilton-slide=", at + 1);
    return html.slice(at, next < 0 ? html.indexOf("data-hamilton-card=") : next).replace(/<!-- -->/g, "");
  };
  const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");

  it("draws one investigation of Capital City Bank from the live sample report", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={report} revenue={revenue} />);
    expect(html).toContain("Defend each fee");
    expect(html).toContain("with its source.");
    expect(html).not.toMatch(/Frost/i);
    // The sample institution is named once, above every stage.
    expect(html.match(/Capital City Bank/g)).toHaveLength(1);
    expect(html).toMatch(/data-hamilton-subject[^>]*>Sample: Capital City Bank · Tallahassee, FL</);
    expect(html.match(/data-hamilton-slide=/g)).toHaveLength(4);
    expect(html.match(/data-hamilton-card=/g)).toHaveLength(4);
    // No timer or progress bar anywhere (James, Oct 17).
    expect(html).not.toMatch(/progress/i);
    // No eyebrows, frame headings, card sub-lines or "illustrative" labels.
    expect(html).not.toMatch(/uppercase|Illustrative|Published sample|Answer:|Analyze your options|Compare local, state and national fees/);
    expect(text(html)).not.toMatch(/Hamilton Pro|Knox|Darwin|revenue impact|should charge|most material|—/i);
  });

  it("reads Benchmark, Prioritize, Monitor, Report in order and opens on Benchmark", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={report} revenue={revenue} />);
    const keys = [...html.matchAll(/data-hamilton-slide="([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["benchmark", "analyze", "monitor", "report"]);
    const cards = [...html.matchAll(/data-hamilton-card="([a-z]+)"[^>]*>.*?>(Benchmark|Prioritize|Monitor|Report)</g)].map((m) => m[2]);
    expect(cards).toEqual(["Benchmark", "Prioritize", "Monitor", "Report"]);
    expect(html).toMatch(/data-active="true"[^>]*data-hamilton-slide="benchmark"/);
    expect(html).toContain("01 / 04");
    const questions = ["Where does our fee income stand?", "Which fees should we review next?", "Which local competitors can we watch?", "What do we take to management?"].map((q) => html.indexOf(q));
    expect(questions.every((at) => at >= 0)).toBe(true);
    expect([...questions].sort((a, b) => a - b)).toEqual(questions);
  });

  it("carries the same live figures from stage to stage", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={report} revenue={revenue} />);
    const [first, second] = analyzePicks(sample.rows);
    // Benchmark: four quarters of reported income, the median for its size, its rank and source.
    const benchmark = stage(html, "benchmark");
    for (const t of [1_720, 1_760, 1_790, 1_840, 610]) expect(benchmark).toContain(incomeLabel(t));
    expect(benchmark.indexOf("Q3 2025")).toBeLessThan(benchmark.indexOf("Q2 2026"));
    expect(benchmark).toContain("Median for its size ($100M-$1B), Q2 2026");
    expect(text(benchmark)).toMatch(/Ranks 12 of 140 institutions its size, where 1 is the highest/);
    expect(benchmark).toContain("Source: FDIC Call Report");
    // Prioritize: the first selected benchmark difference, with Benchmark's latest quarter beside it.
    const prioritize = stage(html, "analyze");
    expect(prioritize).toContain("Benchmark difference selected for review");
    expect(prioritize).toContain(first.label);
    expect(prioritize).toContain(`Local median $${first.median}`);
    expect(prioritize).toContain(incomeLabel(1_840));
    // Monitor: the competitors that publish those same fees.
    const monitor = stage(html, "monitor");
    expect(monitor).toContain(`${sample.competitors} with published fees`);
    for (const p of [first, second]) expect(monitor).toContain(`${p.label}`);
    expect(monitor).toContain(`Published by ${first.competitors} local competitors`);
    // Report: the positions, the same income, and the evidence's question for management.
    const reportStage = stage(html, "report");
    const counts = positionCounts(sample.rows);
    expect(text(reportStage)).toMatch(new RegExp(`${counts.above}\\s+above local range`));
    expect(reportStage).toContain(`${sample.rows.length} fees against ${sample.competitors} local competitors`);
    expect(reportStage).toContain(`${incomeLabel(1_840)} in deposit service charges, Q2 2026`);
    expect(reportStage).toContain(
      `${first.label} is $${first.amount} against a $${first.median} local median. What volume and fee income sit behind it?`,
    );
  });

  it("has one primary action, the subscription, and one quiet sample report link", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={report} revenue={revenue} />);
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_hamilton">Get Hamilton for your institution</);
    expect(html.match(/data-event=/g)).toHaveLength(1);
    expect(html.match(/fi-btn/g)).toHaveLength(2); // "fi-btn fi-btn-brick" on the one button
    expect(html.match(/See the sample report/g)).toHaveLength(1);
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).not.toMatch(/Or ask for a demo|contact_sales|Explore Hamilton|Read the sample report|View the sample report|request_report_click/);
    expect(html).not.toContain(REPORT_OFFER.priceLabel);
  });

  it("selects the fees furthest above the local market first, and counts the report's positions", () => {
    const picks = analyzePicks(sample.rows);
    expect(picks[0].position).toBe("above_market");
    const counts = positionCounts(sample.rows);
    expect(counts.above + counts.inside + counts.below).toBeLessThanOrEqual(sample.rows.length);
  });

  it("hides every income figure when the income read is missing, and names the sources instead", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={report} />);
    expect(html).not.toMatch(/million|data-benchmark-income|data-benchmark-rank|data-prioritize-income|data-report-income|Deposit service charges/);
    expect(stage(html, "benchmark")).toContain("Service-charge income from each quarter’s FDIC Call Report, against institutions of its size");
    expect(stage(html, "benchmark")).not.toMatch(/\$\d/);
    const prioritize = stage(html, "analyze");
    expect(prioritize).toContain("Service-charge income (Call Report)");
    // Only the observation's own sample figures remain.
    expect(prioritize.match(/\$\d/g)).toHaveLength(2);
    // The fee figures still carry through to the question for management.
    expect(stage(html, "report")).toContain("data-report-question");
  });

  it("leaves out the size comparison when the read has no peer median", () => {
    const own = buildRevenueContext([{ quarter: "2026-Q2", service_charge_income: 1_840 }], null);
    const benchmark = stage(renderToStaticMarkup(<LandingHamilton report={report} revenue={own} />), "benchmark");
    expect(benchmark).toContain(incomeLabel(1_840));
    expect(benchmark).not.toMatch(/Median for its size|Ranks|data-benchmark-peer/);
  });

  it("names a credit union's own filing", () => {
    const cu = sampleWorkflowReport();
    cu.data.subject.charter_type = "credit_union";
    expect(stage(renderToStaticMarkup(<LandingHamilton report={cu} revenue={revenue} />), "benchmark")).toContain("Source: NCUA 5300 Call Report");
  });

  it("shows the stages without figures or the sample link when there is no sample", () => {
    const html = renderToStaticMarkup(<LandingHamilton report={null} revenue={revenue} />);
    expect(html.match(/data-hamilton-slide=/g)).toHaveLength(4);
    expect(html).not.toMatch(/\$\d|million|data-hamilton-subject|See the sample report/);
    expect(html).toContain("Get Hamilton for your institution");
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

  it("opens on Benchmark, advances on its own, and stops when paused", () => {
    stubBrowser();
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    expect(screen.getByText("01 / 04")).toBeTruthy();
    const pause = screen.getByRole("button", { name: "Pause Hamilton investigation" });
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByText("02 / 04")).toBeTruthy();
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByText("02 / 04")).toBeTruthy();
    // Play resumes it.
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByText("03 / 04")).toBeTruthy();
  });

  it("keeps a stage the visitor picks: a card or an arrow also pauses it", () => {
    stubBrowser();
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Choose a stage" })).getByRole("button", { name: /Report/ }));
    expect(screen.getByText("04 / 04")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Report/, pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause Hamilton investigation" }).getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByText("04 / 04")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next: Hamilton investigation" }));
    expect(screen.getByText("01 / 04")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous: Hamilton investigation" }));
    expect(screen.getByText("04 / 04")).toBeTruthy();
  });

  it("never advances with reduced motion, has no pause button there, and still reaches every stage", () => {
    stubBrowser({ reduced: true });
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByText("01 / 04")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    const cards = within(screen.getByRole("group", { name: "Choose a stage" })).getAllByRole("button");
    expect(cards).toHaveLength(4);
    cards.forEach((card, i) => {
      fireEvent.click(card);
      expect(screen.getByText(`0${i + 1} / 04`)).toBeTruthy();
      act(() => vi.advanceTimersByTime(30000));
      expect(screen.getByText(`0${i + 1} / 04`)).toBeTruthy();
    });
  });

  it("holds while the tab is hidden", () => {
    stubBrowser();
    render(<HamiltonCarousel intro={<h2>Intro</h2>} slides={slides} />);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByText("01 / 04")).toBeTruthy();
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
