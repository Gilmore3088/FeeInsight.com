import { describe, expect, it } from "vitest";
import type { IndexRow } from "./fees";
import { packIndexRows, unpackIndexRows } from "./index-rows-pack";

function row(i: number, overrides: Partial<IndexRow> = {}): IndexRow {
  return {
    id: 100000 + i,
    institution_id: 5000 + (i % 1500),
    institution_name: `Institution ${i % 1500} Bank & Trust "Co"`,
    amount: [0, 25, 37.5, 125.99][i % 4],
    charter_type: i % 3 === 0 ? "credit_union" : "bank",
    state_code: i % 7 === 0 ? null : ["TX", "CA", "NY"][i % 3],
    schedule_keys: i % 11 === 0 ? null : [`u:example${i % 1600}.com/fees.pdf`, `t:${"a".repeat(60)}${i % 1600}`],
    schedule_group: i % 5 === 0 ? null : String(1000 + (i % 40)),
    product_exception: i % 13 === 0,
    ...overrides,
  };
}

describe("packIndexRows", () => {
  it("gives back exactly the rows it was given, in order", () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i));
    rows.push(row(900, { product_exception: null }), row(901, { schedule_keys: [] }));
    const { product_exception: _omit, ...noFlag } = row(902);
    void _omit;
    rows.push(noFlag);
    const back = unpackIndexRows(JSON.parse(JSON.stringify(packIndexRows(rows))));
    expect(back).toStrictEqual(rows);
  });

  it("keeps an 8,150-row category (safe deposit box, Nov 21 2026) well under the 2 MB cache limit", () => {
    const rows = Array.from({ length: 8150 }, (_, i) => row(i));
    const plain = JSON.stringify(rows).length;
    const packed = JSON.stringify(packIndexRows(rows)).length;
    expect(plain).toBeGreaterThan(2 * 1024 * 1024);
    expect(packed).toBeLessThan(1024 * 1024);
  });

  it("packs nothing to nothing", () => {
    expect(unpackIndexRows(packIndexRows([]))).toEqual([]);
  });
});
