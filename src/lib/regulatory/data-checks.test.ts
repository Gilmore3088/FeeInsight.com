import { describe, expect, it } from "vitest";

import { checkValues, flaggedOnly } from "./data-checks";

describe("checkValues", () => {
  it("flags negatives and far outliers without changing anything", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ key: "a", id: String(i), value: 10 + i }));
    rows.push({ key: "a", id: "big", value: 1_000_000 }, { key: "a", id: "neg", value: -5 });
    const [report] = checkValues(rows);
    expect(report).toMatchObject({ key: "a", values: 102, negatives: 1, outliers: 1 });
    expect(report.examples.map((e) => e.id).sort()).toEqual(["big", "neg"]);
    expect(rows).toHaveLength(102);
  });

  it("skips the outlier test on small keys and allows negatives where they can happen", () => {
    const reports = checkValues([{ key: "net", id: "1", value: -3 }, { key: "net", id: "2", value: 900 }], (k) => k === "net");
    expect(flaggedOnly(reports)).toEqual([]);
  });
});
