import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  article: null as Record<string, unknown> | null,
  related: [] as Record<string, unknown>[],
  incrementViewCount: vi.fn(async () => undefined),
  sample: false,
}));

// next/font runs only under the Next compiler; the page reads just the CSS variable name.
vi.mock("next/font/local", () => ({ default: () => ({ variable: "home-serif", className: "" }) }));
// The browser counter is a client component; the server render only places it.
vi.mock("./view-count", () => ({ ArticleViewCount: ({ slug }: { slug: string }) => <span data-view-count={slug} /> }));
vi.mock("@/lib/data-store/articles", () => ({
  getArticleBySlug: vi.fn(async () => mocks.article),
  getPublishedArticles: vi.fn(async () => mocks.related),
  incrementViewCount: mocks.incrementViewCount,
}));
vi.mock("@/lib/data-store/guides", () => ({
  getGuidesForCategory: vi.fn(async (category: string) => (category === "overdraft" ? [{ slug: "overdraft-fees", title: "How overdraft fees work" }] : [])),
}));
vi.mock("@/lib/custom-report/sample-report", () => ({ sampleReportAvailable: vi.fn(async () => mocks.sample) }));
vi.mock("@/components/track-link", () => ({
  TrackLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import ArticlePage from "./page";

// The weekly fee article's shape, as stored: opening line, chart + table + one sentence per size
// section, a prose section with a list, a long state table, the method section and "As of".
const stateRows = Array.from({ length: 12 }, (_, i) => `| [State ${i + 1}](https://feeinsight.com/research/state/S${i}) | ${20 + i} | $0 | $${25 + i} | $50 |`);
const CONTENT = [
  "A single national number hides the pattern. Sort banks and credit unions by size and they move in opposite directions.",
  "## Banks: the larger the bank, the higher the fee",
  "```bars Median overdraft fee at banks, by size\nUnder $300 million | 30 | $30\nOver $50 billion | 35 | $35\n```",
  "| Bank size (total assets) | Banks | Median overdraft fee |\n|---|---|---|\n| Under $300 million | 203 | $30 |\n| Over $50 billion | 29 | $35 |",
  "Banks under $300 million in assets sit at a $30 median; banks over $50 billion at $35.",
  "## The state matters less than the institution",
  "State medians run from $25 to $35.",
  "- **California** has the lowest median, $25.\n- **Mississippi** has the highest median, $35.",
  "## Every state with enough data",
  ["| State | Institutions | Lowest | Median | Highest |", "|---|---|---|---|---|", ...stateRows].join("\n"),
  "## How these numbers are built",
  "Each figure comes from the Bank Fee Index, built from each institution's own published fee schedule.",
  "As of October 2026.",
].join("\n\n");

function published(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "overdraft-fees-by-state-2026-10",
    title: "Bigger banks charge more for an overdraft. Bigger credit unions charge less.",
    subtitle: "What published fee schedules say about the overdraft fee, by institution size and by state.",
    content: CONTENT,
    category: "analysis",
    tags: '["overdraft","states"]',
    author: "Fee Insight Research",
    status: "published",
    generated_by: "growth:ernest",
    conversation_id: null,
    published_at: "2026-10-08T15:04:34Z",
    created_at: "2026-10-08T15:04:34Z",
    updated_at: "2026-10-08T15:04:34Z",
    view_count: 0,
    ...overrides,
  };
}

async function renderPage() {
  const ui = await ArticlePage({ params: Promise.resolve({ slug: "overdraft-fees-by-state-2026-10" }) });
  return render(ui);
}

describe("research article page", () => {
  beforeEach(() => {
    mocks.article = published();
    mocks.related = [];
    mocks.sample = false;
    mocks.incrementViewCount.mockClear();
  });

  it("opens with the headline, a dated byline and the opening finding", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(mocks.article!.title);
    const header = screen.getByRole("banner");
    expect(header.textContent).toContain("Fee Insight Research·October 8, 2026·Data as of October 2026");
    expect(within(header).getByText(/A single national number hides the pattern/)).toBeTruthy();
  });

  it("puts the sections' own first sentences at the top as key points, each linked to its evidence", async () => {
    await renderPage();
    const points = within(screen.getByRole("list", { name: "Key points" })).getAllByRole("link");
    expect(points.map((p) => p.getAttribute("href"))).toEqual([
      "#s-banks-the-larger-the-bank-the-higher-the-fee",
      "#s-the-state-matters-less-than-the-institution",
    ]);
    expect(points[0].textContent).toBe("Banks under $300 million in assets sit at a $30 median; banks over $50 billion at $35., see the chart");
    expect(points[1].textContent).toBe("State medians run from $25 to $35., see the section");
  });

  it("sets the headline, section heads and Hamilton band in the homepage serif", async () => {
    await renderPage();
    for (const heading of [screen.getByRole("heading", { level: 1 }), ...screen.getAllByRole("heading", { level: 2 }).slice(0, 4)]) {
      expect(heading.getAttribute("style")).toContain("--fi-home-serif");
    }
  });

  it("writes nothing while rendering: the view is counted from the browser", async () => {
    await renderPage();
    expect(mocks.incrementViewCount).not.toHaveBeenCalled();
    expect(document.querySelector('[data-view-count="overdraft-fees-by-state-2026-10"]')).toBeTruthy();
  });

  it("gives each section its title, finding, labeled exhibit and source", async () => {
    await renderPage();
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "Banks: the larger the bank, the higher the fee",
      "The state matters less than the institution",
      "Every state with enough data",
      "Hey Hamilton,How do our fees compare?",
    ]);
    const banks = document.getElementById("s-banks-the-larger-the-bank-the-higher-the-fee")!;
    const text = banks.textContent!;
    // Finding before the exhibit, the exhibit's label, then the source.
    expect(text.indexOf("sit at a $30 median")).toBeLessThan(text.indexOf("Median overdraft fee at banks, by size"));
    expect(text).toContain("Source: Bank Fee Index, from banks' and credit unions' own published fee schedules. Data as of October 2026.");
    // A prose section with no exhibit carries no source line of its own.
    expect(document.getElementById("s-the-state-matters-less-than-the-institution")!.textContent).not.toContain("Source:");
  });

  it("shows five rows of a long table, then a Show all control", async () => {
    await renderPage();
    const states = document.getElementById("s-every-state-with-enough-data")!;
    expect(within(states).getAllByRole("row")).toHaveLength(1 + 5);
    expect(within(states).getByRole("button", { name: "Show all 12 rows" })).toBeTruthy();
  });

  it("keeps the method behind a disclosure and Hamilton to one band", async () => {
    await renderPage();
    const summary = screen.getByText("How these numbers are built");
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getAllByRole("link", { name: "See Hamilton plans" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Ask for a demo" })).toBeTruthy();
  });

  it("keeps the paid report as one text link to the request form under Hamilton's band", async () => {
    await renderPage();
    const band = document.getElementById("hamilton-heading")!.closest("section")!;
    const report = within(band).getByRole("link", {
      name: "Request the Competitive Fee Position Report, from $300",
    });
    expect(report.getAttribute("href")).toBe("/reports?report=institution#request");
    const links = within(band).getAllByRole("link").map((link) => link.textContent);
    expect(links[0]).toBe("See Hamilton plans");
    expect(links.at(-1)).toBe("Request the Competitive Fee Position Report, from $300");
  });

  it("offers the sample report when it is live", async () => {
    mocks.sample = true;
    await renderPage();
    expect(screen.getByRole("link", { name: "See the sample Competitive Fee Position Report" })).toBeTruthy();
  });

  it("puts further paragraphs after the source, and a quiet consumer next step before More research", async () => {
    mocks.related = [published({ slug: "nsf-2026-10", title: "NSF fees by size" })];
    await renderPage();
    const state = document.getElementById("s-the-state-matters-less-than-the-institution")!.textContent!;
    expect(state.indexOf("State medians run")).toBeLessThan(state.indexOf("California"));
    const lookup = screen.getByRole("link", { name: "Look up a bank or credit union's fees" });
    expect(lookup.getAttribute("href")).toBe("/institutions");
    expect(screen.getByRole("link", { name: "How overdraft fees work" }).getAttribute("href")).toBe("/guides/overdraft-fees");
    const more = screen.getByRole("heading", { name: "More research" });
    expect(lookup.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("signs the product name as the research imprint", async () => {
    mocks.article = published({ author: "Bank Fee Index" });
    await renderPage();
    expect(screen.getByRole("banner").textContent).toContain("Fee Insight Research");
  });
});
