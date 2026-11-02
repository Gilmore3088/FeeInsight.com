import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  combineScores,
  gateKeyExclusion,
  gateKeyFor,
  RETIRED_NO_HOME,
  scoreAnswerKeys,
  type AnswerKeyDocument,
  type GateScore,
} from "./answer-key-gate";

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
// v76 (Knox recall round 2, Oct 17): every slash variant's price and both column prices of a box size
// took all to 572 / 14; held out stayed 53 / 4. The wrong reads are the same 14 as v75's.
// v78 (Knox recall round 3, Oct 17): the next held families, a checking account's free row, a box size
// before its dot leader and a safe deposit box's bare late fee took all from 573 / 14 (main) to 584 / 12
// (two late fees no longer read as loan late payments); held out 53 / 4 to 54 / 4.
// #2278: intentionally withhold eight keyed Texas reads (one held out) whose own
// direction/physical owner is unresolved. Across both gates, 15 keyed reads are withheld;
// a separate prior-wrong River City total75 also leaves. This is no numeric fix/rescore.
// international-wire-answer-key-boundaries.test.ts binds every original text/reason.
// v90 (#2454, James chose "File them", Oct 20): returned statements file as returned mail, and the
// gate scores the keys' "unmapped" returned statement lines there too; all from main's 577 / 11 to
// 578 / 11 (tid 2436 "Return Statement Processing Fee" is now a right read); held out stayed 53 / 4.
// v97 (Oct 21): a schedule flattened to one long line is read to its end (cents-only leader prices
// close their row; 1,000 priced segments per document): all 578 / 11 to 590 / 11, held out 53 / 4 to
// 60 / 4 (tid 841, one stored line of 100,841 characters).
// Guard v85 (#1831, James chose "Take down", Oct 25): a refundable safe deposit box key deposit is
// not a box fee. The Texas keys still list five key deposits under safe_deposit_box (841, 2409, 2414,
// 2416, 2426); Knox read one of them as a right fee (tid 2414, VeraBank, "Safe Deposit Box Rental** - Key
// Deposit | $10.00"), and the guard now refuses it: all 590 / 11 to
// 589 / 11, held out stays 60 / 4. No wrong read is added.
// Retired keys the fold leaves without a home (#2064, Nov 1): 16 Texas keys (one held out, tid 2452)
// file a fee under a category the top-50 fold retired, on a line the fold as it stands gives no home.
// Most are free e-statements and inquiries by phone or fax. Darwin refuses such reads
// (`retired_category`), so the gate leaves the keys out (`gateKeyExclusion`) and no longer credits reads
// under a retired category (`retiredReads`). Three such reads had counted right (2416 and 2418
// balance_inquiry, 2423 estatement_fee): all 589 / 11 to 586 / 11; held out stays 60 / 4. No Knox read
// changed. 2416 is a fold defect, not a fee with no home: "Balance inquiry: $0.75" under "Non-TBT or
// Non-Allpoint ATM1:" is a non-network ATM fee, but `ownAtmSection` misses the footnoted "ATM1:" heading
// and takes "Allpoint ATM:" above it as the bank's own (#1092). It is pinned below as a known fold miss;
// once the fold places it, it leaves the exclusions and its read counts right again (floor back to 587).
// 2412's "Non-Austin Bank ATM $2.00" (an inquiry heading above it), 2435's "Inquiry or Transfer Fees
// $0.75" and 2419's "Debit Card Research/Film Fee $75" are excluded by the fold as it stands; see the
// finding for why each is doubtful.
/** Keys the fold should place but does not yet, so they sit in the exclusions (#1092). */
const KNOWN_FOLD_MISSES = ["2416 balance_inquiry:75"];

// v156 (#1092, held-name vocabulary): tid 38's "Title transfers – $25.00" is read as a vehicle title:
// all 586 -> 587, wrong 11 unchanged; held out stays 60 / 4.
const FLOORS = {
  all: { right: 587, wrong: 11 },
  holdout: { right: 60, wrong: 4 },
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

  it("should_still_exclude_the_known_fold_misses_until_the_fold_places_them", () => {
    // When this fails, the fold was fixed (#1092): drop the key from KNOWN_FOLD_MISSES and the
    // exclusion count, and raise the floor for its read.
    const score = combineScores(fixture.keys.map(scoreOnce));
    const excluded = new Set(score.excluded.map((item) => `${item.tid} ${item.fee}`));
    for (const miss of KNOWN_FOLD_MISSES) expect(excluded.has(miss), `${miss} is no longer excluded`).toBe(true);
  }, 60_000);

  it("should_list_every_key_left_out_for_a_retired_category_with_no_home", () => {
    const score = combineScores(fixture.keys.map(scoreOnce));
    expect(score.excluded).toHaveLength(19);
    expect(new Set(score.excluded.map((item) => item.reason))).toEqual(new Set([RETIRED_NO_HOME]));
    expect(new Set(score.excluded.map((item) => item.fee.split(":")[0]))).toEqual(new Set(["balance_inquiry", "card_dispute", "estatement_fee"]));
    expect(score.retiredReads.map((item) => `${item.tid} ${item.fee}`).sort()).toEqual(
      ["2416 balance_inquiry:75", "2418 balance_inquiry:300", "2423 estatement_fee:0"].sort(),
    );
  }, 60_000);
});

describe("answer-key fees under retired categories", () => {
  const text = "Mortgage Modification\n\n$125.00\n\nElectronic Statements | FREE\nNon-network ATM balance inquiry | $2.00";

  it("should_leave_out_a_key_the_fold_gives_no_home_and_say_why", () => {
    const fee = { key: "estatement_fee", amount: 0, source_line: "Electronic Statements | FREE" };
    expect(gateKeyFor(fee, text)).toBeNull();
    expect(gateKeyExclusion(fee, text)).toBe(RETIRED_NO_HOME);
  });

  it("should_score_a_retired_key_where_the_fold_places_it", () => {
    const fee = { key: "balance_inquiry", amount: 2, source_line: "Non-network ATM balance inquiry | $2.00" };
    expect(gateKeyFor(fee, text)).toBe("atm_non_network:200");
    expect(gateKeyExclusion(fee, text)).toBeNull();
  });

  it("should_name_a_bare_price_line_by_the_label_above_it", () => {
    const fee = { key: "mortgage_modification", amount: 125, source_line: "$125.00" };
    expect(gateKeyFor(fee, text)).toBe("other_lending_fee:12500");
  });

  it("should_not_borrow_a_label_when_the_bare_price_is_printed_twice", () => {
    // Which "$125.00" is the key's cannot be told, so neither label names it.
    const twice = `Notary Service\n\n$125.00\n\n${text}`;
    const fee = { key: "mortgage_modification", amount: 125, source_line: "$125.00" };
    expect(gateKeyFor(fee, twice)).toBeNull();
    expect(gateKeyExclusion(fee, twice)).toBe(RETIRED_NO_HOME);
  });

  it("should_not_exclude_a_key_with_no_price_or_a_live_category", () => {
    expect(gateKeyExclusion({ key: "estatement_fee", amount: null, source_line: "Electronic Statements | FREE" }, text)).toBeNull();
    expect(gateKeyExclusion({ key: "nsf", amount: 30, source_line: "NSF | $30.00" }, text)).toBeNull();
  });
});
