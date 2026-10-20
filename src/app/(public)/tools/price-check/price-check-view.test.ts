import { describe, expect, it } from "vitest";
import type { InstitutionPoint } from "@/lib/data-store/fees";
import { summarizeFees, valuePerInstitution } from "@/lib/data-store/fee-stats";
import {
  askedSummary,
  charterPlacements,
  clipped,
  COPY,
  countyCaption,
  FEE_LABEL,
  lessHeadline,
  nationalSource,
  percentLabel,
  placeAmong,
  previewHeading,
  REPORT_HREF,
  rowLabel,
  sameAndMore,
  sharedDomain,
  shownNote,
  stateRowLabel,
  stateSource,
  stateTooFew,
  uncheckedNote,
  VERDICT,
  versusMedian,
} from "./price-check-view";

const point = (value: number, charter_type: string | null): InstitutionPoint => ({
  value,
  charter_type,
  fed_district: null,
  state_code: null,
  asset_size_tier: null,
});

const VALUES = [0, 10, 20, 25, 30, 30, 35, 35, 36, 40];

describe("placeAmong", () => {
  it("counts lower, same and higher and reads the spread from the same values", () => {
    const p = placeAmong("U.S.", VALUES, 30)!;
    expect(p).toMatchObject({ count: 10, lower: 4, same: 2, higher: 4, lowerShare: "40%" });
    expect(p.band.median).toBe(30);
    expect(p.band.min).toBe(0);
    expect(p.band.max).toBe(40);
    expect(p.position).toBe("within");
  });

  it("places a price outside the middle half as below or above", () => {
    expect(placeAmong("U.S.", VALUES, 5)!.position).toBe("below");
    expect(placeAmong("U.S.", VALUES, 39)!.position).toBe("above");
  });

  it("returns null below the median floor or for a bad price", () => {
    expect(placeAmong("U.S.", [10, 20, 30, 40], 30)).toBeNull();
    expect(placeAmong("U.S.", VALUES, -1)).toBeNull();
    expect(placeAmong("U.S.", VALUES, Number.NaN)).toBeNull();
  });

  it("rounds the price to cents before comparing", () => {
    expect(placeAmong("U.S.", VALUES, 30.004)!.same).toBe(2);
  });

  it("rounds each value to cents too, so a float a hair off a price still counts as the same", () => {
    const p = placeAmong("U.S.", [10, 20, 29.999999, 30.000001, 40], 30)!;
    expect(p).toMatchObject({ lower: 2, same: 2, higher: 1 });
  });

  it("never shows 0% or 100% when a few institutions sit on the other side", () => {
    const many = (lowerCount: number) => Array.from({ length: 1000 }, (_, i) => (i < lowerCount ? 10 : 50));
    expect(placeAmong("U.S.", many(3), 30)!.lowerShare).toBe("<1%");
    expect(placeAmong("U.S.", many(997), 30)!.lowerShare).toBe(">99%");
    expect(placeAmong("U.S.", many(0), 30)!.lowerShare).toBe("0%");
    expect(placeAmong("U.S.", many(1000), 30)!.lowerShare).toBe("100%");
  });
});

describe("percentLabel", () => {
  it("rounds to a whole percent except at the edges", () => {
    expect(percentLabel(1, 3)).toBe("33%");
    expect(percentLabel(4, 1000)).toBe("<1%");
    expect(percentLabel(5, 1000)).toBe("1%");
    expect(percentLabel(995, 1000)).toBe(">99%");
    expect(percentLabel(0, 10)).toBe("0%");
    expect(percentLabel(10, 10)).toBe("100%");
    expect(percentLabel(0, 0)).toBe("0%");
  });
});

describe("source lines", () => {
  it("cite the index, the institution count and the data's own date", () => {
    expect(nationalSource(1203, "Oct 5, 2026")).toBe(
      "Source: Bank Fee Index, published fees from 1,203 U.S. institutions, updated Oct 5, 2026.",
    );
  });

  it("leave the date out rather than invent one", () => {
    expect(nationalSource(1203, null)).toBe("Source: Bank Fee Index, published fees from 1,203 U.S. institutions.");
  });

  it("date the state figures by the latest schedule read", () => {
    const line = stateSource("Florida", 84, ["2026-09-30T15:00:00Z", null, "2026-10-03T15:00:00Z"]);
    expect(line).toBe(
      "Source: Bank Fee Index, published fees from 84 Florida institutions, each checked against its schedule, latest read Oct 3, 2026.",
    );
    expect(stateSource("Ohio", 1, [null])).toBe(
      "Source: Bank Fee Index, published fees from 1 Ohio institution, each checked against its schedule.",
    );
  });
});

describe("the median matches /fees/[fee]", () => {
  it("reads the same median and middle half as summarizeFees over the same rows", () => {
    // /fees/[fee] summarizes the category read's sourced rows with summarizeFees; this page
    // places the price among institution_points, which are valuePerInstitution of those rows.
    for (const category of ["overdraft", "nsf"]) {
      const rows = Array.from({ length: 40 }, (_, i) => ({
        institution_id: (i % 17) + 1,
        amount: [0, 15, 25, 27.5, 30, 32, 34, 35, 36, 38][i % 10],
        fee_category: category,
        charter_type: i % 2 ? "bank" : "credit_union",
      }));
      const page = summarizeFees(rows);
      const placed = placeAmong("U.S.", [...valuePerInstitution(rows).values()], 30)!;
      expect(placed.count).toBe(page.institution_count);
      expect(placed.band.median).toBe(page.median_amount);
      expect(placed.band.p25).toBe(page.p25_amount);
      expect(placed.band.p75).toBe(page.p75_amount);
    }
  });
});

describe("charterPlacements", () => {
  it("splits banks and credit unions and drops a side under the floor", () => {
    const points = [...[30, 32, 35, 35, 36].map((v) => point(v, "bank")), ...[20, 25].map((v) => point(v, "credit_union")), point(15, null)];
    const rows = charterPlacements(points, 34);
    expect(rows.map((r) => r.label)).toEqual(["Banks"]);
    expect(rows[0]).toMatchObject({ count: 5, lower: 2, higher: 3 });
  });
});

describe("sentences", () => {
  const p = placeAmong("Banks", [10, 20, 30, 30, 40, 50], 30)!;

  it("say how many charge less, with thousands separators", () => {
    const big = placeAmong("U.S.", Array.from({ length: 1500 }, (_, i) => (i < 1203 ? 10 : 50)), 35)!;
    expect(lessHeadline(big, "U.S. institutions", 35)).toBe("1,203 of 1,500 U.S. institutions charge less than $35.");
    expect(rowLabel(p)).toBe("Banks: 2 of 6 charge less");
  });

  it("count who also charge $0 when the price is $0", () => {
    const zero = placeAmong("U.S.", VALUES, 0)!;
    expect(lessHeadline(zero, "U.S. institutions", 0)).toBe("1 of 10 U.S. institutions also charge $0.");
  });

  it("fold the answered form to one line and label the state row", () => {
    expect(askedSummary("overdraft", 35, "Florida")).toBe("Overdraft fee, $35, Florida");
    expect(askedSummary("nsf", 12.5, null)).toBe("NSF (returned item) fee, $12.50");
    expect(stateRowLabel("Florida")).toBe("Florida, checked against schedules");
  });

  it("make the verb agree with the count", () => {
    expect(sameAndMore(p)).toBe("2 charge the same. 2 charge more.");
    const one = placeAmong("U.S.", [10, 20, 30, 40, 50], 40)!;
    expect(sameAndMore(one)).toBe("1 charges the same. 1 charges more.");
  });

  it("state the gap to the median", () => {
    expect(versusMedian(35, 30)).toBe("$5 above the median");
    expect(versusMedian(26.5, 30)).toBe("$3.50 below the median");
    expect(versusMedian(30, 30)).toBe("Same as the median");
  });

  it("cover the state notes", () => {
    expect(stateTooFew("Vermont", 1, "nsf")).toBe("Vermont has 1 institution with a checked NSF fee so far, too few to compare.");
    expect(uncheckedNote(0, "overdraft")).toBeNull();
    expect(uncheckedNote(1, "overdraft")).toBe("1 more publishes an overdraft fee not yet matched to its schedule, so it is not counted.");
    expect(uncheckedNote(3, "overdraft")).toContain("3 more publish an overdraft fee not yet matched to their schedule");
    expect(shownNote(25, 25)).toBeNull();
    expect(shownNote(25, 80)).toBe("Showing the 25 lowest of 80.");
    expect(previewHeading(2100, "overdraft")).toBe("What 2,100 U.S. institutions charge for an overdraft fee");
    expect(countyCaption("nsf", 2025)).toBe("Each county shows its institutions' NSF fees, weighted by deposits (FDIC Summary of Deposits, 2025), counting $0 fees.");
  });
});

describe("sharedDomain", () => {
  it("runs from $0 past the price and keeps one outlier from flattening the rows", () => {
    const p = placeAmong("U.S.", [...VALUES, 400], 30)!;
    const domain = sharedDomain([p], 30);
    expect(domain[0]).toBe(0);
    expect(domain[1]).toBeGreaterThanOrEqual(36);
    expect(domain[1]).toBeLessThan(400);
    expect(clipped(p.band, domain).max).toBe(domain[1]);
  });

  it("stretches to a price above every row", () => {
    const p = placeAmong("U.S.", VALUES, 120)!;
    expect(sharedDomain([p], 120)[1]).toBeGreaterThanOrEqual(120);
  });
});

describe("visitor words", () => {
  const p = placeAmong("U.S.", VALUES, 30)!;
  const visible = [
    ...Object.values(COPY),
    ...Object.values(VERDICT),
    ...Object.values(FEE_LABEL),
    lessHeadline(p, "U.S. institutions", 30),
    sameAndMore(p),
    rowLabel(p),
    versusMedian(35, 30),
    stateTooFew("Ohio", 2, "overdraft"),
    uncheckedNote(2, "overdraft") ?? "",
    shownNote(25, 80) ?? "",
    previewHeading(100, "nsf"),
    countyCaption("overdraft", 2025),
    lessHeadline(placeAmong("U.S.", VALUES, 0)!, "U.S. institutions", 0),
    askedSummary("overdraft", 35, "Florida"),
    stateRowLabel("Florida"),
    nationalSource(1203, "Oct 5, 2026"),
    stateSource("Florida", 84, ["2026-10-03T15:00:00Z"]),
  ];

  it("use no em dashes", () => {
    for (const text of visible) expect(text).not.toMatch(/—/);
  });

  it("never name a pipeline agent or a featured bank", () => {
    for (const text of visible) expect(text).not.toMatch(/\b(Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Frost)\b/);
  });

  it("send bank staff to the report request", () => {
    expect(REPORT_HREF).toBe("/reports?report=institution&src=price-check#request");
  });
});
