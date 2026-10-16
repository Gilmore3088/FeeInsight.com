import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { buildHomeData } from "@/app/landing-shared";
import { buildScenario } from "./scenario";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ event, eventProps, href, children }: { event: string; eventProps?: { placement?: string }; href: string; children: React.ReactNode }) => (
    <a href={href} data-event={event} data-placement={eventProps?.placement}>
      {children}
    </a>
  ),
}));

import { PlanIncludes, PlansExhibit, plansExhibitViews } from "./plans-exhibit";

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

function category(fee_category: string): FeeCategorySummary {
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
    cu_median_amount: 28,
  } as FeeCategorySummary;
}

const categories = ["overdraft", "nsf", "stop_payment"].map(category);
const live = buildHomeData(summary, categories, [], {
  scenario: buildScenario("Overdraft", categories[0]),
});
const wire = {
  source: "FED",
  title: "A release",
  detail: null,
  date: null,
  url: null,
  officialTitle: null,
  place: null,
  figures: [],
};

describe("/subscribe Hamilton window", () => {
  it("shows the homepage's live views, then the Wire when an item was read", () => {
    expect(plansExhibitViews(live, null).map((v) => v.key)).toEqual(["fees", "price", "reports"]);
    expect(plansExhibitViews(live, wire).map((v) => v.key)).toEqual(["fees", "price", "reports", "wire"]);
  });

  it("is left out when the live index could not be read", () => {
    const empty = buildHomeData(summary, [], []);
    expect(plansExhibitViews(empty, wire)).toEqual([]);
    expect(renderToStaticMarkup(<PlansExhibit data={empty} wire={wire} />)).toBe("");
  });

  it("offers a Pro demo as its one action", () => {
    const html = renderToStaticMarkup(<PlansExhibit data={live} wire={null} />);
    expect(html).toContain('href="/contact?source=demo"');
    expect(html).toContain('data-placement="pricing_exhibit_demo"');
    expect(html).toContain("Ask for a demo");
  });

  it("lists what every plan includes, seats from the workspace limit", () => {
    const html = renderToStaticMarkup(<PlanIncludes />);
    expect(html).toContain("Full Bank Fee Index access");
    for (const label of ["Your institution", "Ask Hamilton", "Try a price", "Reports", "Regulatory Wire"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/Up to \d+ people/);
  });
});
