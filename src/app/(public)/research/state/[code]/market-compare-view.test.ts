import { describe, expect, it } from "vitest";
import type { BoardFee } from "./state-view";
import { cityHref, cityName, marketPanels, openingFee } from "./market-compare-view";

function fee(key: string, median: number, district: number | null, us: number | null): BoardFee {
  return {
    key,
    name: key,
    institutions: 20,
    median,
    p25: null,
    p75: null,
    bank: { median: null, institutions: 0 },
    cu: { median: null, institutions: 0 },
    us: us == null ? null : { p25: us, median: us, p75: us },
    position: null,
    district: district == null ? null : { p25: district, median: district, p75: district, institutions: 40 },
    values: [],
  };
}

const ORDER = [
  { key: "overdraft", label: "Overdraft" },
  { key: "atm_non_network", label: "Out-of-network ATM" },
  { key: "stop_payment", label: "Stop payment" },
];

const benchmarks = {
  stateName: "Georgia",
  districtName: "Atlanta",
  fees: [fee("overdraft", 30, 32, 30), fee("atm_non_network", 1, 2, 2.5)],
  usInstitutions: new Map([
    ["overdraft", 900],
    ["atm_non_network", 800],
  ]),
};

describe("market comparison", () => {
  it("names cities and links their pages", () => {
    expect(cityName("SANDY SPRINGS")).toBe("Sandy Springs");
    expect(cityName("WINSTON-SALEM")).toBe("Winston-Salem");
    expect(cityHref("GA", "SANDY SPRINGS")).toBe("/fees/city/ga/sandy%20springs");
  });

  it("builds city, state, district and U.S. rungs with who each counts", () => {
    const [panel] = marketPanels(
      "GA",
      [{ city: "ATLANTA", institutions: 60, with_fees: 48, branches: 400, fees: { atm_non_network: [2, 2.5, 2.5, 3, 3], overdraft: [30, 35] } }],
      ORDER,
      benchmarks,
    );
    // Stop payment has no state median on the board, so the panel leaves it out.
    expect(panel.fees.map((f) => f.key)).toEqual(["overdraft", "atm_non_network"]);
    const atm = panel.fees[1];
    expect(atm.rungs.map((r) => [r.level, r.median, r.institutions])).toEqual([
      ["city", 2.5, 5],
      ["state", 1, 20],
      ["district", 2, 40],
      ["us", 2.5, 800],
    ]);
    expect(atm.rungs[0].population).toBe("With a branch in Atlanta, wherever headquartered");
    expect(atm.rungs[1].population).toBe("Headquartered in Georgia");
    expect(atm.takeaway).toBe("The Atlanta median is $2.50: $1.50 above the Georgia median, and the same as the U.S. median.");
    expect([atm.low, atm.high]).toEqual([2, 3]);
    expect(panel.fees[0].takeaway).toBe("2 institutions with a branch in Atlanta publish an overdraft fee, too few for a local median (5 needed).");
    // ATM sits 150% above the state median; overdraft has no local median.
    expect(openingFee(panel)).toBe("atm_non_network");
  });

  it("drops the district rung when the state has no district", () => {
    const [panel] = marketPanels("XX", [{ city: "A", institutions: 1, with_fees: 0, branches: 1, fees: {} }], ORDER, { ...benchmarks, districtName: null });
    expect(panel.fees[0].rungs.map((r) => r.level)).toEqual(["city", "state", "us"]);
    expect(panel.fees[0].takeaway).toBe("No institution with a branch in A has a published overdraft fee yet.");
  });
});
