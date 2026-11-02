// @vitest-environment node
import { describe, expect, it } from "vitest";
import { darwinAudience } from "@/lib/agents/darwin/audience";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { discontinuedRow } from "@/lib/custom-report/discontinued-rows";
import { withSectionPath } from "@/lib/section-path";
import { AUDIENCE_CASES, RETIRED_CASES } from "./section-path-near-miss.fixtures";

/**
 * #1092: every audience near-miss reads what it should with `SECTION_PATH_LIVE` on, and the cases
 * main reads wrong (`changed`) are the only ones that read differently with it off. Audience is
 * Darwin's decision (`darwinAudience`, the one published). Every retired-section case reads as main
 * with the switch on: the shared check (`checkFeeAgainstSource`) and `discontinuedRow` are main's.
 */

const audienceOf = (text: string, name: string, amount: number, on: boolean) =>
  withSectionPath(on, () => darwinAudience({ fee_audience: "unknown", source_url: null, fee_name: name }, amount, text, { ownPriceClause: true })?.feeAudience ?? "unknown");

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

/**
 * The retired-section half was taken out of #2872 after four review rounds (findings/2026-11-01-
 * section-paths.md): the switch must never change a retired-section read. The cases stay as the spec
 * for a later attempt built on real heading levels: `retired` is what such a rule should read.
 */
describe("section path near misses: retired sections are main's with the switch on", () => {
  it("keeps all 41 retired-section cases, every reviewer case included", () => {
    expect(RETIRED_CASES.length).toBe(41);
  });

  for (const c of RETIRED_CASES) {
    it(`main's read: ${c.name}`, () => {
      const result = (on: boolean) => withSectionPath(on, () => checkFeeAgainstSource(c.text, c.fee.name, c.fee.amount, ".", c.fee.key));
      expect(result(true)).toEqual(result(false));
      expect(withSectionPath(true, () => discontinuedRow(c.text, c.fee.name, c.fee.amount))).toEqual(discontinuedRow(c.text, c.fee.name, c.fee.amount));
    });
  }
});
