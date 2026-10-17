import { describe, expect, it } from "vitest";
import { peerSetStateFinding, statePeerSetView } from "./state-peer-sets";
import type { PeerSetIndex } from "@/lib/data-store/public-peer-sets";

const FEES = [
  { key: "overdraft", name: "Overdraft (OD)", median: 30 },
  { key: "nsf", name: "NSF", median: 28 },
];
const SETS: PeerSetIndex[] = [
  { key: "regional", label: "Institutions with $10B to $50B in assets in TX", entries: [{ fee_category: "overdraft", median_amount: 35, institution_count: 6 }] },
  {
    key: "occ",
    label: "Banks regulated by OCC in TX",
    entries: [
      { fee_category: "overdraft", median_amount: 27, institution_count: 12 },
      { fee_category: "nsf", median_amount: 28.1, institution_count: 9 },
    ],
  },
  { key: "fdic", label: "Banks regulated by FDIC in TX", entries: [{ fee_category: "overdraft", median_amount: 31, institution_count: 40 }] },
];

describe("statePeerSetView", () => {
  it("offers only groups with eight or more institutions on a fee and leads with the widest gap", () => {
    const view = statePeerSetView(SETS, FEES, "Texas", null)!;
    expect(view.options.map((o) => o.key)).toEqual(["occ", "fdic"]);
    expect(view.key).toBe("occ");
    expect(view.finding).toBe("Banks regulated by OCC in TX have a lower overdraft median than all Texas institutions: $27 against $30.");
    expect(view.rows[0]).toEqual({ key: "overdraft", name: "Overdraft (OD)", median: 27, institutions: 12, stateMedian: 30 });
  });

  it("follows the visitor's choice, never one below the floor", () => {
    expect(statePeerSetView(SETS, FEES, "Texas", "fdic")!.key).toBe("fdic");
    expect(statePeerSetView(SETS, FEES, "Texas", "regional")!.key).toBe("occ");
    expect(statePeerSetView([SETS[0]], FEES, "Texas", null)).toBeNull();
  });

  it("says about the same within 1%", () => {
    expect(peerSetStateFinding("Banks in TX", "Texas", [{ key: "nsf", name: "NSF", median: 28.1, institutions: 9, stateMedian: 28 }])).toBe(
      "Banks in TX have about the same median as all Texas institutions on the one fee compared.",
    );
  });
});
