import { describe, expect, it } from "vitest";
import {
  alertWeeks,
  buildAlertFeed,
  buildAlertSummary,
  daysBefore,
  filterAlertFeed,
  weekIndex,
  weeklyCounts,
  watchSuggestions,
  type AlertChangeInput,
} from "./alerts-dashboard";

const NOW = new Date("2026-11-02T15:00:00Z"); // a Monday

function change(over: Partial<AlertChangeInput>): AlertChangeInput {
  return {
    institution_id: 1,
    institution_name: "Example Bank",
    state_code: "FL",
    fee_category: "overdraft",
    display_name: "Overdraft",
    old_amount: 30,
    new_amount: 35,
    direction: "up",
    changed_at: "2026-10-28",
    ...over,
  };
}

describe("alert weeks", () => {
  it("covers twelve weeks starting Monday, the last holding today", () => {
    const weeks = alertWeeks(NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks[11].start).toBe("2026-11-02");
    expect(weeks[0].start).toBe("2026-08-17");
    expect(weeks[0].label).toBe("Aug 17");
    expect(alertWeeks(new Date("2026-11-04T01:00:00Z"))[11].start).toBe("2026-11-02");
  });

  it("places a day in its week, and outside days at -1", () => {
    const weeks = alertWeeks(NOW);
    expect(weekIndex("2026-08-17", weeks)).toBe(0);
    expect(weekIndex("2026-08-23", weeks)).toBe(0);
    expect(weekIndex("2026-10-07", weeks)).toBe(7);
    expect(weekIndex("2026-08-16", weeks)).toBe(-1);
    expect(daysBefore(NOW, 30)).toBe("2026-10-03");
  });
});

describe("alert feed", () => {
  const weeks = alertWeeks(NOW);
  const feed = buildAlertFeed(
    [
      change({ institution_id: 1, changed_at: "2026-10-07" }),
      change({ institution_id: 2, institution_name: "Frost Bank", changed_at: "2026-10-30" }),
      change({ institution_id: 3, institution_name: "Hill CU", state_code: "TX", direction: "down", old_amount: 15, new_amount: 5, changed_at: "2026-10-31" }),
    ],
    weeks,
  );

  it("lists named changes newest first, with their week", () => {
    expect(feed.map((r) => r.institution)).toEqual(["Hill CU", "Example Bank"]);
    expect(feed[0]).toMatchObject({ date: "Oct 31, 2026", state: "TX", from: 15, to: 5, week: 10, institutionId: "3" });
  });

  it("filters by direction and state, and counts per week", () => {
    expect(filterAlertFeed(feed, { direction: "up", state: "all" }).map((r) => r.institution)).toEqual(["Example Bank"]);
    expect(filterAlertFeed(feed, { direction: "all", state: "TX" })).toHaveLength(1);
    const counts = weeklyCounts(feed, weeks.length);
    expect(counts[7]).toBe(1);
    expect(counts[10]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("alert summary", () => {
  it("counts active watches, alerts on them, national and state changes", () => {
    const kpis = buildAlertSummary({
      activeWatchIds: ["1"],
      offWatches: 1,
      national: { recent: [{ direction: "up", institutionId: "1" }, { direction: "down", institutionId: "9" }] },
      state: { label: "Florida", days: 180, changes: [] },
    });
    expect(kpis.map((k) => [k.label, k.value])).toEqual([
      ["Watches active", "1"],
      ["Alerts, last 30 days", "1"],
      ["Fees changed, US, 30 days", "2"],
      ["Florida changes, 180 days", "0"],
    ]);
    expect(kpis[0].sub).toBe("1 turned off");
    expect(kpis[2].sub).toBe("▲ 1 up · ▼ 1 down");
    expect(kpis[3].sub).toBe("No institution in Florida changed a fee");
  });

  it("says a count was not read rather than showing zero", () => {
    const kpis = buildAlertSummary({ activeWatchIds: [], offWatches: 0, national: null, state: null });
    expect(kpis[1].value).toBe("Not read");
    expect(kpis[2].value).toBe("Not read");
    expect(kpis[3].value).toBe("Not read");
    expect(buildAlertSummary({ activeWatchIds: [], offWatches: 0, national: null, state: undefined })[3].value).toBe("Not set");
  });
});

describe("watch suggestions", () => {
  it("offers the institution, then recent state changers, never one watched or never named", () => {
    const out = watchSuggestions({
      selected: { id: "5", name: "Home Bank" },
      stateChanges: [
        { institution_id: 1, institution_name: "Example Bank", changed_at: "2026-10-01" },
        { institution_id: 2, institution_name: "Space Coast Credit Union", changed_at: "2026-10-20" },
        { institution_id: 3, institution_name: "Bay CU", changed_at: "2026-10-10" },
        { institution_id: 4, institution_name: "Watched Bank", changed_at: "2026-10-25" },
      ],
      watchedIds: new Set(["4"]),
    });
    expect(out.map((s) => s.name)).toEqual(["Home Bank", "Bay CU", "Example Bank"]);
    expect(out[1].reason).toBe("Changed a fee Oct 10");
  });
});
