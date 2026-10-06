import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { scoreAnswerKeys, type AnswerKeyDocument } from "./answer-key-gate";

/**
 * The gate every Knox rules change passes before it can merge: today's free team plus
 * Darwin's rule checks, scored against 43 hand-checked Texas fee schedules (26 used while
 * writing rules, 17 held out). The floors are today's counts. A change that loses a right
 * fee or adds a wrong read fails here, before the rules re-check can take live fees down.
 *
 * When a change really improves Knox, raise RIGHT and lower WRONG to the new counts in the
 * same PR. When it trades a right fee for something worth more, say so in the PR and lower
 * the floor there; never lower it silently.
 */
const FLOORS = {
  all: { right: 436, wrong: 18 },
  holdout: { right: 41, wrong: 6 },
};

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/texas-answer-keys.json.gz"))).toString("utf8"),
) as { keys: AnswerKeyDocument[] };

describe("Knox answer-key gate (Texas)", () => {
  it("covers every answer-key document", () => {
    expect(fixture.keys).toHaveLength(43);
    expect(fixture.keys.filter((document) => document.set === "holdout")).toHaveLength(17);
  });

  for (const [name, floor] of Object.entries(FLOORS)) {
    it(`reads at least ${floor.right} right fees and at most ${floor.wrong} wrong ones (${name})`, () => {
      const documents = name === "all" ? fixture.keys : fixture.keys.filter((document) => document.set === name);
      const score = scoreAnswerKeys(documents);
      const wrong = score.categoryErrors + score.amountErrors;
      const summary =
        `${name}: ${score.right} right of ${score.reads} reads (precision ${(score.precision * 100).toFixed(1)}%), ` +
        `${score.found} of ${score.expected} key fees found (coverage ${(score.coverage * 100).toFixed(1)}%), ` +
        `wrong: ${score.errors.map((error) => `${error.tid} ${error.fee} (${error.kind})`).join(", ")}`;
      expect(score.right, summary).toBeGreaterThanOrEqual(floor.right);
      expect(wrong, summary).toBeLessThanOrEqual(floor.wrong);
    });
  }
});
