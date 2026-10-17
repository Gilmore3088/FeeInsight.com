import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { combineScores, scoreAnswerKeys, type AnswerKeyDocument, type GateScore } from "./answer-key-gate";

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
// Since v17 the gate counts only reads that pass Knox's self-check (the shared accuracy
// check Darwin applies before publishing). Main at v16 scored 444 right / 15 wrong on that basis;
// floors raised to main at v29 (2026-10-07).
// v68 (#1102, Oct 15): fee-schedule labels with no fee word took all from 515 right / 14 wrong
// (main with v67's dropped-decimal reads and #1365's minus-sign source check) to 537 / 14; held out stayed 53 / 4. Floors are those counts.
// v69 (#1102, Oct 15): price lines named by their heading took all to 545 / 14; held out stayed 53 / 4.
// v70 (#1100, Oct 15): low-balance and maintenance fees the account expert missed took all to 551 / 14
// and held out to 54 / 4.
// v71 (#1100 gap 3, Oct 15): account comparison tables read by column (Texas Capital's $25 checking
// column) took all to 552 / 14; held out stayed 54 / 4; the seven states unchanged.
// v72 (#1099, Oct 16): a loan's payment by phone, card or ACH, and a returned loan or mortgage
// payment, read as other lending, took all to 557 / 14; held out stayed 54 / 4; the seven states unchanged.
// v73 (#1100, Oct 16): reads record their account; no read changes (all 557 / 14, held out 54 / 4, the
// seven states unchanged; every answer-key text's reads are identical to v72's).
// Night deposit option A (James, Oct 16, #1099): the deposit for a night depository receptacle key
// (Prosperity, tid 2451, $6, held out) is a key charge, not the service. #1550 files it out of scope
// in the key, which made Knox's night deposit read of it wrong (556 / 15, held out 53 / 5); guard v66
// (#1605) refuses key deposits, so Knox no longer reads it and the wrong read leaves: all 556 / 14,
// held out 53 / 4.
// v75 (Knox recall, Oct 17): the recurring held name families (rush shipping, mortgage payoff and
// satisfaction, club withdrawals and short-window closures, IRA withdrawals, skip payments, ...) took
// all to 567 / 14; held out stayed 53 / 4. No document gained a wrong read.
const FLOORS = {
  all: { right: 567, wrong: 14 },
  holdout: { right: 53, wrong: 4 },
};

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/texas-answer-keys.json.gz"))).toString("utf8"),
) as { keys: AnswerKeyDocument[] };

// Each document is scored once and the floors add the scores up: the total and its parts no
// longer read the same texts twice.
const scored = new Map<AnswerKeyDocument, GateScore>();
const scoreOnce = (document: AnswerKeyDocument): GateScore => {
  if (!scored.has(document)) scored.set(document, scoreAnswerKeys([document]));
  return scored.get(document)!;
};

describe("Knox answer-key gate (Texas)", () => {
  it("covers every answer-key document", () => {
    expect(fixture.keys).toHaveLength(43);
    expect(fixture.keys.filter((document) => document.set === "holdout")).toHaveLength(17);
  });

  for (const [name, floor] of Object.entries(FLOORS)) {
    // The self-check traces every read against its text, so a whole fixture takes several seconds.
    it(`reads at least ${floor.right} right fees and at most ${floor.wrong} wrong ones (${name})`, () => {
      const documents = name === "all" ? fixture.keys : fixture.keys.filter((document) => document.set === name);
      const score = combineScores(documents.map(scoreOnce));
      const wrong = score.categoryErrors + score.amountErrors;
      const summary =
        `${name}: ${score.right} right of ${score.reads} reads (precision ${(score.precision * 100).toFixed(1)}%), ` +
        `${score.found} of ${score.expected} key fees found (coverage ${(score.coverage * 100).toFixed(1)}%), ` +
        `wrong: ${score.errors.map((error) => `${error.tid} ${error.fee} (${error.kind})`).join(", ")}`;
      expect(score.right, summary).toBeGreaterThanOrEqual(floor.right);
      expect(wrong, summary).toBeLessThanOrEqual(floor.wrong);
    }, 60_000);
  }
});
