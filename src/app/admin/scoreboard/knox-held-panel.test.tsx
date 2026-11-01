import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GoalScorecard } from "@/lib/agents/goal-scorecard";
import { KnoxHeldPanel } from "./knox-held-panel";

const goal = (extra: Partial<GoalScorecard>) => ({ readAt: "2026-10-26T18:00:00Z", windowDays: 7, ...extra }) as GoalScorecard;
const week = { steps: 56, toDarwin: 31, heldRecheck: 23, nameFiled: 7, untraced: 1, rates: 0, setAside: 394, backOnHold: 5 };

describe("Knox's held lines on the scorecard (#1102 item 4)", () => {
  it("shows the pile by reason and age, a group with no way out, and the weekly exits", () => {
    const html = renderToStaticMarkup(<KnoxHeldPanel goal={goal({
      knoxHeld: { query: "goal.knox_held_by_reason_age", total: 1513, setAside: 0, byReason: [{
        shape: "varies", label: "A price the schedule does not print", count: 1513, setAside: 0,
        ages: { under7: 636, days7to14: 877, days14to30: 0, over30: 0 }, owner: "Knox", hasExit: false,
      }] },
      knoxHeldExits: { query: "goal.knox_held_exits_weekly", weeks: [
        { weekStart: "2026-10-19", partial: false, ...week, steps: 0 },
        { weekStart: "2026-10-26", partial: true, ...week },
      ] },
    })} />);
    expect(html).toContain("A price the schedule does not print");
    expect(html).toContain("1,513");
    expect(html).toContain("877");
    expect(html).toContain(">None<");
    expect(html).toContain("2026-10-26 (so far)");
    expect(html).toContain(">31<");
    expect(html).toContain("goal.knox_held_exits_weekly");
    // Says what the ledger cannot show instead of a number it does not have.
    expect(html).toContain("New held lines per week are not shown");
  });

  it("says a failed read failed, and waits for the next snapshot on an older one", () => {
    const failed = renderToStaticMarkup(<KnoxHeldPanel goal={goal({ knoxHeld: null, knoxHeldExits: null })} />);
    expect(failed.match(/Could not be read\./g)).toHaveLength(2);
    expect(renderToStaticMarkup(<KnoxHeldPanel goal={goal({})} />)).toContain("appear with the next daily scoreboard");
  });
});
