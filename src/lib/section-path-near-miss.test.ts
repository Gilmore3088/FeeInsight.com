// @vitest-environment node
import { describe, expect, it } from "vitest";
import { darwinAudience } from "@/lib/agents/darwin/audience";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { withSectionPath } from "@/lib/section-path";
import { AUDIENCE_CASES, RETIRED_CASES } from "./section-path-near-miss.fixtures";

/**
 * #1092: every near-miss reads what it should with `SECTION_PATH_LIVE` on, and the cases main reads
 * wrong (`changed`) are the only ones that read differently with it off. Audience is Darwin's
 * decision (`darwinAudience`, the one published); a retired row is the shared check's
 * `discontinued_account` refusal, which Knox's self-check, Darwin's verify and Hamilton's re-check read.
 */

const audienceOf = (text: string, name: string, amount: number, on: boolean) =>
  withSectionPath(on, () => darwinAudience({ fee_audience: "unknown", source_url: null, fee_name: name }, amount, text, { ownPriceClause: true })?.feeAudience ?? "unknown");

const refusedOf = (text: string, name: string, amount: number, key: string, on: boolean) =>
  withSectionPath(on, () => {
    const result = checkFeeAgainstSource(text, name, amount, ".", key);
    return !result.ok && result.reason === "discontinued_account";
  });

describe("section path near misses: audience", () => {
  it("has at least 25 audience cases, some changed and most not", () => {
    expect(AUDIENCE_CASES.length).toBeGreaterThanOrEqual(25);
    expect(AUDIENCE_CASES.filter((c) => c.changed).length).toBeGreaterThan(0);
  });

  for (const c of AUDIENCE_CASES) {
    it(`${c.changed ? "fixes" : "keeps"}: ${c.name}`, () => {
      const on = audienceOf(c.text, c.fee.name, c.fee.amount, true);
      const off = audienceOf(c.text, c.fee.name, c.fee.amount, false);
      expect(on, "with the switch on").toBe(c.audience);
      if (c.changed) expect(off, "main reads it differently").not.toBe(c.audience);
      else expect(off, "the switch changes nothing here").toBe(on);
    });
  }
});

describe("section path near misses: retired sections", () => {
  it("has at least 20 retired-section cases", () => {
    expect(RETIRED_CASES.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of RETIRED_CASES) {
    it(`${c.changed ? "fixes" : "keeps"}: ${c.name}`, () => {
      const on = refusedOf(c.text, c.fee.name, c.fee.amount, c.fee.key, true);
      const off = refusedOf(c.text, c.fee.name, c.fee.amount, c.fee.key, false);
      expect(on, "refused as discontinued with the switch on").toBe(c.retired);
      if (c.changed) expect(off, "main lets it through").toBe(false);
      else expect(off, "the switch changes nothing here").toBe(on);
    });
  }
});
