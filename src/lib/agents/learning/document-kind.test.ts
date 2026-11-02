import { describe, expect, it } from "vitest";

import { documentKind, DOCUMENT_KIND_VERSION } from "./document-kind";
import { asText, KIND_FIXTURES, KIND_FIXTURES_SECOND, KIND_HOLDOUT } from "./document-kind.fixtures";
import { scoreFeePage, stackedFeeLines } from "./fee-page";
import {
  LEGACY_BANKING_FEES,
  PROGRESSIVE_ACCOUNT_SERVICES,
  STACKED_CHECKING_PAGE,
  STACKED_RATES_PAGE,
  STACKED_TIS_DISCLOSURE,
} from "./stacked-fee-lines.fixtures";

describe("a schedule laid out one cell per line (#1094, kind v2)", () => {
  it("is version 2, so the backfill decides every v1 kind again", () => {
    expect(DOCUMENT_KIND_VERSION).toBe(2);
  });

  it("counts a fee label with its amount on the next line as a fee line", () => {
    // Both pages scored 0 one-line fee lines and were "other" at v1, with live fees on them.
    expect(scoreFeePage(PROGRESSIVE_ACCOUNT_SERVICES).feeLines).toBe(0);
    expect(stackedFeeLines(PROGRESSIVE_ACCOUNT_SERVICES)).toBe(11);
    expect(documentKind({ text: PROGRESSIVE_ACCOUNT_SERVICES, url: "https://www.progressivenational.com/account-services/", feeSchedule: true })).toEqual({
      kind: "fee_schedule",
      reason: "11 fee lines (11 with the amount on the next line)",
    });
    expect(scoreFeePage(LEGACY_BANKING_FEES).feeLines).toBe(0);
    expect(stackedFeeLines(LEGACY_BANKING_FEES)).toBe(15);
    expect(documentKind({ text: LEGACY_BANKING_FEES, url: "https://www.legacycreditunion.com/banking-fees", feeSchedule: true }).kind).toBe("fee_schedule");
  });

  it("reads a short note between the label and the amount, and pairs each amount with one label", () => {
    expect(stackedFeeLines("Overdraft fee\n\nper item\n\n$35.00")).toBe(1);
    expect(stackedFeeLines("Stop payment\nper month $5.00")).toBe(1);
    // Two labels above one amount: the nearer label takes it.
    expect(stackedFeeLines("Wire fee\nNSF fee\n$30.00")).toBe(1);
    // An amount line with its own fee word is a one-line fee line, not counted again.
    expect(stackedFeeLines("Returned item\n$10.00 fee per item")).toBe(0);
    expect(scoreFeePage("Returned item\n$10.00 fee per item").feeLines).toBe(1);
    // Too far: two notes between, or a sentence between.
    expect(stackedFeeLines("Overdraft fee\nper item\nwaived for seniors\n$35.00")).toBe(0);
    expect(stackedFeeLines("Overdraft fee\nThis applies when an item is paid into a negative balance on your account.\n$35.00")).toBe(0);
    // A label that already carries an amount is a one-line fee line.
    expect(stackedFeeLines("Overdraft fee $35\n$5 daily after")).toBe(0);
    // A rate is not an amount.
    expect(stackedFeeLines("Statement Savings\n0.05%")).toBe(0);
  });

  it("keeps a rates page, a disclosure and a product page as v1 classified them", () => {
    // Stacked balance cells under statement-account names read like fee lines; only the final
    // count rules use them, so these keep their v1 kind.
    expect(stackedFeeLines(STACKED_RATES_PAGE)).toBe(12);
    expect(documentKind({ text: STACKED_RATES_PAGE, url: "https://bank.example/rates", feeSchedule: true }).kind).toBe("other");
    expect(stackedFeeLines(STACKED_TIS_DISCLOSURE)).toBe(6);
    expect(documentKind({ text: STACKED_TIS_DISCLOSURE, url: "https://bank.example/personal/savings", feeSchedule: false }).kind).toBe("truth_in_savings");
    expect(documentKind({ text: STACKED_TIS_DISCLOSURE, url: "https://bank.example/docs/tis.pdf", feeSchedule: true }).kind).toBe("truth_in_savings");
    expect(stackedFeeLines(STACKED_CHECKING_PAGE)).toBe(12);
    for (const feeSchedule of [true, false]) {
      expect(documentKind({ text: STACKED_CHECKING_PAGE, url: "https://bank.example/personal/checking/", feeSchedule }).kind).toBe("product_page");
    }
  });
});

describe("documentKind (#1094)", () => {
  it.each([...KIND_FIXTURES, ...KIND_FIXTURES_SECOND, ...KIND_HOLDOUT].map((fixture) => [fixture.id, fixture]))("production text %i", (_id, fixture) => {
    const result = documentKind({ text: asText(fixture), url: fixture.url, feeSchedule: fixture.feeLink });
    expect({ kind: result.kind, url: fixture.url }).toEqual({ kind: fixture.classified ?? fixture.kind, url: fixture.url });
  });

  it("lists its known misses: 2 of the first 40, 4 of the second 30, 4 of the 30 held out", () => {
    const misses = (fixtures: typeof KIND_FIXTURES) => fixtures.filter((fixture) => fixture.classified && fixture.classified !== fixture.kind).map((fixture) => fixture.id);
    expect(misses(KIND_FIXTURES)).toEqual([16747, 31244]);
    expect(misses(KIND_FIXTURES_SECOND)).toEqual([26427, 19245, 30249, 30314]);
    // The holdout: 26 of 30 right, graded before any rule saw it.
    expect(misses(KIND_HOLDOUT)).toEqual([12672, 24282, 22255, 30985]);
  });
});
