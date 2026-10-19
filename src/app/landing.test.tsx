// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { REPORT_OFFER } from "@/lib/constants";
import { buildRevenueContext } from "@/lib/custom-report/revenue-context";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_TIERS, tierAmountLabel } from "@/lib/pro-tiers";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { histogram, institutionsFor, statsFor } from "./(public)/fees/(index)/index-view";
import { LandingHero, LandingProof } from "./landing-hero";
import { HAMILTON_STEPS, LandingHamilton } from "./landing-hamilton";
import { buildIndexCard, plainFeeName } from "./landing-index";
import { institutionCardFees } from "./landing-index-actions";
import { IndexCard } from "./landing-index-card";
import { cardHref, cellBars, hasMedian, measurePhrase, noFeeSentence, positionSentence, US, type IndexCardData } from "./landing-index-view";
import { LandingPricing, pricingLine } from "./landing-pricing";
import { ASK_MS, EVIDENCE, LEAD_MS, a, OUTPUTS, STEP_MS, WATCH, cardFigure, feeWords } from "./landing-research";
import { buildOneQuestionView, pickQuestionLine, questionFor, shortFeeName } from "./landing-one-question";
import { LandingDeliverable, deliverablePage } from "./landing-deliverable";
import { DATA_SOURCES_HREF, LandingResearch } from "./landing-research-section";
import { homeReadsCacheable } from "./landing-shared";
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
      { key: "monthly_maintenance", label: "Monthly maintenance", headline: "Median of each institution's median published price", plural: "institution medians", highest: false },
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
    expect(container.querySelector("[data-index-position]")?.textContent).toBe(positionSentence("Institution 5", "median monthly maintenance price across its accounts", ownCents, usMedian, "U.S."));
    expect(container.querySelector("[data-index-position]")?.textContent).toMatch(/^Institution 5’s median monthly maintenance price across its accounts, \$[\d.]+, (is (higher|lower) than the U\.S\. median of \$[\d.]+|matches the U\.S\. median)\.$/);
    // The scope follows the pickers: state, then charter.
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "FL" } });
    fireEvent.change(screen.getByLabelText("Institutions"), { target: { value: "bank" } });
    expect(container.querySelector("[data-index-position]")?.textContent).toBe(
      positionSentence("Institution 5", "median monthly maintenance price across its accounts", ownCents, medianOf(withInstitution, "FL", 1), "Florida bank"),
    );
    // The selection carries through: the index with its name search, its own page on this fee, the plans priced for it.
    expect(screen.getByRole("link", { name: /See this fee in the index/ }).getAttribute("href")).toBe(
      "/fees?fee=monthly_maintenance&state=FL&charter=bank&q=Institution+5#explorer",
    );
    expect(screen.getByRole("link", { name: /See its fees/ }).getAttribute("href")).toBe("/institution/5?fee=monthly_maintenance");
    expect(screen.getByRole("link", { name: /Explore Hamilton/ }).getAttribute("href")).toBe("/subscribe?inst=5");
  });

  it("words the position neutrally", () => {
    // The counted value is a calculation, so it is named in plain words, never "charged" (James, Oct 16).
    expect(measurePhrase("Monthly maintenance", false)).toBe("median monthly maintenance price across its accounts");
    expect(measurePhrase("Overdraft fee", true)).toBe("highest published overdraft price");
    expect(positionSentence("Capital City Bank", "median monthly maintenance price", 800, 500, "Florida")).toBe("Capital City Bank’s median monthly maintenance price, $8, is higher than the Florida median of $5.");
    expect(positionSentence("Capital City Bank", "highest published overdraft price", 395, 500, "U.S. credit union")).toBe("Capital City Bank’s highest published overdraft price, $3.95, is lower than the U.S. credit union median of $5.");
    expect(positionSentence("Capital City Bank", "median monthly maintenance price", 500, 500, "Florida bank")).toBe("Capital City Bank’s median monthly maintenance price, $5, matches the Florida bank median.");
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
        positionSentence("Harbor Bank", "median monthly maintenance price across its accounts", 1200, medianOf(withInstitution, US, 0), "U.S."),
      );
      expect(screen.getByRole("link", { name: /See its fees/ }).getAttribute("href")).toBe("/institution/77?fee=monthly_maintenance");
      expect(screen.getByRole("link", { name: /Explore Hamilton/ }).getAttribute("href")).toBe("/subscribe?inst=77");
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
    expect(html).toMatch(/<a href="#bank-fee-index"[^>]*fi-btn-brick[^>]*>Compare fees in your market</);
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

describe("Hamilton introduction", () => {
  const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("introduces Hamilton in a heading, one line and four steps, and leaves the figures to the demo below", () => {
    const html = renderToStaticMarkup(<LandingHamilton />);
    expect(html).toContain("Make fee decisions");
    expect(html).toContain("you can defend.");
    expect(text(html)).toContain("Hamilton, the Fee Insight Pro workspace, turns a pricing question into an answer your committee can check.");
    expect(HAMILTON_STEPS.map((s) => s.name)).toEqual(["Ask", "Gather", "Weigh", "Brief"]);
    expect(html.match(/data-hamilton-step=/g)).toHaveLength(4);
    // No walkthrough, no carousel and none of the demo bank's figures (James's review, Oct 19).
    expect(html).not.toMatch(/\$\d|million|Capital City|carousel|data-hamilton-slide|Illustrative/);
    expect(text(html)).not.toMatch(/Hamilton Pro|Knox|Darwin|revenue impact|should charge|—/i);
  });

  it("has one primary action, the subscription, and a quiet link down to the demo", () => {
    const html = renderToStaticMarkup(<LandingHamilton />);
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_hamilton">Get Hamilton for your institution</);
    expect(html.match(/data-event=/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="#research"[^>]*>See it work/);
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).not.toContain(REPORT_OFFER.priceLabel);
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

describe("one question section", () => {
  const report = sampleWorkflowReport();
  // Made-up call report and market figures, test data only.
  const revenue = buildRevenueContext(
    [
      { quarter: "2026-Q2", service_charge_income: 1_840 },
      { quarter: "2026-Q1", service_charge_income: 1_790 },
      { quarter: "2025-Q4", service_charge_income: 1_760 },
      { quarter: "2025-Q3", service_charge_income: 1_720 },
    ],
    { tier: "community", sc_rank: 12, peer_count: 140, peer_median_sc: 610 },
  );
  const branches = { sod_year: 2025, totalBranches: 80, totalDeposits: 10_000_000_000, byInstitution: { 323: { branches: 14, deposits: 2_100_000_000 } } };
  const peers = {
    groupLabel: "Banks with $1B to $10B in assets",
    fees: [
      { key: "wire_domestic_outgoing", own: 25, peerCount: 412, median: 20, p25: 15, p75: 30, percentile: 55 },
      { key: "overdraft", own: 37, peerCount: 1_204, median: 32, p25: 29, p75: 35, percentile: 80 },
    ],
    thinFeeKeys: [],
    financial: null,
  };
  const view = () => buildOneQuestionView({ report, revenue, peers, branches })!;
  const full = () => renderToStaticMarkup(<LandingResearch report={report} revenue={revenue} peers={peers} branches={branches} />);
  const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const litNow = () => [...document.querySelectorAll('[data-evidence][data-lit="true"]')].map((el) => el.getAttribute("data-evidence"));
  const questionNow = () => document.querySelector("[data-question-text]")!.textContent;
  const tabNow = () => document.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute("data-output");
  const inEvidenceOrder = (keys: string[]) => EVIDENCE.map((e) => e.key).filter((k) => keys.includes(k));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses James's words, in reading order: question, evidence, Hamilton, outputs, the action", () => {
    const html = full();
    expect(html).toMatch(/One question\.<\/span> <span class="block">Every angle considered\./);
    expect(html).toContain("Hamilton Intelligence");
    expect(text(html)).toContain("Financial performance. Competitors. Market conditions. Regulation. Connected in one analysis.");
    expect(html).toContain("Connects the evidence, identifies what matters, and helps your team evaluate the next decision.");
    expect(EVIDENCE.map((e) => e.name)).toEqual(["Financial performance", "Competitive position", "Market conditions", "Regulatory context"]);
    expect(OUTPUTS.map((o) => o.name)).toEqual(["Benchmark", "Investigate", "Monitor", "Report"]);
    expect(OUTPUTS[0].heading).toBe("How do we compare?");
    const order = ["data-question-card", 'aria-label="Evidence Hamilton reads"', "data-evidence-hub", 'role="tablist"', "data-flow-footer", "See what Hamilton could uncover for your institution.", "data-source-strip"].map((m) =>
      html.indexOf(m),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text(html)).toContain("“Should we change our outgoing wire fees?”");
    expect(text(html)).toContain("Capital City Bank sample · Based on published evidence or described capability");
    // The connector lines are decoration.
    for (const svg of html.match(/<svg[^>]*fi-home-evidence-lines[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
  });

  it("gives each evidence card one real figure and a short caption, with no explanatory text", () => {
    const html = full();
    const card = (k: string) => text(html.slice(html.indexOf(`data-evidence="${k}"`), html.indexOf("</li>", html.indexOf(`data-evidence="${k}"`))));
    // Financial performance: deposit service charges for the latest quarter.
    expect(card("financial")).toContain("$1.8M Deposit service charges · Q2 2026");
    // Competitive position: the bank's fee against the local median (the fixture's wire: $25 against $25).
    expect(card("competitive")).toContain("$25 vs. $25 Our wire fee vs. local median");
    // Market conditions: its share of bank deposits in its counties.
    expect(card("market")).toContain("21.0% Local bank deposit share");
    // Regulatory context: the word Evidence, one small Capability tag, no records.
    expect(card("regulatory")).toContain("Evidence Rules and consumer complaints");
    expect(html.match(/data-capability=/g)).toHaveLength(1);
    expect(html).not.toMatch(/Illustrative|data-illustrative/);
    // Each figure's source stays reachable for a screen reader.
    expect(card("financial")).toContain("Source: FDIC Call Report, Q2 2026");
    expect(card("market")).toContain("Source: FDIC Summary of Deposits, 2025");
    // The explanatory lines of round 1 are gone.
    expect(html).not.toMatch(/against institutions your size<\/p>|Branches and deposits in the counties you serve/);
  });

  it("falls back to the median for banks its size when the local comparison is missing, and says so", () => {
    const thin = sampleWorkflowReport();
    const line = thin.analysis.lines.find((l) => l.key === "wire_domestic_outgoing")!;
    line.comparable = false;
    const v = buildOneQuestionView({ report: thin, revenue, peers, branches })!;
    const fig = cardFigure("competitive", v, v.fee);
    expect(fig.caption).toBe("Our wire fee vs. banks our size");
    expect(renderToStaticMarkup(<>{fig.metric}</>).replace(/<[^>]+>/g, "")).toBe("$25 vs. $20");
  });

  it("asks only questions the reads can answer, each opening its own output", () => {
    const asks = view().asks;
    expect(asks.map((a) => a.question)).toEqual([
      "Should we change our outgoing wire fees?",
      "Where does our overdraft fee stand locally?",
      "What changed in our deposit service charges in Q2 2026?",
      "What should our pricing committee see on monthly maintenance fees?",
    ]);
    expect(asks.map((a) => a.output)).toEqual(["benchmark", "investigate", "monitor", "report"]);
    // Overdraft is where rules and complaints weigh, so its question lights the regulatory card.
    expect(asks[1].evidence).toContain("regulatory");
    expect(asks[2].evidence).toEqual(["financial"]);
    // Without the income read there is no Monitor question; with only one fee, no rotation at all.
    expect(buildOneQuestionView({ report, peers, branches })!.asks.map((a) => a.output)).toEqual(["benchmark", "investigate", "report"]);
    const lone = sampleWorkflowReport();
    lone.analysis.lines = lone.analysis.lines.filter((l) => l.key === "wire_domestic_outgoing");
    expect(buildOneQuestionView({ report: lone, peers })!.asks).toHaveLength(1);
    const html = renderToStaticMarkup(<LandingResearch report={lone} peers={peers} />);
    expect(html).not.toMatch(/data-question-controls|data-question-pause/);
  });

  it("previews each output in a sentence or two, with the fuller output behind Show detail", () => {
    const html = full();
    const words = text(html);
    expect(words).toContain("How do we compare? Our outgoing domestic wire fee is $25, compared with a $25 local median and a $20 asset-size peer median.");
    expect(words).toContain("What stands out? Our overdraft fee is $37 against a $34.50 local median; 8 of 8 local competitors that publish it charge less.");
    expect(words).toContain("Capital City Bank charges $8 for its monthly maintenance fee, against an $8 local median.");
    expect(words).not.toMatch(/\(per item\)|&#x27;/);
    expect([a("$8"), a("$18"), a("$11,000"), a("$25"), a("$80.50"), a("$1.8 million"), a("$180")]).toEqual(["an $8", "an $18", "an $11,000", "a $25", "an $80.50", "a $1.8 million", "a $180"]);
    expect(words.replace(/ \./g, ".")).toContain("What changed? Deposit service charges rose 2.8% from Q1 2026 to Q2 2026, from $1,790,000 to $1,840,000.");
    expect(words).toContain("What goes to committee? A pricing committee brief on monthly maintenance fees");
    expect(html.match(/<details/g)).toHaveLength(4);
    expect(html.match(/<summary/g)).toHaveLength(4);
    expect(words).toContain("Show detail");
    // The detail keeps the sources and dates: named competitors, read dates, the Call Report.
    const benchmark = html.slice(html.indexOf('data-panel="benchmark"'), html.indexOf('data-panel="investigate"'));
    expect(benchmark).toContain('data-bar-kind="competitor"');
    expect(text(benchmark)).toContain("Published fee schedules, competitors read Oct 8, 2026; Capital City Bank read Oct 8, 2026");
    expect(text(benchmark)).toContain("Source: FDIC Call Report, Q2 2026");
    expect(words).not.toMatch(/\$18K|\$36K|6-12%|Low risk|78%|attrition|elasticity|revenue impact/i);
    expect(words).not.toMatch(/Frost|Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Hoovie/);
    expect(words).not.toContain("—");
  });

  it("shows one real dated change in Monitor and describes the rest as capability, with no made-up events", () => {
    const html = full();
    const monitor = html.slice(html.indexOf('data-panel="monitor"'), html.indexOf('data-panel="report"'));
    expect(monitor.match(/data-monitor-change/g)).toHaveLength(1);
    expect(text(monitor)).toContain("Source: FDIC Call Report, Q1 2026 and Q2 2026");
    expect(monitor.match(/data-watch=/g)).toHaveLength(WATCH.length);
    expect(text(monitor)).toContain("What Hamilton will watch");
    expect(monitor).not.toMatch(/data-real|Illustrative|detected/);
    // Without the income read, Monitor is the capability alone, headed as such.
    const bare = renderToStaticMarkup(<LandingResearch report={report} />);
    const bareMonitor = text(bare.slice(bare.indexOf('data-panel="monitor"'), bare.indexOf('data-panel="report"')));
    expect(bareMonitor).toContain("What Hamilton will watch");
    expect(bareMonitor).not.toMatch(/\$\d|%/);
  });

  it("credits only the sources the shown figures use, and links to the methodology", () => {
    const strip = (html: string) => text(html.slice(html.indexOf("data-source-strip")));
    expect(strip(full())).toContain("Published fee schedules · FDIC Call Reports · FDIC Summary of Deposits");
    expect(strip(full())).not.toMatch(/CFPB|Census|IRS|SEC/);
    expect(full()).toContain(`href="${DATA_SOURCES_HREF}"`);
    const bare = renderToStaticMarkup(<LandingResearch report={report} />);
    expect(strip(bare)).toContain("Sources Published fee schedules Data sources");
  });

  it("asks for the subscription first, with the sample report beside it", () => {
    const html = full();
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_research"[^>]*>Explore Hamilton</);
    expect(html).toMatch(/<a href="\/reports\/sample-competitive-fee-position"[^>]*data-event="sample_report_click" data-placement="home_research"[^>]*>View sample report</);
    expect(html).toMatch(/data-event="sample_report_click" data-placement="home_research_report"[^>]*>Open the sample report</);
    // No email field or question input.
    expect(html).not.toMatch(/<input|<form/);
  });

  it("without a sample shows no figures and no sample link", () => {
    const html = renderToStaticMarkup(<LandingResearch />);
    expect(text(html)).not.toMatch(/\$\d|Capital City/);
    expect(html).not.toContain("View sample report");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(text(html)).toContain("“Should we change our outgoing wire fees?”");
    expect(text(html)).toContain("Sample · Based on published evidence or described capability");
    expect(html).not.toMatch(/data-question-controls/);
  });

  it("asks about the nearest published fee when the bank publishes no outgoing wire", () => {
    expect(questionFor(null)).toBe("Should we change our outgoing wire fees?");
    expect(questionFor({ key: "wire_intl_outgoing", label: "Outgoing international wire" })).toBe("Should we change our outgoing wire fees?");
    expect(questionFor({ key: "stop_payment", label: "Stop payment" })).toBe("Should we change our stop payment fee?");
    expect(shortFeeName({ key: "nsf", label: "NSF / returned item" })).toBe("NSF / returned item");
    expect(shortFeeName({ key: "monthly_maintenance", label: "Monthly maintenance (entry checking)" })).toBe("monthly maintenance");
    const lines = report.analysis.lines.filter((l) => l.key !== "wire_domestic_outgoing");
    expect(pickQuestionLine(lines)?.key).toBe("wire_intl_outgoing");
    // With no wire at all, every question and output names a fee the bank publishes instead of wires.
    const noWire = sampleWorkflowReport();
    noWire.analysis.lines = noWire.analysis.lines.filter((l) => !l.key.startsWith("wire_"));
    const html = renderToStaticMarkup(<LandingResearch report={noWire} revenue={revenue} />);
    expect(text(html)).toContain("“Should we change our overdraft fee?”");
    expect(text(html)).not.toMatch(/wire/i);
    expect(feeWords({ key: "wire_domestic_outgoing", name: "outgoing domestic wire" }).fees).toBe("wire fees");
    expect(feeWords({ key: "overdraft", name: "overdraft" }).volume).toBe("How often the overdraft fee is charged");
  });

  it("draws no bar at a nonsense width when every figure is zero", () => {
    const zero = sampleWorkflowReport();
    const line = zero.analysis.lines.find((l) => l.key === "wire_domestic_outgoing")!;
    line.own!.amount = 0;
    line.peers = { ...line.peers!, median: 0, p25: 0, p75: 0 };
    for (const c of zero.analysis.named) c.fees.wire_domestic_outgoing = 0;
    const flat = buildRevenueContext([{ quarter: "2026-Q2", service_charge_income: 0 }], null);
    const html = renderToStaticMarkup(<LandingResearch report={zero} revenue={flat} />);
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("server-renders the first question with its evidence lit and its output open", () => {
    const html = full();
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(4);
    expect(html).toMatch(/id="oq-tab-benchmark" aria-selected="true"/);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    const lit = [...html.matchAll(/data-evidence="([^"]+)" data-lit="true"/g)].map((m) => m[1]);
    expect(lit).toEqual(inEvidenceOrder(view().asks[0].evidence));
    expect(html).toContain("fi-home-stack");
    // The first dot is current and the rotation can be paused (WCAG 2.2.2).
    expect(html.match(/data-question-dot=/g)).toHaveLength(4);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Question 1 of 4: Should we change our outgoing wire fees\?"/);
    expect(html).toMatch(/aria-label="Pause question rotation" aria-pressed="false"/);
  });

  it("rotates the questions, lighting each one's evidence in turn, then opening its output", () => {
    vi.useFakeTimers();
    stubBrowser();
    render(<LandingResearch report={report} revenue={revenue} peers={peers} branches={branches} />);
    const asks = view().asks;
    // On entry the first question's cards light one after another, in its own order.
    act(() => vi.advanceTimersByTime(1));
    expect(litNow()).toEqual([]);
    act(() => vi.advanceTimersByTime(LEAD_MS));
    expect(litNow()).toEqual([asks[0].evidence[0]]);
    act(() => vi.advanceTimersByTime(STEP_MS));
    expect(litNow()).toEqual(inEvidenceOrder(asks[0].evidence.slice(0, 2)));
    act(() => vi.advanceTimersByTime(STEP_MS * 3));
    expect(litNow()).toEqual(inEvidenceOrder(asks[0].evidence));
    expect(tabNow()).toBe("benchmark");
    // The next question fades in; the competitive card now shows its fee; its output opens after its evidence.
    act(() => vi.advanceTimersByTime(ASK_MS));
    expect(questionNow()).toBe(`“${asks[1].question}”`);
    expect(document.querySelector('[data-evidence="competitive"] [data-evidence-caption]')!.textContent).toContain("Our overdraft fee vs. local median");
    expect(tabNow()).toBe("benchmark");
    act(() => vi.advanceTimersByTime(LEAD_MS + STEP_MS * asks[1].evidence.length + 1));
    expect(tabNow()).toBe("investigate");
    expect(litNow()).toEqual(inEvidenceOrder(asks[1].evidence));
    act(() => vi.advanceTimersByTime(ASK_MS));
    expect(questionNow()).toBe(`“${asks[2].question}”`);
    act(() => vi.advanceTimersByTime(LEAD_MS + STEP_MS + 1));
    expect(tabNow()).toBe("monitor");
    expect(litNow()).toEqual(["financial"]);
  });

  it("pauses and plays, and stops for good when a visitor picks a question or a tab", () => {
    vi.useFakeTimers();
    stubBrowser();
    render(<LandingResearch report={report} revenue={revenue} peers={peers} branches={branches} />);
    const asks = view().asks;
    const pause = screen.getByRole("button", { name: "Pause question rotation" });
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(ASK_MS * 4));
    expect(questionNow()).toBe(`“${asks[0].question}”`);
    fireEvent.click(pause);
    act(() => vi.advanceTimersByTime(ASK_MS + 1));
    expect(questionNow()).toBe(`“${asks[1].question}”`);
    // A dot: that question at once, its output open, and the rotation stopped.
    fireEvent.click(screen.getByRole("button", { name: `Question 4 of 4: ${asks[3].question}` }));
    expect(questionNow()).toBe(`“${asks[3].question}”`);
    expect(tabNow()).toBe("report");
    expect(litNow()).toEqual(inEvidenceOrder(asks[3].evidence));
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(ASK_MS * 4));
    expect(questionNow()).toBe(`“${asks[3].question}”`);
    // A tab: its question comes with it.
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(questionNow()).toBe(`“${asks[1].question}”`);
    expect(tabNow()).toBe("investigate");
  });

  it("holds while the pointer is over the section", () => {
    vi.useFakeTimers();
    stubBrowser();
    render(<LandingResearch report={report} revenue={revenue} peers={peers} branches={branches} />);
    const root = document.querySelector("[data-one-question]")!;
    act(() => {
      root.dispatchEvent(new Event("pointerenter"));
    });
    act(() => vi.advanceTimersByTime(ASK_MS * 3));
    expect(questionNow()).toBe(`“${view().asks[0].question}”`);
    act(() => {
      root.dispatchEvent(new Event("pointerleave"));
    });
    act(() => vi.advanceTimersByTime(ASK_MS + 1));
    expect(questionNow()).toBe(`“${view().asks[1].question}”`);
  });

  it("with reduced motion never rotates or sequences, has no pause button, and the dots still switch", () => {
    vi.useFakeTimers();
    stubBrowser({ reduced: true });
    render(<LandingResearch report={report} revenue={revenue} peers={peers} branches={branches} />);
    const asks = view().asks;
    act(() => vi.advanceTimersByTime(ASK_MS * 5));
    expect(questionNow()).toBe(`“${asks[0].question}”`);
    expect(litNow()).toEqual(inEvidenceOrder(asks[0].evidence));
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Question 3 of 4: ${asks[2].question}` }));
    expect(questionNow()).toBe(`“${asks[2].question}”`);
    expect(tabNow()).toBe("monitor");
  });

  it("switches tabs by click and arrow keys, and lights the evidence each output reads", () => {
    stubBrowser({ reduced: true });
    render(<LandingResearch report={report} revenue={revenue} peers={peers} branches={branches} />);
    const tabs = screen.getAllByRole("tab");
    act(() => tabs[0].focus());
    act(() => {
      fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    });
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    act(() => {
      fireEvent.keyDown(tabs[1], { key: "End" });
    });
    expect(tabs[3].getAttribute("aria-selected")).toBe("true");
    act(() => {
      fireEvent.keyDown(tabs[3], { key: "ArrowRight" });
    });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    act(() => {
      fireEvent.click(tabs[2]);
    });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs[2].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
    expect(litNow()).toEqual(["financial"]);
    expect(document.querySelector('[data-panel="monitor"]')!.getAttribute("data-active")).toBe("true");
  });

  it("credits no source the licence rule or #1885 took off the page", () => {
    const named = [full(), ...EVIDENCE.map((e) => `${e.name} ${e.detail}`)].join(" ");
    expect(named).not.toMatch(/FRED|USDA|FINRA|regional Fed|Reserve Bank|national deposit rate|deposit rates/i);
  });
});

describe("sample report page", () => {
  const report = sampleWorkflowReport();
  const preparedOn = new Date("2026-10-18T15:00:00Z");
  const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("shows the first page of the live sample report, drawn by the report's own component, and a link to it", () => {
    const html = renderToStaticMarkup(<LandingDeliverable report={report} preparedOn={preparedOn} />);
    const words = text(html);
    expect(deliverablePage(report)).toEqual({ institutionName: "Capital City Bank", market: "Tallahassee, FL area (3 counties)", competitors: { withData: 21, inMarket: 24 } });
    expect(html).toContain("See what your next pricing committee could walk in with.");
    expect(words).toContain(REPORT_OFFER.name);
    expect(words).toContain("Capital City Bank against its local market");
    expect(words).toContain("Tallahassee, FL area (3 counties) · verified fees for 21 of 24 local competitors · prepared October 18, 2026 by Fee Insight");
    // The report's at-a-glance page, cut to four fees.
    expect(html).toContain('id="glance-heading"');
    expect(words).toContain("3 more fees in the full report");
    // None of the One question section's financial findings, no price and no buy.
    expect(words).not.toMatch(/Deposit service charges|million|Frost/i);
    expect(html).not.toContain(REPORT_OFFER.priceLabel);
    expect(html).not.toMatch(/\bbuy\b|request_report_click|\/month/i);
    expect(html).toMatch(/<a href="\/subscribe"[^>]*data-event="upgrade_click" data-placement="home_deliverable"[^>]*>Get Hamilton for your institution</);
    expect(html).toMatch(/<a href="\/reports\/sample-competitive-fee-position"[^>]*data-event="sample_report_click" data-placement="home_deliverable"[^>]*>Open the full sample/);
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it("hides the page and the sample link when the read failed", () => {
    const html = renderToStaticMarkup(<LandingDeliverable report={null} preparedOn={preparedOn} />);
    expect(deliverablePage(null)).toBeNull();
    expect(html).toContain("Each report is built live, every amount linked to its fee schedule.");
    expect(html).not.toContain("data-deliverable-page");
    expect(html).not.toMatch(/\$\d|Capital City|October/);
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
        <LandingHamilton />
        <LandingResearch />
        <LandingDeliverable report={sampleWorkflowReport()} preparedOn={new Date("2026-10-18T15:00:00Z")} />
        <LandingPricing />
      </>,
    );
    const words = [html, ...EVIDENCE.map((e) => `${e.name} ${e.detail}`)].join(" ");
    expect(words).not.toMatch(
      /FINRA|Zelle|FedNow|\bRTP\b|Clearing House|frbservices|Fed Financial Services|Nacha|Payment services|payment choice|remittance|World Bank|Small Business Credit Survey|small-business lending|Kansas City Fed|KC Fed|Atlanta Fed/i,
    );
    // Every output reads the published fees.
    for (const o of OUTPUTS) expect(o.evidence).toContain("competitive");
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
    expect(html).toMatch(/<a href="\/for-institutions#demo"[^>]*data-event="contact_sales" data-placement="home_pricing_demo">Ask for a demo</);
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
        <LandingHamilton />
        <LandingResearch report={sampleWorkflowReport()} />
        <LandingDeliverable report={sampleWorkflowReport()} preparedOn={new Date("2026-10-18T15:00:00Z")} />
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
