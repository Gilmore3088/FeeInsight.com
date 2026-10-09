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
// Since v17 the gate counts only reads that pass Knox's self-check; main at v16 scored 659
// right / 48 wrong on that basis. Floors raised to main at v29 (2026-10-07), and CA, GA, MN and
// all to the top-50 fold (Oct 8: 724 right / 46 wrong, from 723 / 47).
// Oct 9: Darwin's account_research envelope floor went from $5 to $1 (PR 803), so Knox reads 19
// more sub-$5 lines; six fax and copy lines then scored wrong because the taxonomy filed fax
// under account research while the keys file it under document reproduction. PR 809 moved fax
// and copy fees to document reproduction, so five of the six read right; the one left is
// "Account Research Copies (per page) | $2.00" (GA 1338), which the key files as a copy and the
// taxonomy as research. Floors are today's counts on main with 809: 742 right / 43 wrong.
const FLOORS: Record<string, { right: number; wrong: number }> = {
  CA: { right: 133, wrong: 6 },
  FL: { right: 107, wrong: 7 },
  GA: { right: 156, wrong: 10 },
  // 88 since the top-50 fold (Oct 8): a "Travel Card Reload" at $4.95 now files as a gift card
  // at $4.95, the same (category, price) pair as that schedule's gift card, so two right reads count once.
  IL: { right: 89, wrong: 7 },
  MI: { right: 117, wrong: 0 },
  // 96 since collection items got their own type (Oct 8): the key files a "$20.00 for the first
  // item" line under check cashing, and Knox now reads that schedule's "Collection Item" $20
  // as a collection item, so one right read became one wrong one.
  MN: { right: 98, wrong: 8 },
  NY: { right: 42, wrong: 5 },
  all: { right: 742, wrong: 43 },
};

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/state-answer-keys.json.gz"))).toString("utf8"),
) as { keys: Array<AnswerKeyDocument & { state: string }> };

describe("Knox answer-key gate (seven states)", () => {
  it("covers every keyed fee schedule", () => {
    expect(fixture.keys).toHaveLength(38);
  });

  for (const [state, floor] of Object.entries(FLOORS)) {
    // The self-check traces every read against its text, so a whole fixture takes several seconds.
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
    }, 60_000);
  }
});
