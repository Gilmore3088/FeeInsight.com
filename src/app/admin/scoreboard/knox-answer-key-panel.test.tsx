import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GoalScorecard, KnoxAnswerKeyScore } from "@/lib/agents/goal-scorecard";
import { KnoxAnswerKeyPanel } from "./knox-answer-key-panel";

const goal = (extra: Partial<GoalScorecard>) => ({ readAt: "2026-10-26T18:00:00Z", windowDays: 7, ...extra }) as GoalScorecard;
const score: KnoxAnswerKeyScore = {
  query: "goal.knox_answer_key_right_document",
  scoreRunId: 41,
  scoredAt: "2026-10-26T06:00:00.000Z",
  scorerVersion: 3,
  referenceState: "measured",
  banks: 2,
  expected: 30,
  found: 23,
  reads: 26,
  right: 23,
  recall: 0.7667,
  precision: 0.8846,
  bySpecialist: [
    { strategy: "extract.rules", banks: 2, found: 20, foundOnly: 18, reads: 24, right: 21, precision: 0.875, shareOfKey: 0.6667 },
    { strategy: "extract.family.overdraft_nsf", banks: 1, found: 3, foundOnly: 1, reads: 3, right: 3, precision: 1, shareOfKey: 0.1 },
  ],
};

describe("Knox's answer-key targets on the scorecard (#1098)", () => {
  it("shows found and right against 85% and 90%, and a row per specialist", () => {
    const html = renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: score })} />);
    expect(html).toContain("76.7%");
    expect(html).toContain("target 85.0%, not met");
    expect(html).toContain("88.5%");
    expect(html).toContain("target 90.0%, not met");
    expect(html).toContain("23 of 30");
    expect(html).toContain("23 of 26");
    expect(html).toContain("answer-key score run #41");
    expect(html).toContain("extract.family.overdraft_nsf");
    expect(html).toContain("87.5%");
    expect(html).toContain("goal.knox_answer_key_right_document");
  });

  it("says a failed read failed, waits on an older snapshot, and on an older score for specialist rows", () => {
    expect(renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: null })} />)).toContain("Could not be read.");
    expect(renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({})} />)).toContain("appear with the next daily scoreboard");
    const older = renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: { ...score, bySpecialist: null } })} />);
    expect(older).toContain("76.7%");
    expect(older).toContain("Specialist rows appear with the next answer-key score.");
  });

  it("shows no shares when there is no score or no eligible reference bank", () => {
    const none = renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: { ...score, scoreRunId: null } })} />);
    expect(none).toContain("No answer-key score yet");
    expect(none).not.toContain("76.7%");
    const unmeasured = renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: { ...score, referenceState: "no_measurement" } })} />);
    expect(unmeasured).toContain("Not measured");
    expect(unmeasured).not.toContain("76.7%");
    expect(unmeasured).not.toContain("extract.rules");
  });
});
