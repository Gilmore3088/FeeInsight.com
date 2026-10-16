import { describe, expect, it } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import {
  accountName,
  companion,
  findings,
  histogram,
  inBucket,
  institutionsFor,
  LIST_ALL,
  LIST_FIRST,
  listPage,
  parseListState,
  parseSelection,
  selectionHref,
  statsFor,
} from "./index-view";

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

  it("states the gap as a result, the concentration and the thin coverage, with counts", () => {
    const sel = { fee: "wire_domestic_outgoing", state: null, charter: "all" as const };
    const out = findings(rows, sel, institutionsFor(rows, sel.fee, null, "all"));
    expect(out[0]).toBe("The bank median is $27, $12 above the credit union median.");
    expect(out[1]).toBe("50% of the 12 institutions charge exactly $15.");
    expect(out[2]).toBe("In 48 of the 50 states, fewer than 5 institutions headquartered there publish this fee, so they get no state median yet.");
    expect(out.join(" ")).not.toMatch(/cheapest|rais|increas|cut|within|only/i);
  });

  it("states a state's median against the national median", () => {
    const sel = { fee: "wire_domestic_outgoing", state: "FL", charter: "all" as const };
    const fl = statsFor(rows, sel.fee, "FL", "all").median_amount;
    const us = statsFor(rows, sel.fee, null, "all").median_amount;
    const out = findings(rows, sel, institutionsFor(rows, sel.fee, "FL", "all"));
    if (fl != null && us != null && fl !== us) {
      expect(out[0]).toMatch(/^Florida's median is \$[\d.]+, \$[\d.]+ (above|below) the national median\.$/);
    }
  });

  it("pages the list: 8 at first, a search, and 50 a page when the reader asks for all", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Bank ${String(i).padStart(2, "0")}` }));
    expect(listPage(many, parseListState({})).rows).toHaveLength(LIST_FIRST);
    expect(listPage(many, parseListState({ page: "2" })).rows[0].name).toBe("Bank 08");
    expect(listPage(many, parseListState({ view: "all" })).rows).toHaveLength(LIST_ALL);
    expect(listPage(many, parseListState({ q: "bank 5" })).matching).toBe(10);
    expect(listPage(many, parseListState({ page: "99" })).page).toBe(8);
  });

  it("prints an account only when the line names one", () => {
    expect(accountName("Regular Checking")).toBe("Regular Checking");
    expect(accountName("Account Fees: A")).toBeNull();
    expect(accountName("Account Requirements")).toBeNull();
    expect(accountName(null)).toBeNull();
  });

  it("says when a state has too few for a median", () => {
    const sel = { fee: "wire_domestic_outgoing", state: "GA", charter: "all" as const };
    const out = findings(rows, sel, institutionsFor(rows, sel.fee, "GA", "all"));
    expect(out).toContain("No institution headquartered in Georgia publishes this fee in a schedule we hold yet.");
    const fl = findings(rows, { ...sel, state: "FL", charter: "credit_union" }, []);
    expect(fl).toContain("No institution headquartered in Florida publishes this fee in a schedule we hold yet.");
  });
});
