import { describe, expect, it } from "vitest";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import {
  availabilityLine,
  bandsInUse,
  coverageFinding,
  normalizeFeesFilter,
  directoryHref,
  nationalCoverage,
  normalizeCharter,
  normalizeStateCode,
  percentLabel,
  shareBand,
  directoryCity,
  directoryName,
  stateSummaryLine,
  stateRows,
} from "./directory-view";
import { HEADLINE_FEE_NAMES, headlineFeeList } from "./headline-fee-names";

function summary(state_code: string, verified: number, total: number): InstitutionStateDirectorySummary {
  return {
    state_code,
    institution_count: total,
    verified_institution_count: verified,
    provisional_institution_count: 0,
    under_review_institution_count: 0,
    source_needed_institution_count: total - verified,
    verified_fee_count: verified * 10,
    provisional_fee_count: 0,
  };
}

const STATS = { institutions: 3911, monitored: 8775, complete: true };

describe("directory filters", () => {
  it("drops unknown types and states rather than filtering on them", () => {
    expect(normalizeCharter("bank")).toBe("bank");
    expect(normalizeCharter("thrift")).toBe("");
    expect(normalizeStateCode(" ga ")).toBe("GA");
    expect(normalizeStateCode("ZZ")).toBe("");
  });

  it("keeps every filter in a link and leaves out empty ones and page 1", () => {
    expect(directoryHref({ q: "navy", state: "VA", charter: "credit_union", fee: "overdraft", page: 2 })).toBe(
      "/institutions?q=navy&state=VA&charter=credit_union&fee=overdraft&page=2",
    );
    expect(directoryHref({ q: "", state: "", page: 1 })).toBe("/institutions");
    expect(directoryHref({ state: "TX", fees: true })).toBe("/institutions?state=TX&fees=1");
    expect(directoryHref({ state: "TX", fees: false })).toBe("/institutions?state=TX");
  });

  it("turns the fees filter on only for fees=1", () => {
    expect(normalizeFeesFilter("1")).toBe(true);
    expect(normalizeFeesFilter("yes")).toBe(false);
    expect(normalizeFeesFilter(undefined)).toBe(false);
  });
});

describe("coverage lines", () => {
  it("leads with the site-wide headline counts when no type is picked", () => {
    const c = nationalCoverage(STATS, [summary("GA", 66, 205)], "");
    expect(c).toEqual({ published: 3911, monitored: 8775 });
    expect(coverageFinding(c!, "")).toBe("3,911 of the 8,775 banks and credit unions monitored have fees available in the index (45%).");
  });

  it("adds up the state summaries for one type, and when the headline read failed", () => {
    const rows = [summary("GA", 30, 100), summary("TX", 70, 300)];
    expect(nationalCoverage(STATS, rows, "bank")).toEqual({ published: 100, monitored: 400 });
    expect(nationalCoverage({ ...STATS, complete: false }, rows, "")).toEqual({ published: 100, monitored: 400 });
    expect(nationalCoverage({ ...STATS, complete: false }, [], "")).toBeNull();
  });

  it("names the state and says plainly when none has published fees", () => {
    expect(coverageFinding({ published: 12, monitored: 40 }, "credit_union", "Vermont")).toBe(
      "12 of the 40 credit unions monitored in Vermont have fees available in the index (30%).",
    );
    expect(coverageFinding({ published: 0, monitored: 4 }, "", "Guam")).toBe(
      "None of the 4 banks and credit unions monitored in Guam have fees available in the index yet.",
    );
  });

  it("never rounds a share above zero down to 0%", () => {
    expect(percentLabel(0.001)).toBe("under 1%");
    expect(percentLabel(0)).toBe("0%");
    expect(percentLabel(0.456)).toBe("46%");
  });
});

describe("availability line and fee names", () => {
  it("states the live count, and nothing when the count is unknown or zero", () => {
    expect(availabilityLine({ published: 3960, monitored: 8775 }, "")).toBe(
      "Published fees available for 3,960 banks and credit unions.",
    );
    expect(availabilityLine({ published: 12, monitored: 40 }, "credit_union", "Vermont")).toBe(
      "Published fees available for 12 credit unions in Vermont.",
    );
    expect(availabilityLine(null, "")).toBeNull();
    expect(availabilityLine({ published: 0, monitored: 4 }, "")).toBeNull();
  });

  it("names every headline fee once, without table labels", () => {
    const names = HEADLINE_FEE_KEYS.map((key) => HEADLINE_FEE_NAMES[key]);
    expect(new Set(names).size).toBe(HEADLINE_FEE_KEYS.length);
    expect(names.filter((name) => name.includes("wire"))).toEqual([
      "domestic outgoing wire",
      "international outgoing wire",
      "domestic incoming wire",
    ]);
    expect(headlineFeeList()).not.toMatch(/\bnsf\b|\/|\(/i);
    expect(headlineFeeList()).toMatch(/ and returned deposited item$/);
  });
});

describe("states", () => {
  const rows = stateRows([summary("GA", 66, 205), summary("TX", 120, 741), summary("VT", 0, 27), summary("FM", 0, 1)]);

  it("ranks named states by institutions with fees in the index and drops codes outside the U.S.", () => {
    expect(rows.map((r) => r.code)).toEqual(["TX", "GA", "VT"]);
  });

  it("folds to one line with the median state share once a search is on", () => {
    expect(stateSummaryLine(rows)).toBe("Median state: 16% with fees in the index");
    expect(stateSummaryLine(stateRows([summary("VT", 0, 27)]))).toBeNull();
  });

  it("keys only the shading bands a state falls in", () => {
    expect(shareBand(0)).toBe(0);
    expect(shareBand(0.1)).toBe(1);
    expect(shareBand(0.8)).toBe(4);
    expect(bandsInUse([summary("GA", 66, 205), summary("VT", 0, 27)])).toEqual([0, 2]);
  });
});

describe("display names", () => {
  it("sets registry acronyms back in capitals and leaves other words as stored", () => {
    expect(directoryName("Campus Usa Credit Union")).toBe("Campus USA Credit Union");
    expect(directoryName("Ecu Credit Union")).toBe("ECU Credit Union");
    expect(directoryName("First Bank, N.a.")).toBe("First Bank, N.A.");
    expect(directoryName("Usaa Federal Savings Bank")).toBe("Usaa Federal Savings Bank");
    expect(directoryName("Community First Credit Union of Flo")).toBe("Community First Credit Union of Flo");
  });

  it("capitalizes each word of a city without touching mixed-case words", () => {
    expect(directoryCity("Fort lauderdale")).toBe("Fort Lauderdale");
    expect(directoryCity("FORT LAUDERDALE")).toBe("Fort Lauderdale");
    expect(directoryCity("McAllen")).toBe("McAllen");
    expect(directoryCity("Port of spain")).toBe("Port of Spain");
    expect(directoryCity(" ")).toBeNull();
  });
});
