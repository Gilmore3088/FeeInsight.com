// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

import { loadScenarios } from "@/lib/agents/deming/shadow-lab/scenarios";
import { withHeldNameVocabulary } from "./held-name-vocabulary";
import { runFreeSpecialists } from "./specialists";

/**
 * v161 is admit-only: over every frozen text (43 Texas and 38 seven-state answer-key schedules and
 * every shadow-lab case), each read main files keeps its category, price and name, and each held
 * line main gives a category keeps it. Main's reading is the vocabulary off: the vocabulary is read
 * only through `heldNameVocabularyKey`, after every other name rule, and nothing else in the rules
 * changed (the read-only census of main eaf6bef and of this branch with the vocabulary off matched
 * text for text). The reads it adds are pinned, so a later rule that changes them shows here.
 */

type Read = string;

function frozenTexts(): Map<string, string> {
  const texts = new Map<string, string>();
  for (const file of ["texas-answer-keys.json.gz", "state-answer-keys.json.gz"]) {
    const fixture = JSON.parse(gunzipSync(readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__", file))).toString("utf8")) as {
      keys: Array<{ tid: number | string; text: string }>;
    };
    for (const key of fixture.keys) texts.set(`${file.split("-")[0]}:${key.tid}`, key.text);
  }
  for (const c of loadScenarios()) if (c.document.text) texts.set(`lab:${c.caseKey}`, c.document.text);
  return texts;
}

function reading(text: string, on: boolean): { candidates: Read[]; held: Read[] } {
  const result = withHeldNameVocabulary(on, () => runFreeSpecialists(text));
  return {
    candidates: result.candidates.map((c) => `${c.canonicalHint}|${c.amount}|${c.feeName}`),
    held: result.held.filter((h) => h.canonicalHint).map((h) => `${h.shape}|${h.canonicalHint}|${h.amount}|${h.feeName}`),
  };
}

/** Every entry of `before` is in `after` as many times (multiset containment); returns what is missing. */
function missing(before: Read[], after: Read[]): Read[] {
  const left = new Map<Read, number>();
  for (const read of after) left.set(read, (left.get(read) ?? 0) + 1);
  const out: Read[] = [];
  for (const read of before) {
    const n = left.get(read) ?? 0;
    if (n === 0) out.push(read);
    else left.set(read, n - 1);
  }
  return out;
}

const ADDED = [
  "lab:live_audit:554-fe329316 account_verification|10|Immigration letter",
  "lab:missed_fees:state:11470 other_lending_fee|35|Loan Skip Pay (restrictions apply)",
  "lab:missed_fees:state:12752 account_verification|10|Proof of Funds Letter (Verification of Funds)",
  "lab:missed_fees:state:3515 account_verification|20|Immigration letter",
  "lab:missed_fees:state:7114 collection_item|10|Foreign check acceptance",
  "lab:missed_fees:state:7114 other_lending_fee|20|Year round skip-a-loan-payment",
  "lab:missed_fees:state:8034 account_verification|10|Verification of mortgage",
  "lab:missed_fees:state:8034 other_lending_fee|25|Skip-a-Loan payment",
  "lab:missed_fees:state:8036 vehicle_title|20|DMV Documentation and Transfer",
  "lab:missed_fees:state:8085 mortgage_modification|250|Reamortization schedule",
  "lab:missed_fees:state:8085 other_lending_fee|25|Mortgage Payoff Processing Fee",
  "state:11470 other_lending_fee|35|Loan Skip Pay (restrictions apply)",
  "state:12752 account_verification|10|Proof of Funds Letter (Verification of Funds)",
  "state:3515 account_verification|20|Immigration letter",
  "state:7114 collection_item|10|Foreign check acceptance",
  "state:7114 other_lending_fee|20|Year round skip-a-loan-payment",
  "state:8034 account_verification|10|Verification of mortgage",
  "state:8034 other_lending_fee|25|Skip-a-Loan payment",
  "state:8036 vehicle_title|20|DMV Documentation and Transfer",
  "state:8085 mortgage_modification|250|Reamortization schedule",
  "state:8085 other_lending_fee|25|Mortgage Payoff Processing Fee",
];

// The free team traces every read against its text, so both readings of every text take a while.
const READ_TIMEOUT_MS = 180_000;

describe("v161 held-name vocabulary: admit-only over every frozen text", () => {
  const lost: string[] = [];
  const added: string[] = [];
  let read = 0;
  beforeAll(() => {
    for (const [id, text] of frozenTexts()) {
      read += 1;
      const off = reading(text, false);
      const on = reading(text, true);
      for (const entry of missing(off.candidates, on.candidates)) lost.push(`${id} read ${entry}`);
      for (const entry of missing(off.held, on.held)) lost.push(`${id} held ${entry}`);
      for (const entry of missing(on.candidates, off.candidates)) added.push(`${id} ${entry}`);
      for (const entry of missing(on.held, off.held)) added.push(`${id} held ${entry}`);
    }
  }, READ_TIMEOUT_MS);

  it("reads every frozen text", () => {
    expect(read).toBeGreaterThanOrEqual(300);
  });

  it("should_keep_every_read_and_every_categorised_hold_main_makes", () => {
    expect(lost).toEqual([]);
  });

  it("should_add_only_the_pinned_reads", () => {
    expect(added.sort()).toEqual([...ADDED].sort());
  });
});
