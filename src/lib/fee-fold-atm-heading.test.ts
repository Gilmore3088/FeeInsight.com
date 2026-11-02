// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planFold } from "@/lib/agents/hamilton/taxonomy-fold";
import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";
import { refileCategory } from "@/lib/fee-category-guard";
import { foldContext, foldRetiredCategory, ownAtmSection } from "@/lib/fee-fold";
import {
  FOOTNOTED_ATM_HEADING_LIVE,
  footnotedAtmHeadingLive,
  ownAtmSectionMain,
  withFootnotedAtmHeading,
} from "@/lib/fee-fold-atm-heading";
import { ATM_HEADING_CASES } from "./fee-fold-atm-heading.fixtures";

/**
 * #1092: every ATM heading near miss folds where it should with `FOOTNOTED_ATM_HEADING_LIVE` on,
 * and the cases main folds wrong (`changed`) are the only ones that fold differently with it off.
 * The fold is read both directly and through the category guard's re-file (`refileCategory`), the
 * path Darwin's verify re-checks, Hamilton's rules re-check and the lab take.
 */

const folded = (text: string, name: string, amount: number, on: boolean) =>
  withFootnotedAtmHeading(on, () => foldRetiredCategory("balance_inquiry", name, foldContext(text, name, amount))?.to ?? null);
const refiled = (text: string, name: string, amount: number, on: boolean) =>
  withFootnotedAtmHeading(on, () => refileCategory("balance_inquiry", name, foldContext(text, name, amount)));

describe("fold ATM heading near misses", () => {
  it("has at least 40 cases main folds wrong, and cases it must keep", () => {
    expect(ATM_HEADING_CASES.filter((c) => c.changed).length).toBeGreaterThanOrEqual(40);
    expect(ATM_HEADING_CASES.filter((c) => !c.changed).length).toBeGreaterThanOrEqual(15);
  });

  for (const c of ATM_HEADING_CASES) {
    it(`${c.changed ? "fixes" : "keeps"}: ${c.name}`, () => {
      const on = folded(c.text, c.fee.name, c.fee.amount, true);
      const off = folded(c.text, c.fee.name, c.fee.amount, false);
      expect(on, "with the switch on").toBe(c.to);
      if (c.changed) expect(off, "main folds it elsewhere").not.toBe(c.to);
      else expect(off, "the switch changes nothing here").toBe(on);
      // The guard keeps the retired key when the fold gives no home.
      expect(refiled(c.text, c.fee.name, c.fee.amount, true)).toBe(c.to ?? "balance_inquiry");
    });
  }
});

describe("FOOTNOTED_ATM_HEADING_LIVE is inert while off", () => {
  it("should_be_off_by_default", () => {
    expect(FOOTNOTED_ATM_HEADING_LIVE).toBe(false);
    expect(footnotedAtmHeadingLive()).toBe(false);
  });

  it("should_read_every_case_as_main_when_off", () => {
    for (const c of ATM_HEADING_CASES) {
      const context = foldContext(c.text, c.fee.name, c.fee.amount) ?? "";
      expect(ownAtmSection(context), c.name).toBe(ownAtmSectionMain(context));
      expect(withFootnotedAtmHeading(false, () => ownAtmSection(context)), c.name).toBe(ownAtmSectionMain(context));
    }
  });

  it("should_restore_the_switch_after_a_held_read_even_when_it_throws", () => {
    expect(() =>
      withFootnotedAtmHeading(true, () => {
        throw new Error("read failed");
      }),
    ).toThrow("read failed");
    expect(footnotedAtmHeadingLive()).toBe(false);
  });
});

/**
 * The live paths that re-file through the fold: Hamilton's fold step (`planFold`) re-files verified and
 * live fees under a retired category, and Hamilton's rules re-check and Darwin's verify file Knox's
 * reads (`reproducibleFees`, `refileCategory` with the section above). Off, each reads Texas 2416's
 * section as main; on, the inquiry is a non-network ATM fee.
 */
describe("live re-file paths follow FOOTNOTED_ATM_HEADING_LIVE", () => {
  const texas = ATM_HEADING_CASES[0];
  const verified = { fee_published_id: null, fee_verified_id: 5, institution_id: 1, source_document_id: 7, canonical_fee_key: "balance_inquiry", fee_name: "Balance inquiry", amount: "0.75" };

  it("should_leave_the_fold_step_as_main_while_off_and_move_the_inquiry_when_on", () => {
    const texts = new Map([[7, texas.text]]);
    expect(planFold([verified], texts)).toEqual({ moves: [], noHome: [], unplacedVerified: 1 });
    const on = withFootnotedAtmHeading(true, () => planFold([verified], texts));
    expect(on.moves).toEqual([expect.objectContaining({ feeVerifiedId: 5, from: "balance_inquiry", to: "atm_non_network", rule: "balance_inquiry#4" })]);
  });

  it("should_read_the_inquiry_under_its_retired_key_while_off_and_as_a_non_network_atm_fee_when_on", () => {
    expect(reproducibleFees(texas.text)).toContain("balance_inquiry:75");
    const on = withFootnotedAtmHeading(true, () => reproducibleFees(texas.text));
    expect(on).toContain("atm_non_network:75");
    expect(on).not.toContain("balance_inquiry:75");
  });
});
