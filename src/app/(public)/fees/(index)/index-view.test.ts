import { describe, expect, it } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import { companion, findings, histogram, inBucket, institutionsFor, parseSelection, selectionHref, statsFor } from "./index-view";

let nextId = 1;
function row(institution_id: number, amount: number, state: string, charter: "bank" | "credit_union"): IndexRow {
  return { id: nextId++, institution_name: `Institution ${institution_id}`, institution_id, amount, charter_type: charter, state_code: state };
}

// Six Florida banks at $25-$30, six Texas credit unions at $15, one bank listing two prices.
const rows: IndexRow[] = [
  ...[25, 25, 25, 26, 28, 30].map((a, i) => row(i + 1, a, "FL", "bank")),
  ...[15, 15, 15, 15, 15, 15].map((a, i) => row(i + 20, a, "TX", "credit_union")),
  row(1, 35, "FL", "bank"),
];

describe("Bank Fee Index explorer", () => {
  it("reads the query string and falls back on anything unknown", () => {
    const known = new Set(["overdraft", "wire_domestic_outgoing"]);
    expect(parseSelection({ fee: "wire_domestic_outgoing", state: "fl", charter: "bank", bin: "2" }, known, "overdraft")).toEqual({
      fee: "wire_domestic_outgoing",
      state: "FL",
      charter: "bank",
      bin: 2,
    });
    expect(parseSelection({ fee: "nope", state: "ZZ", charter: "x", bin: "-1" }, known, "overdraft")).toEqual({
      fee: "overdraft",
      state: null,
      charter: "all",
      bin: null,
    });
  });

  it("links a selection so an ad can open on it", () => {
    expect(selectionHref({ fee: "wire_domestic_outgoing", state: "FL", charter: "all" })).toBe(
      "/fees?fee=wire_domestic_outgoing&state=FL#explorer",
    );
  });

  it("counts the same institutions in the headline, the chart and the list", () => {
    const list = institutionsFor(rows, "wire_domestic_outgoing", null, "all");
    const stats = statsFor(rows, "wire_domestic_outgoing", null, "all");
    const bars = histogram(list);
    expect(list).toHaveLength(12);
    expect(stats.institution_count).toBe(12);
    expect(bars.reduce((s, b) => s + b.total, 0)).toBe(12);
    // Institution 1 lists $25 and $35: it counts once, at the middle of the two.
    expect(list.find((i) => i.id === 1)?.value).toBe(30);
  });

  it("narrows by state and charter", () => {
    expect(institutionsFor(rows, "wire_domestic_outgoing", "FL", "all")).toHaveLength(6);
    expect(institutionsFor(rows, "wire_domestic_outgoing", null, "credit_union").every((i) => i.charter === "credit_union")).toBe(true);
    const list = institutionsFor(rows, "wire_domestic_outgoing", null, "all");
    const bars = histogram(list);
    const bin = bars.findIndex((b) => b.total > 0);
    expect(list.filter((i) => inBucket(bars[bin], i.value))).toHaveLength(bars[bin].total);
  });

  it("compares a state with the U.S., and the U.S. by charter", () => {
    expect(companion(rows, { fee: "wire_domestic_outgoing", state: "FL", charter: "all" }).groups.map((g) => g.label)).toEqual([
      "Florida",
      "U.S.",
    ]);
    expect(companion(rows, { fee: "wire_domestic_outgoing", state: null, charter: "all" }).groups.map((g) => g.label)).toEqual([
      "Banks",
      "Credit unions",
    ]);
  });

  it("states the supported gap, the concentration and the thin coverage, with counts", () => {
    const sel = { fee: "wire_domestic_outgoing", state: null, charter: "all" as const };
    const out = findings(rows, sel, institutionsFor(rows, sel.fee, null, "all"));
    expect(out[0]).toBe("The median for banks is $27, $12 above credit unions at $15 (6 and 6 institutions).");
    expect(out[1]).toBe("50% of the 12 institutions charge exactly $15.");
    expect(out[2]).toBe("In 48 of the 50 states, fewer than 5 institutions publish this fee, so they get no state median yet.");
    expect(out.join(" ")).not.toMatch(/cheapest|rais|increas|cut/i);
  });

  it("says when a state has too few for a median", () => {
    const sel = { fee: "wire_domestic_outgoing", state: "GA", charter: "all" as const };
    const out = findings(rows, sel, institutionsFor(rows, sel.fee, "GA", "all"));
    expect(out).toContain("No institution in Georgia publishes this fee in a schedule we hold yet.");
    const fl = findings(rows, { ...sel, state: "FL", charter: "credit_union" }, []);
    expect(fl).toContain("No institution in Florida publishes this fee in a schedule we hold yet.");
  });
});
