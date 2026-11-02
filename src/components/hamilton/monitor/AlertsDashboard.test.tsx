import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { alertWeeks, buildAlertFeed } from "@/lib/hamilton/dashboard/alerts-dashboard";
import { BarChart, Switch } from "@/components/hamilton/dashboard";
import { AlertsDashboard, type AlertsDashboardProps } from "./AlertsDashboard";

vi.mock("@/app/pro/(hamilton)/monitor/actions", () => ({
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

const NOW = new Date("2026-11-02T15:00:00Z");
const weeks = alertWeeks(NOW);

function props(over: Partial<AlertsDashboardProps> = {}): AlertsDashboardProps {
  return {
    stateCode: "FL",
    stateLabel: "Florida",
    initialWatches: [{ institutionId: "7", displayName: "Example Bank", status: "current", city: "Tampa", stateCode: "FL", lastReadAt: "2026-10-27T10:00:00Z" }],
    feed: buildAlertFeed(
      [
        { institution_id: 7, institution_name: "Example Bank", state_code: "FL", fee_category: "overdraft", display_name: "Overdraft", old_amount: 30, new_amount: 35, direction: "up", changed_at: "2026-10-28" },
        { institution_id: 8, institution_name: "Hill CU", state_code: "TX", fee_category: "wire_domestic_incoming", display_name: "Wire, domestic in", old_amount: 15, new_amount: 5, direction: "down", changed_at: "2026-10-31" },
      ],
      weeks,
    ),
    nationalRecent: [{ direction: "up", institutionId: "7" }, { direction: "down", institutionId: "8" }],
    asOf: "2026-11-02",
    weeks,
    state: { label: "Florida", days: 180, changes: [{ direction: "up" }] },
    suggestions: [{ id: "5", name: "Home Bank", reason: "Your institution" }],
    feedPeriod: "Aug 17 to Nov 2, 2026",
    ...over,
  };
}

describe("AlertsDashboard", () => {
  it("shows the summary, the watch list, the builder and the change feed", () => {
    const html = renderToStaticMarkup(<AlertsDashboard {...props()} />);
    expect(html).toContain("Watches active");
    expect(html).toContain("Alerts, last 30 days");
    expect(html).toContain("Fees changed, US, 30 days");
    expect(html).toContain("Florida changes, 180 days");
    expect(html).toContain("Example Bank");
    expect(html).toContain("Oct 27, 2026");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Delete watch: Example Bank"');
    expect(html).toContain('id="new-watch"');
    expect(html).toContain("Home Bank");
    expect(html).toContain("Any confirmed fee change");
    expect(html).toContain("Hill CU");
    expect(html).toContain("$15 → $5");
    expect(html).toContain("You watch");
    expect(html).toContain("FL (yours)");
    expect(html).toContain('role="img"');
    expect(html).toContain("Week of Oct 26: 2 changes");
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/Magellan|Rosetta|Knox|Darwin|Atlas/);
  });

  it("says when the changes could not be read, and when nothing is watched", () => {
    const html = renderToStaticMarkup(<AlertsDashboard {...props({ feed: null, nationalRecent: null, initialWatches: [] })} />);
    expect(html).toContain("Fee changes could not be read just now.");
    expect(html).toContain("No watches yet. Add one with New watch.");
    expect(html).toContain("Not read");
  });
});

describe("kit additions", () => {
  it("BarChart describes itself as one image and makes each bar a toggle", () => {
    const html = renderToStaticMarkup(
      <BarChart label="Changes per week: 1, 0" bars={[{ key: "0", label: "Oct 5", value: 1 }, { key: "1", label: "Oct 12", value: 0 }]} selected="0" onSelect={() => {}} />,
    );
    expect(html).toContain('role="img" aria-label="Changes per week: 1, 0"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Oct 12: 0"');
  });

  it("Switch is a named switch button", () => {
    const html = renderToStaticMarkup(<Switch checked={false} onChange={() => {}} label="Watch Example Bank" />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Watch Example Bank"');
  });
});
