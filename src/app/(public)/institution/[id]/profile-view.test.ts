import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { HeadlineValue } from "./profile-data";
import {
  EXTRACTION_PENDING,
  NOT_IDENTIFIED,
  NO_SCHEDULE,
  amountArticle,
  amountText,
  compareCounts,
  compareFinding,
  compareRows,
  heroFinding,
  leadRow,
  excludedNote,
  orderRows,
  positionFinding,
  referenceShort,
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

  it("orders the rest by dollar gap from the median", () => {
    expect(rows.map((r) => r.key)).toEqual(["monthly_maintenance", "overdraft", "nsf", "atm_non_network"]);
  });

  it("pins the lead fee first, then headline fees in headline order", () => {
    const pinned = orderRows(rows, ["overdraft", "nsf", "monthly_maintenance"], "atm_non_network");
    expect(pinned.map((r) => r.key)).toEqual(["atm_non_network", "overdraft", "nsf", "monthly_maintenance"]);
  });

  it("leads with the widest gap from the state median", () => {
    expect(leadRow(rows)?.key).toBe("monthly_maintenance");
    expect(heroFinding({ rows, stateName: "Florida", sparse: false, schedule: "reviewed", underReview: 0 })).toBe(
      "Its schedule lists a $5 monthly maintenance fee. That is $5 below the $10 Florida median.",
    );
  });

  it("counts against the state median with the 1% tolerance", () => {
    const counts = compareCounts(rows)!;
    expect(counts).toMatchObject({ above: 1, below: 1, same: 1, compared: 3, level: "state" });
    expect(compareFinding(counts, "Florida")).toBe("Above the Florida median on 1 of 3 compared fees, below on 1 and about the same on 1.");
  });

  it("says all about the same when nothing differs", () => {
    expect(compareFinding({ above: 0, below: 0, same: 4, compared: 4, level: "state" }, "Florida")).toBe(
      "About the same as the Florida median on all 4 compared fees.",
    );
  });
});

describe("ranges and $0", () => {
  it("shows the range and compares at the index's own value, labeled in the shared words", () => {
    const rows = compareRows(
      [value("monthly_maintenance", 8.45, { count: 2, low: 7.95, high: 8.95, comparedAt: "Compared at $8.45, the middle of its prices", accountPrices: "Carefree Checking $7.95 \u00b7 Everyday Checking $8.95" })],
      markets,
      "reviewed",
      null,
    );
    const mm = rows.find((r) => r.key === "monthly_maintenance")!;
    expect(amountText(mm)).toBe("$7.95 to $8.95");
    expect(mm.amount).toBe(8.45);
    expect(mm.accountPrices).toBe("Carefree Checking $7.95 \u00b7 Everyday Checking $8.95");
    expect(heroFinding({ rows, stateName: "Florida", sparse: false, schedule: "reviewed", underReview: 0 })).toBe(
      "Its monthly maintenance fee runs $7.95 to $8.95, depending on account. Compared at $8.45, the middle of its prices, it sits $1.55 below the $10 Florida median.",
    );
  });

  it("words a tiered overdraft as its standard fee, the highest of its prices", () => {
    const rows = compareRows(
      [value("overdraft", 35, { count: 2, low: 20, high: 35, highestTier: true, comparedAt: "Compared at $35, its standard fee, the highest of its prices" })],
      markets,
      "reviewed",
      null,
    );
    expect(heroFinding({ rows, stateName: "Florida", sparse: false, schedule: "reviewed", underReview: 0 })).toBe(
      "Its standard overdraft fee, $35 (the highest of its prices), sits $3 above the $32 Florida median.",
    );
  });

  it("labels the gap with the median it is read against, and notes CD/IRA fees left out", () => {
    const rows = compareRows([value("overdraft", 36), value("atm_non_network", 2.5, { excludedCdIra: 2 })], markets, "reviewed", null);
    expect(referenceShort(rows.find((r) => r.key === "overdraft")!, "FL")).toBe("vs FL");
    // Four Florida institutions are too few, so the ATM row is read against the U.S. median.
    expect(referenceShort(rows.find((r) => r.key === "atm_non_network")!, "FL")).toBe("vs U.S.");
    expect(excludedNote(rows.find((r) => r.key === "atm_non_network")!)).toBe("Leaves out 2 CD/IRA fees filed under this fee");
    expect(excludedNote(rows.find((r) => r.key === "overdraft")!)).toBeNull();
  });

  it("shows a published $0 as No fee", () => {
    const rows = compareRows([value("monthly_maintenance", 0)], markets, "reviewed", null);
    expect(amountText(rows.find((r) => r.key === "monthly_maintenance")!)).toBe("No fee");
  });

  it("states where benchmarked fees sit against the U.S. middle 50%", () => {
    expect(positionFinding({ below: 6, within: 12, above: 9 })).toBe(
      "9 of its 27 benchmarked fees sit above the U.S. middle 50%, 12 inside and 6 below.",
    );
    expect(positionFinding({ below: 0, within: 1, above: 1 })).toBe("1 of its 2 benchmarked fees sits above the U.S. middle 50%, 1 inside.");
    expect(positionFinding({ below: 2, within: 3, above: 0 })).toBe("None of its 5 benchmarked fees sits above the U.S. middle 50%; 3 inside and 2 below.");
    expect(positionFinding({ below: 0, within: 0, above: 0 })).toBeNull();
  });
});

describe("sparse and empty profiles", () => {
  it("leads with the fees that exist and says once how few there are", () => {
    const rows = compareRows([value("overdraft", 36), value("monthly_maintenance", 10)], markets, "reviewed", null);
    expect(heroFinding({ rows, stateName: "Florida", sparse: true, schedule: "reviewed", underReview: 0 })).toBe(
      "Two fees from its schedule are published so far: overdraft $36 and monthly maintenance $10.",
    );
  });

  it("counts only the personal fees the list shows and names business fees once", () => {
    const rows = compareRows([value("monthly_maintenance", 6), value("overdraft", 36)], markets, "reviewed", null);
    expect(
      heroFinding({ rows, stateName: "Mississippi", sparse: true, publishedCount: 2, businessCount: 1, schedule: "reviewed", underReview: 0 }),
    ).toBe(
      "Two fees from its schedule are published so far: monthly maintenance $6 and overdraft $36. Its schedule also lists 1 business fee, shown under Business.",
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

describe("an account's own price in the headline (James, Oct 17: Navy Federal)", () => {
  const navy = (extra: Partial<HeadlineValue>) =>
    compareRows([value("monthly_maintenance", 10, { account: "Flagship Checking", ...extra })], markets, "reviewed", null);

  it("names the account and its stated waiver, never an institution-wide price", () => {
    const virginia = { ...markets, state: [entry("monthly_maintenance", 7, 25)] };
    const rows = compareRows(
      [value("monthly_maintenance", 10, { account: "Flagship Checking", waiver: "can be waived with an average daily balance of $1,500 or more" })],
      virginia,
      "reviewed",
      null,
    );
    const text = heroFinding({ rows, name: "Navy Federal Credit Union", stateName: "Virginia", sparse: false, schedule: "reviewed", underReview: 0 });
    expect(text).toBe(
      "Navy Federal Credit Union\u2019s Flagship Checking account carries a $10 monthly maintenance fee, which can be waived with an average daily balance of $1,500 or more. That is $3 above the $7 Virginia median.",
    );
  });

  it("names the account only when the stored row states no waiver", () => {
    const rows = compareRows([value("monthly_maintenance", 12, { account: "Flagship Checking" })], markets, "reviewed", null);
    const text = heroFinding({ rows, name: "Navy Federal Credit Union", stateName: "Florida", sparse: false, schedule: "reviewed", underReview: 0 });
    expect(text).toBe("Navy Federal Credit Union\u2019s Flagship Checking account carries a $12 monthly maintenance fee. That is $2 above the $10 Florida median.");
    expect(text).not.toMatch(/monthly maintenance fee is/);
  });

  it("shows the waiver under the account in the comparison row", () => {
    const [row] = navy({ waiver: "can be waived with an average daily balance of $1,500 or more" });
    expect(row.waiver).toBe("can be waived with an average daily balance of $1,500 or more");
  });

  it("reads the article as the amount is spoken", () => {
    expect(amountArticle(8)).toBe("an");
    expect(amountArticle(18)).toBe("an");
    expect(amountArticle(11.5)).toBe("an");
    expect(amountArticle(10)).toBe("a");
    expect(amountArticle(1)).toBe("a");
    expect(amountArticle(110)).toBe("a");
  });

  it("notes a card inactivity fee left out of an account-dormancy comparison", () => {
    const rows = compareRows([value("dormant_account", 3, { excludedCard: 1 })], markets, "reviewed", null);
    expect(excludedNote(rows[0])).toBe("Leaves out 1 card inactivity fee filed under this fee");
  });
});
