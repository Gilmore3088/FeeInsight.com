import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { scoreAnswerKeys, type AnswerKeyDocument } from "./answer-key-gate";

/**
 * The same gate as the Texas one, on 38 fee schedules from CA, FL, GA, IL, MI, MN and NY
 * (8 stored texts sampled per state, keyed by hand line by line on 2026-10-06; the texts that
 * were not fee schedules are left out). No rule was ever written against these keys, so they
 * show how Texas-tuned rules carry to other states. Floors are today's counts per state; raise
 * them when a change improves Knox, and never lower one without saying why in the PR.
 */
const FLOORS: Record<string, { right: number; wrong: number }> = {
  CA: { right: 117, wrong: 10 },
  FL: { right: 93, wrong: 7 },
  GA: { right: 140, wrong: 13 },
  IL: { right: 85, wrong: 7 },
  MI: { right: 103, wrong: 0 },
  MN: { right: 90, wrong: 14 },
  NY: { right: 37, wrong: 8 },
  all: { right: 665, wrong: 59 },
};

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/state-answer-keys.json.gz"))).toString("utf8"),
) as { keys: Array<AnswerKeyDocument & { state: string }> };

describe("Knox answer-key gate (seven states)", () => {
  it("covers every keyed fee schedule", () => {
    expect(fixture.keys).toHaveLength(38);
  });

  for (const [state, floor] of Object.entries(FLOORS)) {
    it(`reads at least ${floor.right} right fees and at most ${floor.wrong} wrong ones (${state})`, () => {
      const documents = state === "all" ? fixture.keys : fixture.keys.filter((document) => document.state === state);
      const score = scoreAnswerKeys(documents);
      const wrong = score.categoryErrors + score.amountErrors;
      const summary =
        `${state}: ${score.right} right of ${score.reads} reads (precision ${(score.precision * 100).toFixed(1)}%), ` +
        `${score.found} of ${score.expected} key fees found (coverage ${(score.coverage * 100).toFixed(1)}%), ` +
        `wrong: ${score.errors.map((error) => `${error.tid} ${error.fee} (${error.kind})`).join(", ")}`;
      expect(score.right, summary).toBeGreaterThanOrEqual(floor.right);
      expect(wrong, summary).toBeLessThanOrEqual(floor.wrong);
    });
  }
});
