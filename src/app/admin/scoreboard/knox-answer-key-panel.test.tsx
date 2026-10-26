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
  confirmedBanks: 62,
  eligibleBanks: 12,
  topExclusions: [],
  banks: 12,
  expected: 300,
  found: 230,
  reads: 260,
  right: 230,
  recall: 0.7667,
  precision: 0.8846,
  bySpecialist: [
    { strategy: "extract.rules", banks: 12, found: 200, foundOnly: 180, reads: 240, right: 210, precision: 0.875, shareOfKey: 0.6667 },
    { strategy: "extract.table", banks: 3, found: 5, foundOnly: 2, reads: 6, right: 4, precision: 0.6667, shareOfKey: 0.0167 },
  ],
};

/** Production, Oct 26 (score run 62, scorer v3, SELECT only): 2 of 62 answer-key banks qualify. */
const production: KnoxAnswerKeyScore = {
  ...score,
  scoreRunId: 62,
  scoredAt: "2026-10-26T12:40:00.000Z",
  confirmedBanks: 62,
  eligibleBanks: 2,
  topExclusions: [
    { reason: "key_line_not_in_reference", count: 15 },
    { reason: "reference_source_superseded", count: 14 },
    { reason: "consumer_scope_unproven", count: 12 },
  ],
  banks: 2,
  expected: 60,
  found: 46,
  reads: 55,
  right: 42,
  recall: 0.7667,
  precision: 0.7636,
  bySpecialist: [{ strategy: "extract.rules", banks: 2, found: 40, foundOnly: 38, reads: 50, right: 38, precision: 0.76, shareOfKey: 0.6667 }],
};

describe("Knox's answer-key targets on the scorecard (#1098)", () => {
  it("judges found and right against 85% and 90% once 10 banks qualify, and a row per specialist", () => {
    const html = renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: score })} />);
    expect(html).toContain("76.7%");
    expect(html).toContain("target 85.0%, not met");
    expect(html).toContain("88.5%");
    expect(html).toContain("target 90.0%, not met");
    expect(html).toContain("230 of 300");
    expect(html).toContain("230 of 260");
    expect(html).toContain("12 of 62 answer-key banks are eligible references (key still current).");
    expect(html).not.toContain("Too few banks");
    expect(html).toContain("answer-key score run #41");
    expect(html).toContain("extract.table");
    expect(html).toContain("87.5%");
    // A specialist read from 3 banks is shown but not marked under 90%; one from 12 banks is.
    expect(html).toMatch(/<td class="py-1 text-right tabular-nums ">66\.7%/);
    expect(html).toMatch(/font-semibold text-amber-700 dark:text-amber-400">87\.5%/);
    expect(html).toContain("goal.knox_answer_key_right_document");
  });

  it("shows production's 2-bank score with its counts, and waits for 10 banks to judge it", () => {
    const html = renderToStaticMarkup(<KnoxAnswerKeyPanel goal={goal({ knoxAnswerKey: production })} />);
    expect(html).toContain("76.7%");
    expect(html).toContain("46 of 60");
    expect(html).toContain("76.4%");
    expect(html).toContain("42 of 55");
    expect(html).not.toContain("not met");
    expect(html).not.toContain(", met");
    expect(html.match(/Too few banks to judge against the target \(fewer than 10\)/g)).toHaveLength(2);
    expect(html).toContain("2 of 62 answer-key banks are eligible references (key still current).");
    expect(html).toContain("a key line is no longer in the bank&#x27;s document (15), the bank has a newer document (14), not shown to be the consumer schedule (12)");
    expect(html).not.toContain("amber");
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
