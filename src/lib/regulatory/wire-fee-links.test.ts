import { describe, expect, it } from "vitest";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { FEE_TYPES } from "./wire-fee-types";
import {
  FEE_TYPE_CATEGORIES,
  SCENARIO_CAPTION,
  buildFeeDataStrip,
  buildFeeDataStrips,
  categoriesForFeeTypes,
  figureFor,
  indexesNeeded,
} from "./wire-fee-links";

const CANONICAL = new Set(Object.values(FEE_FAMILIES).flat());

describe("fee-type to category mapping", () => {
  it("maps Overdraft & NSF to the overdraft and NSF categories, never to returned deposited items", () => {
    expect(FEE_TYPE_CATEGORIES.overdraft).toEqual(["overdraft", "nsf"]);
    expect(Object.values(FEE_TYPE_CATEGORIES).flat()).not.toContain("deposited_item_return");
  });

  it("uses only canonical fee categories, and every tag has an entry", () => {
    for (const { key } of FEE_TYPES) {
      expect(FEE_TYPE_CATEGORIES[key]).toBeDefined();
      for (const category of FEE_TYPE_CATEGORIES[key]) expect(CANONICAL.has(category)).toBe(true);
    }
  });

  it("gives Other fees no category, so it gets no strip", () => {
    expect(categoriesForFeeTypes(["other"])).toEqual([]);
    expect(buildFeeDataStrip({ feeTypes: ["other"], stateCode: "CA", entries: [] })).toBeNull();
  });

  it("keeps tag order, drops repeats and caps the list", () => {
    expect(categoriesForFeeTypes(["atm", "overdraft"])).toEqual(["atm_non_network", "card_foreign_txn", "overdraft", "nsf"]);
    expect(categoriesForFeeTypes(["overdraft", "overdraft"])).toEqual(["overdraft", "nsf"]);
    expect(categoriesForFeeTypes(["overdraft", "atm", "wire"])).toHaveLength(4);
  });
});

describe("the fee-data strip", () => {
  const ca = [
    { fee_category: "overdraft", median_amount: 30, institution_count: 112, last_updated: "2026-10-07T21:00:00Z" },
    { fee_category: "nsf", median_amount: 3, institution_count: 4, last_updated: "2026-10-06T10:00:00Z" },
  ];

  it("shows the state's median and count, and links into the state report, category pages, compare and the simulator", () => {
    const strip = buildFeeDataStrip({ feeTypes: ["overdraft"], stateCode: "ca", entries: ca })!;
    expect(strip).toMatchObject({ scope: "state", stateCode: "CA", place: "California", asOf: "2026-10-07T21:00:00Z" });
    expect(strip.figures[0]).toMatchObject({
      category: "overdraft",
      label: "Overdraft",
      status: "median",
      median: 30,
      institutions: 112,
      text: "$30.00 median · 112 institutions with a published fee",
      href: "/fees/overdraft",
    });
    expect(strip.links.map((l) => l.href)).toEqual([
      "/research/state/CA",
      "/fees/overdraft",
      "/fees/nsf",
      "/pro/data?state=CA",
    ]);
    expect(strip.links[0].label).toBe("California fee report");
    expect(strip.links.at(-1)!.label).toBe("Compare California institutions");
    expect(strip.scenario).toEqual({ label: "Try a scenario", href: "/pro/simulate?fee=overdraft", caption: SCENARIO_CAPTION });
    expect(SCENARIO_CAPTION).toBe("Scenario exercise — not a compliance recommendation or a forecast.");
  });

  it("shows a count but no median below the minimum sample", () => {
    const strip = buildFeeDataStrip({ feeTypes: ["overdraft"], stateCode: "CA", entries: ca })!;
    expect(strip.figures[1]).toMatchObject({ status: "too_few", median: null, institutions: 4 });
    expect(strip.figures[1].text).toBe("4 institutions with a published fee: too few for a median (5 needed)");
  });

  it("says there is no data, with no number, when the state has no published fee in the category", () => {
    const strip = buildFeeDataStrip({ feeTypes: ["overdraft"], stateCode: "CO", entries: [] })!;
    for (const figure of strip.figures) {
      expect(figure).toMatchObject({ status: "none", median: null, institutions: 0 });
      expect(figure.text).toBe("No published fees for this category in Colorado yet");
      expect(figure.text).not.toMatch(/\d/);
    }
    expect(strip.asOf).toBeNull();
  });

  it("treats a zero-count entry or a missing median as no median, never as $0", () => {
    expect(figureFor("nsf", { fee_category: "nsf", median_amount: null, institution_count: 0 }, "Colorado").status).toBe("none");
    const unpriced = figureFor("nsf", { fee_category: "nsf", median_amount: null, institution_count: 9 }, "Colorado");
    expect(unpriced).toMatchObject({ status: "too_few", median: null });
    expect(unpriced.text).not.toContain("$");
  });

  it("uses the national index for a federal item", () => {
    const strip = buildFeeDataStrip({
      feeTypes: ["maintenance"],
      stateCode: null,
      entries: [{ fee_category: "monthly_maintenance", median_amount: 10, institution_count: 2400 }],
    })!;
    expect(strip).toMatchObject({ scope: "national", stateCode: null, place: "the national index" });
    expect(strip.figures[0].text).toBe("$10.00 median · 2,400 institutions with a published fee");
    expect(strip.links.map((l) => l.href)).toEqual(["/fees/monthly_maintenance", "/pro/data"]);
    expect(buildFeeDataStrip({ feeTypes: ["wire"], stateCode: null, entries: [] })!.figures[0].text).toBe(
      "No published fees for this category in the national index yet",
    );
  });
});

describe("strips for a page", () => {
  const items = [
    { key: "a", title: "AB 1234: overdraft fee limits", stateCode: "CA" },
    { key: "b", title: "Department announces new examiner", stateCode: "CA" },
    { key: "c", title: "Agencies propose ATM fee disclosure", stateCode: null },
    { key: "d", title: "HB 9: NSF fees", stateCode: "TX" },
  ];

  it("reads only the indexes the tagged items need", () => {
    expect(indexesNeeded(items)).toEqual({ states: ["CA", "TX"], national: true });
    expect(indexesNeeded([items[1]])).toEqual({ states: [], national: false });
  });

  it("gives no strip where the index could not be read, instead of a false 'no published fees'", () => {
    const strips = buildFeeDataStrips(items, {
      byState: new Map([["CA", [{ fee_category: "overdraft", median_amount: 30, institution_count: 112 }]]]),
      national: null,
    });
    expect([...strips.keys()]).toEqual(["a"]);
    expect(strips.get("a")!.figures.map((f) => f.status)).toEqual(["median", "none"]);
  });
});
