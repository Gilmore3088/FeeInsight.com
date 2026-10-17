import { describe, expect, it } from "vitest";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import {
  bandsInUse,
  coverageFinding,
  directoryHref,
  nationalCoverage,
  normalizeCharter,
  normalizeStateCode,
  percentLabel,
  shareBand,
  stateFinding,
  stateRows,
} from "./directory-view";

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
  });
});

describe("coverage lines", () => {
  it("leads with the site-wide headline counts when no type is picked", () => {
    const c = nationalCoverage(STATS, [summary("GA", 66, 205)], "");
    expect(c).toEqual({ published: 3911, monitored: 8775 });
    expect(coverageFinding(c!, "")).toBe("3,911 of the 8,775 banks and credit unions monitored have published fees (45%).");
  });

  it("adds up the state summaries for one type, and when the headline read failed", () => {
    const rows = [summary("GA", 30, 100), summary("TX", 70, 300)];
    expect(nationalCoverage(STATS, rows, "bank")).toEqual({ published: 100, monitored: 400 });
    expect(nationalCoverage({ ...STATS, complete: false }, rows, "")).toEqual({ published: 100, monitored: 400 });
    expect(nationalCoverage({ ...STATS, complete: false }, [], "")).toBeNull();
  });

  it("names the state and says plainly when none has published fees", () => {
    expect(coverageFinding({ published: 12, monitored: 40 }, "credit_union", "Vermont")).toBe(
      "12 of the 40 credit unions monitored in Vermont have published fees (30%).",
    );
    expect(coverageFinding({ published: 0, monitored: 4 }, "", "Guam")).toBe(
      "None of the 4 banks and credit unions monitored in Guam have published fees yet.",
    );
  });

  it("never rounds a share above zero down to 0%", () => {
    expect(percentLabel(0.001)).toBe("under 1%");
    expect(percentLabel(0)).toBe("0%");
    expect(percentLabel(0.456)).toBe("46%");
  });
});

describe("states", () => {
  const rows = stateRows([summary("GA", 66, 205), summary("TX", 120, 741), summary("VT", 0, 27), summary("FM", 0, 1)]);

  it("ranks named states by institutions with published fees and drops codes outside the U.S.", () => {
    expect(rows.map((r) => r.code)).toEqual(["TX", "GA", "VT"]);
  });

  it("says how many states have any and the median state share, which the list doesn't show", () => {
    expect(stateFinding(rows)).toBe(
      "2 of the 3 states, DC and territories have at least one institution with published fees; the median state share is 16%.",
    );
    expect(stateFinding(stateRows([summary("VT", 0, 27)]))).toBeNull();
  });

  it("keys only the shading bands a state falls in", () => {
    expect(shareBand(0)).toBe(0);
    expect(shareBand(0.1)).toBe(1);
    expect(shareBand(0.8)).toBe(4);
    expect(bandsInUse([summary("GA", 66, 205), summary("VT", 0, 27)])).toEqual([0, 2]);
  });
});
