import { describe, expect, it } from "vitest";
import { peerSetStateFinding, statePeerSetView } from "./state-peer-sets";
import type { PeerSetIndex } from "@/lib/data-store/public-peer-sets";

const FEES = [
  { key: "overdraft", name: "Overdraft (OD)", median: 30, institutions: 214 },
  { key: "nsf", name: "NSF", median: 28, institutions: 190 },
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
    expect(view.finding).toBe("Overdraft runs $3 below the Texas median.");
    expect(view.rows[0]).toEqual({ key: "overdraft", name: "Overdraft (OD)", median: 27, institutions: 12, stateMedian: 30, stateInstitutions: 214 });
  });

  it("follows the visitor's choice, never one below the floor", () => {
    expect(statePeerSetView(SETS, FEES, "Texas", "fdic")!.key).toBe("fdic");
    expect(statePeerSetView(SETS, FEES, "Texas", "regional")!.key).toBe("occ");
    expect(statePeerSetView([SETS[0]], FEES, "Texas", null)).toBeNull();
  });

  it("keeps the state's own medians the same under every group it offers", () => {
    const offered = statePeerSetView(SETS, FEES, "Texas", null)!.options.map((o) => o.key);
    for (const key of offered) {
      const view = statePeerSetView(SETS, FEES, "Texas", key)!;
      expect(view.key).toBe(key);
      expect(view.rows.map(({ key: fee, stateMedian, stateInstitutions }) => ({ fee, stateMedian, stateInstitutions }))).toEqual([
        { fee: "overdraft", stateMedian: 30, stateInstitutions: 214 },
        { fee: "nsf", stateMedian: 28, stateInstitutions: 190 },
      ]);
    }
  });

  it("says about the same within 1%", () => {
    expect(peerSetStateFinding("Banks in TX", "Texas", [{ key: "nsf", name: "NSF", median: 28.1, institutions: 9, stateMedian: 28, stateInstitutions: 190 }])).toBe(
      "Matches the Texas median, within 1%.",
    );
  });

  it("should_name_a_fee_from_the_rows_shown_by_default", () => {
    const row = (key: string, median: number, stateMedian: number) => ({ key, name: key.toUpperCase(), median, institutions: 9, stateMedian, stateInstitutions: 90 });
    // The sixth row has the widest gap but sits under "Show all".
    const rows = [row("a", 10.5, 10), row("b", 10, 10), row("c", 10, 10), row("d", 10, 10), row("e", 10, 10), row("f", 20, 10)];
    expect(peerSetStateFinding("Banks in TX", "Texas", rows)).toBe("A runs $0.50 above the Texas median.");
  });

  it("should_say_shown_under_show_all_when_only_a_hidden_row_compares", () => {
    const none = { median: null, institutions: 3, stateMedian: 10, stateInstitutions: 90 };
    const rows = [
      ...["a", "b", "c", "d", "e"].map((key) => ({ key, name: key.toUpperCase(), ...none })),
      { key: "f", name: "Wire", median: 20, institutions: 9, stateMedian: 10, stateInstitutions: 90 },
    ];
    expect(peerSetStateFinding("Banks in TX", "Texas", rows)).toBe("Wire (shown under Show all) runs $10 above the Texas median.");
  });
});
