import { describe, expect, it } from "vitest";
import {
  SPECIAL_UNIT_FREQUENCIES,
  UNIT_LABELS,
  isSpecialUnitFrequency,
  normalizedUnitFrequency,
  specialUnitReason,
  specialUnitOnPriceLine,
  specialUnitSql,
} from "./fee-unit";
import { ownFeeUnit } from "@/lib/custom-report/own-fee-unit";

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

describe("a unit only in the name never overrides a per-event basis after the price (#2248 review, Knox v140)", () => {
  it("declines the name's unit when the price says per request, per item or per transaction", () => {
    expect(specialUnitOnPriceLine("Research Copies (Per Page) | $5.00 per request", 5)).toBeNull();
    expect(specialUnitOnPriceLine("Research Copies (Per Page) | $5.00 per item", 5)).toBeNull();
    expect(specialUnitOnPriceLine("Research Copies (Per Page) | $5.00/transaction", 5)).toBeNull();
  });

  it("keeps the name's unit beside 'each' or no basis at all, and a unit after the price", () => {
    expect(specialUnitOnPriceLine("Research Copies (Per Page) | $5.00 each", 5)).toBe("per_page");
    expect(specialUnitOnPriceLine("Research Copies (Per Page) | $5.00", 5)).toBe("per_page");
    expect(specialUnitOnPriceLine("Copies | $1.00 per page", 1)).toBe("per_page");
  });
});

describe("a fraction glyph names a part of an hour (#1905, Knox v152)", () => {
  // Stored lines of live fees shown flat on Nov 1 (Navy Federal 122355, 133209, 144440, 38147, 88539).
  it("reads ½ and ¼ hour after the price", () => {
    expect(specialUnitOnPriceLine("Checkbook balancing (repeated) | $5.00 (per ½ hour)", 5)).toBe("per_half_hour");
    expect(specialUnitOnPriceLine("Account Balancing | $25.00 per ½ hr.", 25)).toBe("per_half_hour");
    expect(specialUnitOnPriceLine("Account Balancing $10.00 / ½ hour", 10)).toBe("per_half_hour");
    expect(specialUnitOnPriceLine("Account Research Fee | $10.00 per ½ hr (½ hr min)", 10)).toBe("per_half_hour");
    expect(specialUnitOnPriceLine("Account Balancing Assistance ....$10.00 per ¼ hour | Debit Cards:", 10)).toBe("per_quarter_hour");
  });

  it("never reads a ½ hour minimum or another price's unit as the fee's", () => {
    expect(specialUnitOnPriceLine("Account Research (½ hour minimum) | $30.00/hour", 30)).toBe("hourly");
    expect(specialUnitOnPriceLine("Account Research | $30.00 per hour; minimum ½ hour", 30)).toBe("hourly");
    expect(specialUnitOnPriceLine("Checkbook balancing | $5.00", 5)).toBeNull();
    expect(specialUnitOnPriceLine("Research | $5.00 per ½ hour or $8.00 per hour", 5)).toBeNull();
  });
});

describe("a free allowance's period and a second unit name no unit (#2248, Knox v154)", () => {
  it("reads no unit from live 98831's free-allowance clause, the bank's line verbatim", () => {
    // Inst 237, doc 20764: $2 a money order and a check copy, 2 copies free each cycle.
    const line = "Money Order (per check) & Copies of Checks (per statement; 2 free per statement cycle) | $2.00";
    expect(specialUnitOnPriceLine(line, 2)).toBeNull();
    expect(ownFeeUnit(line, "Money Order (per check) & Copies of Checks", 2, "check_image")).toBeNull();
    expect(specialUnitOnPriceLine("Check Copies | $2.00 (per statement; first 2 free per statement)", 2)).toBeNull();
    expect(specialUnitOnPriceLine("Statement copy | $3.00 per statement, one free per statement", 3)).toBeNull();
  });

  it("keeps a unit whose free allowance counts that unit, not a period", () => {
    expect(specialUnitOnPriceLine("Notary | $2.00/Page, First 2 pages free for members", 2)).toBe("per_page");
    expect(specialUnitOnPriceLine("Fax (Outgoing) | $1.25 Per Page. First 2 pages free", 1.25)).toBe("per_page");
    expect(specialUnitOnPriceLine("Photocopies | $0.50 per page (first 10 pages free)", 0.5)).toBe("per_page");
    expect(specialUnitOnPriceLine("Photocopies (10 copies free) | $ .05/page", 0.05)).toBe("per_page");
    expect(specialUnitOnPriceLine("Statement Copy | $2.00 per statement", 2)).toBe("per_statement");
  });

  it("reads no single unit when one price names two (live 65324, 134768)", () => {
    expect(specialUnitOnPriceLine("Duplicate Statement or Document Copy | $5.00/statement or document copy", 5)).toBeNull();
    expect(specialUnitOnPriceLine("Statement/Document Copies (per statement/document) $5", 5)).toBeNull();
    expect(specialUnitOnPriceLine("Fax | $1.00 per page / incoming or outgoing", 1)).toBe("per_page");
  });
});
