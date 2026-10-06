import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { groupMethods } from "./method-scorecard";

describe("groupMethods", () => {
  it("keeps the newest version as current and orders strategies by use", () => {
    const groups = groupMethods([
      { stage: "extract", strategy: "extract.rules", version: 11, attempts: 1962, ok: 1119, costUsd: 0 },
      { stage: "extract", strategy: "extract.rules", version: 12, attempts: 206, ok: 83, costUsd: 0 },
      { stage: "extract", strategy: "extract.table", version: 2, attempts: 4470, ok: 1323, costUsd: 0 },
      { stage: "read", strategy: "read.pdf_text", version: 1, attempts: 419, ok: 382, costUsd: 0 },
    ]);
    const extract = groups.get("extract")!;
    expect(extract.map((group) => group.strategy)).toEqual(["extract.table", "extract.rules"]);
    const rules = extract.find((group) => group.strategy === "extract.rules")!;
    expect(rules.current.version).toBe(12);
    expect(rules.older.map((row) => row.version)).toEqual([11]);
    expect(groups.get("read")).toHaveLength(1);
  });
});
