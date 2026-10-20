import { describe, expect, it } from "vitest";
import {
  SPECIAL_UNIT_FREQUENCIES,
  UNIT_LABELS,
  isSpecialUnitFrequency,
  normalizedUnitFrequency,
  specialUnitReason,
  specialUnitSql,
} from "./fee-unit";

describe("literal unit comparison contract (#2248)", () => {
  it("normalizes only the finite ASCII unit vocabulary and explicit transport whitespace", () => {
    for (const unit of SPECIAL_UNIT_FREQUENCIES) {
      const transported = `\ufeff\v\u00a0${unit.toUpperCase()}\u202f\t`;
      expect(normalizedUnitFrequency(transported)).toBe(unit);
      expect(isSpecialUnitFrequency(transported)).toBe(true);
      expect(specialUnitReason(transported)).toBe(`Charged ${UNIT_LABELS[unit]}; comparison unavailable`);
    }
    for (const frequency of [null, undefined, "", "per_item", "other", "monthly", "per page", "per_İmage", "\u0085hourly", "\u200bhourly"]) {
      expect(isSpecialUnitFrequency(frequency)).toBe(false);
      expect(specialUnitReason(frequency)).toBeNull();
    }
  });

  it("limits generated SQL identifiers to code-owned aliases", () => {
    expect(specialUnitSql("own_rows")).toContain("own_rows.frequency");
    for (const alias of ["x.frequency", "x; DROP TABLE raw_fee_observations", "", "x-y"]) {
      expect(() => specialUnitSql(alias)).toThrow("Invalid fee-unit table alias");
    }
  });
});
