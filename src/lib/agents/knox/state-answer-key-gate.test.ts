import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { combineScores, scoreAnswerKeys, type AnswerKeyDocument, type GateScore } from "./answer-key-gate";

/**
 * The same gate as the Texas one, on 38 fee schedules from CA, FL, GA, IL, MI, MN and NY
 * (8 stored texts sampled per state, keyed by hand line by line on 2026-10-06; the texts that
 * were not fee schedules are left out). No rule was ever written against these keys, so they
 * show how Texas-tuned rules carry to other states. Floors are today's counts per state; raise
 * them when a change improves Knox, and never lower one without saying why in the PR.
 */
// Since v17 the gate counts only reads that pass Knox's self-check; main at v16 scored 659
// right / 48 wrong on that basis. Floors raised to main at v29 (2026-10-07), and CA, GA, MN and
// all to the top-50 fold (Oct 8: 724 right / 46 wrong, from 723 / 47).
// Oct 9: Darwin's account_research envelope floor went from $5 to $1 (PR 803), so Knox reads 19
// more sub-$5 lines; six fax and copy lines then scored wrong because the taxonomy filed fax
// under account research while the keys file it under document reproduction. PR 809 moved fax
// and copy fees to document reproduction, so five of the six read right; the one left is
// "Account Research Copies (per page) | $2.00" (GA 1338), which the key files as a copy and the
// taxonomy as research. Floors are today's counts on main with 809: 742 right / 43 wrong.
// v68 (#1102, Oct 15): fee-schedule labels with no fee word took all from 744 right / 41 wrong to
// 787 / 41 (no state lost a right read or gained a wrong one). Floors are those counts.
const FLOORS: Record<string, { right: number; wrong: number }> = {
  // v69 (#1102): price lines named by their heading, CA 137 to 140, MN 110 to 111, all 788 to 791.
  // v70 (#1100): low-balance and maintenance fees, CA 140 to 141, FL 116 to 117, GA 161 to 164,
  // NY 42 to 43, all 791 to 797; no state gained a wrong read.
  // v73 (#1100): reads record their account; every state unchanged.
  // v75 (Knox recall, Oct 17): the recurring held name families took CA 141 to 153, FL 117 to 120,
  // GA 164 to 169, IL 99 to 102, MI 122 to 127, MN 111 to 119, all 797 to 833; NY unchanged and no
  // state gained a wrong read.
  // v76 (Knox recall round 2, Oct 17): slash variants, box price columns and split "$ | 5.00" cells took
  // CA 153 to 156, FL 120 to 133, GA 169 to 171 (main read 170), IL 102 to 108, MI 127 to 128, MN 119 to
  // 120, NY 43 to 44, all 833 to 860 (main read 834); the 41 wrong reads are the same as main's.
  // v78 (Knox recall round 3, Oct 17): from main's reads (CA 156, FL 133 / 7, GA 172, IL 108 / 7, MI 128,
  // MN 121, NY 44, all 862 / 41) to CA 157, FL 136 / 6, GA 174, IL 112 / 5, MI 130, MN 121, NY 44, all
  // 874 / 38; the three wrong reads that left are safe deposit box late fees once read as loan late fees.
  // Guard v75 (#2023, James chose "Take down", Oct 19): a club account's per-withdrawal charge is not
  // early closure, and these keys (keyed Oct 6, before that decision) file five such lines under it
  // ("Club Account Early Withdrawal | $10.00", "Holiday Club Withdrawal | $3"). Knox no longer reads
  // them as early closure, so CA 157 to 156, GA 174 to 171, MI 130 to 128, all 874 to 869; no wrong
  // read added, and with the switch off every floor holds.
  // #2278 intentionally withholds seven keyed state reads for unresolved own scope or
  // finite parser limits (15 across both gates); prior-wrong River City total75 leaves too.
  // No numeric fix/rescore: original keys and wrong ceilings stay. Every case/text/reason
  // is explicit in international-wire-answer-key-boundaries.test.ts. FL/GA/IL/MI stay.
  CA: { right: 153, wrong: 5 },
  FL: { right: 136, wrong: 6 },
  GA: { right: 171, wrong: 9 },
  // 88 since the top-50 fold (Oct 8): a "Travel Card Reload" at $4.95 now files as a gift card
  // at $4.95, the same (category, price) pair as that schedule's gift card, so two right reads count once.
  IL: { right: 112, wrong: 5 },
  MI: { right: 128, wrong: 0 },
  // 96 since collection items got their own type (Oct 8): the key files a "$20.00 for the first
  // item" line under check cashing, and Knox now reads that schedule's "Collection Item" $20
  // as a collection item, so one right read became one wrong one.
  MN: { right: 119, wrong: 8 },
  NY: { right: 43, wrong: 5 },
  all: { right: 862, wrong: 38 },
};

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/state-answer-keys.json.gz"))).toString("utf8"),
) as { keys: Array<AnswerKeyDocument & { state: string }> };

// Each document is scored once and the floors add the scores up: the total and its parts no
// longer read the same texts twice.
const scored = new Map<AnswerKeyDocument, GateScore>();
const scoreOnce = (document: AnswerKeyDocument): GateScore => {
  if (!scored.has(document)) scored.set(document, scoreAnswerKeys([document]));
  return scored.get(document)!;
};

describe("Knox answer-key gate (seven states)", () => {
  it("covers every keyed fee schedule", () => {
    expect(fixture.keys).toHaveLength(38);
  });

  for (const [state, floor] of Object.entries(FLOORS)) {
    // The self-check traces every read against its text, so a whole fixture takes several seconds.
    it(`reads at least ${floor.right} right fees and at most ${floor.wrong} wrong ones (${state})`, () => {
      const documents = state === "all" ? fixture.keys : fixture.keys.filter((document) => document.state === state);
      const score = combineScores(documents.map(scoreOnce));
      const wrong = score.categoryErrors + score.amountErrors;
      const summary =
        `${state}: ${score.right} right of ${score.reads} reads (precision ${(score.precision * 100).toFixed(1)}%), ` +
        `${score.found} of ${score.expected} key fees found (coverage ${(score.coverage * 100).toFixed(1)}%), ` +
        `wrong: ${score.errors.map((error) => `${error.tid} ${error.fee} (${error.kind})`).join(", ")}`;
      expect(score.right, summary).toBeGreaterThanOrEqual(floor.right);
      expect(wrong, summary).toBeLessThanOrEqual(floor.wrong);
    }, 60_000);
  }
});
