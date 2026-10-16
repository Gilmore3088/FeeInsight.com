import { describe, expect, it } from "vitest";

import { affectedSavedOutputsLabel, savedOutputNotice } from "./saved-output-corrections";

// H03-T09 (#978): a saved output made before a fee change keeps its figures and says so.

const saved = "2026-10-10T09:00:00.000Z";

describe("saved output notice", () => {
  it("should_say_nothing_when_no_fee_changed_after_the_output_was_saved", () => {
    expect(savedOutputNotice([], saved)).toBeNull();
    expect(savedOutputNotice([{ kind: "correct", at: "2026-10-09T09:00:00.000Z" }, { kind: "hold", at: saved }], saved)).toBeNull();
  });

  it("should_name_one_change_and_its_date_without_rewriting_the_output", () => {
    const notice = savedOutputNotice([{ kind: "correct", at: "2026-10-16T12:00:00.000Z" }], saved);
    expect(notice?.count).toBe(1);
    expect(notice?.text).toBe(
      "This institution's fee data changed after this answer was saved: 1 fee corrected on Oct 16, 2026. " +
        "The saved answer keeps the figures it showed then.",
    );
  });

  it("should_group_several_changes_and_give_the_latest_date", () => {
    const notice = savedOutputNotice([
      { kind: "hold", at: "2026-10-12T12:00:00.000Z" },
      { kind: "correct", at: "2026-10-14T12:00:00.000Z" },
      { kind: "correct", at: "2026-10-15T12:00:00.000Z" },
    ], saved, "report");
    expect(notice?.latestAt).toBe("2026-10-15T12:00:00.000Z");
    expect(notice?.text).toContain("2 fees corrected and 1 fee taken out for review, the latest on Oct 15, 2026.");
    expect(notice?.text).toContain("The saved report keeps");
  });

  it("should_never_name_a_pipeline_agent_or_suggest_a_fee_change", () => {
    const notice = savedOutputNotice([
      { kind: "correct", at: "2026-10-16T12:00:00.000Z" },
      { kind: "reverse", at: "2026-10-16T13:00:00.000Z" },
      { kind: "hold", at: "2026-10-16T14:00:00.000Z" },
      { kind: "release", at: "2026-10-16T15:00:00.000Z" },
    ], saved);
    expect(notice?.text).not.toMatch(/Atlas|Magellan|Rosetta|Knox|Darwin|should|recommend|raise|lower/i);
  });

  it("should_label_affected_saved_outputs_and_keep_unknown_counts_honest", () => {
    expect(affectedSavedOutputsLabel({ analyses: 3, reports: 1, briefings: 0 })).toBe("3 saved answers, 1 report");
    expect(affectedSavedOutputsLabel({ analyses: 0, reports: 0, briefings: 0 })).toBe("none");
    expect(affectedSavedOutputsLabel({ analyses: 0, reports: null, briefings: 0 })).toBe("unknown");
    expect(affectedSavedOutputsLabel({ analyses: 2, reports: null, briefings: 0 })).toBe("2 saved answers (some unreadable)");
    expect(affectedSavedOutputsLabel(null)).toBe("unknown");
  });
});
