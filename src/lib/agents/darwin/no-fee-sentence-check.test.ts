// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findNoFeeSentences,
  NO_FEE_SENTENCE_TAKEDOWN_LIVE,
  noFeeSentenceMatch,
  recheckNoFeeSentences,
  type NoFeeSentenceRow,
} from "./no-fee-sentence-check";

// Every live fee the check's SQL pre-filter selected on prod, read-only, 2026-10-30.
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/no-fee-sentence-live-2026-10-30.json", import.meta.url), "utf8"),
) as Array<[number, number, number, string, number, string, string]>;
const rows: NoFeeSentenceRow[] = fixture.map(([id, verified, institution, name, amount, key, line]) => ({
  fee_published_id: id,
  fee_verified_id: verified,
  institution_id: institution,
  fee_name: name,
  amount,
  canonical_fee_key: key,
  source_line: `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=${key}; ${line}`,
}));

describe("Darwin's live re-check of a price after a \"no ... fees\" sentence (Hamilton proof run, Oct 30)", () => {
  it("ships with its switch off", () => {
    expect(NO_FEE_SENTENCE_TAKEDOWN_LIVE).toBe(false);
  });

  it("dry run: of the 19 live fees the pre-filter selects, only ESL FCU's $1 deposit matches", () => {
    const found = findNoFeeSentences(rows);
    expect(found.checked).toBe(19);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.institutionId, fee.amount])).toEqual([[68597, 6843, 1]]);
    expect(found.matches[0].reason).toBe('no_fee_sentence: $1 follows "There are no minimum balance requirements or monthly service fees."');
  });

  it("keeps a conditional no-fee sentence's fee and a table row", () => {
    expect(noFeeSentenceMatch("No monthly service fee with an average daily balance of $750+. Otherwise, it’s only $9.75/month", 9.75)).toBeNull();
    expect(noFeeSentenceMatch("No monthly fee | No monthly fee, if the Min balance is maintained; otherwise $10.00", 10)).toBeNull();
  });

  it("writes nothing while the switch is off", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return Promise.resolve(/SELECT fp\.fee_published_id/.test(strings.join("?")) ? rows : []);
      },
      { unsafe: () => Promise.resolve([]) },
    );
    const result = await recheckNoFeeSentences(db as never, { runId: 1, dryRun: false, live: false });
    expect(result.matched).toBe(1);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((sql) => /UPDATE/.test(sql))).toBe(false);
  });
});
