import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { HeadlineValue } from "./profile-data";
import {
  EXTRACTION_PENDING,
  NOT_IDENTIFIED,
  NO_SCHEDULE,
  compareCounts,
  compareFinding,
  compareRows,
  heroFinding,
  leadRow,
  orderRows,
  scheduleState,
} from "./profile-view";

function entry(fee_category: string, median_amount: number | null, institution_count: number): IndexEntry {
  return { fee_category, median_amount, institution_count } as IndexEntry;
}

function value(category: string, amount: number, extra: Partial<HeadlineValue> = {}): HeadlineValue {
  return { category, amount, count: 1, low: amount, high: amount, sourceUrl: `https://bank.example/${category}.pdf`, account: null, ...extra };
}

const markets = {
  state: [entry("overdraft", 32, 40), entry("nsf", 30, 30), entry("monthly_maintenance", 10, 25), entry("atm_non_network", 3, 4)],
  district: [entry("overdraft", 31, 200), entry("nsf", 29, 150)],
  us: [entry("overdraft", 33, 1500), entry("nsf", 30, 1200), entry("monthly_maintenance", 12, 1000), entry("atm_non_network", 3, 900)],
};

describe("compareRows", () => {
  it("reads each fee against the state, district and U.S. medians, and drops a median under the floor", () => {
    const rows = compareRows([value("overdraft", 36), value("atm_non_network", 2.5)], markets, "reviewed", null);
    const od = rows.find((r) => r.key === "overdraft")!;
    expect(od.state).toEqual({ median: 32, institutions: 40 });
    expect(od.district).toEqual({ median: 31, institutions: 200 });
    expect(od.us).toEqual({ median: 33, institutions: 1500 });
    // Four Florida institutions are too few for a state median.
    expect(rows.find((r) => r.key === "atm_non_network")!.state).toBeNull();
  });

  it("adds a row for each everyday fee it does not publish, with the city page's note", () => {
    const rows = compareRows([value("overdraft", 36)], markets, "reviewed", null);
    expect(rows.filter((r) => r.amount == null).map((r) => r.key)).toEqual(["nsf", "monthly_maintenance", "atm_non_network"]);
    expect(rows.find((r) => r.key === "nsf")!.missing).toBe(NOT_IDENTIFIED);
  });

  it("falls back to the institution's schedule when a fee has no source of its own", () => {
    const rows = compareRows([value("overdraft", 36, { sourceUrl: null })], markets, "reviewed", "https://bank.example/all.pdf");
    expect(rows[0].sourceUrl).toBe("https://bank.example/all.pdf");
  });
});

describe("schedule notes", () => {
  it("says why a cell is empty", () => {
    expect(scheduleState({ publishedFees: 0, hasSchedule: false })).toBe("none");
    expect(scheduleState({ publishedFees: 0, hasSchedule: true })).toBe("found");
    expect(scheduleState({ publishedFees: 3, hasSchedule: true })).toBe("reviewed");
  });
});

describe("ordering and findings", () => {
  const rows = orderRows(
    compareRows(
      [value("overdraft", 36), value("nsf", 30.2), value("monthly_maintenance", 5), value("atm_non_network", 3)],
      markets,
      "reviewed",
      null,
    ),
  );

  it("puts the widest share gap first and fees about the same after the differences", () => {
    expect(rows.map((r) => r.key)).toEqual(["monthly_maintenance", "overdraft", "atm_non_network", "nsf"]);
  });

  it("leads with the widest gap from the state median", () => {
    expect(leadRow(rows)?.key).toBe("monthly_maintenance");
    expect(heroFinding({ rows, stateName: "Florida", sparse: false, schedule: "reviewed", underReview: 0 })).toBe(
      "Its monthly maintenance fee is $5, $5 below the $10 Florida median.",
    );
  });

  it("counts against the state median with the 1% tolerance", () => {
    const counts = compareCounts(rows)!;
    expect(counts).toMatchObject({ above: 1, below: 1, same: 1, compared: 3, level: "state" });
    expect(compareFinding(counts, "Florida")).toBe("Above the Florida median on 1 of 3 fees, below on 1 and about the same on 1.");
  });

  it("says all about the same when nothing differs", () => {
    expect(compareFinding({ above: 0, below: 0, same: 4, compared: 4, level: "state" }, "Florida")).toBe(
      "About the same as the Florida median on all 4 compared fees.",
    );
  });
});

describe("sparse and empty profiles", () => {
  it("leads with the fees that exist and says once how few there are", () => {
    const rows = compareRows([value("overdraft", 36), value("monthly_maintenance", 10)], markets, "reviewed", null);
    expect(heroFinding({ rows, stateName: "Florida", sparse: true, schedule: "reviewed", underReview: 0 })).toBe(
      "Two fees from its schedule are published so far: overdraft $36 and monthly maintenance $10.",
    );
  });

  it("explains an empty profile with the city page's wording", () => {
    const none = compareRows([], markets, "none", null);
    expect(heroFinding({ rows: none, stateName: "Florida", sparse: true, schedule: "none", underReview: 0 })).toBe(`${NO_SCHEDULE}.`);
    const found = compareRows([], markets, "found", null);
    expect(heroFinding({ rows: found, stateName: "Florida", sparse: true, schedule: "found", underReview: 0 })).toBe(EXTRACTION_PENDING);
    expect(heroFinding({ rows: found, stateName: "Florida", sparse: true, schedule: "found", underReview: 4 })).toMatch(/under review/);
  });
});
