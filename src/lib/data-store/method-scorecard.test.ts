import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { groupMethods } from "./method-scorecard";

describe("groupMethods", () => {
  it("keeps the newest version as current and orders strategies by use", () => {
    const groups = groupMethods([
      { stage: "extract", strategy: "extract.rules", version: 11, attempts: 1962, ok: 1119, nothing: 0, costUsd: 0 },
      { stage: "extract", strategy: "extract.rules", version: 12, attempts: 206, ok: 83, nothing: 0, costUsd: 0 },
      { stage: "extract", strategy: "extract.table", version: 2, attempts: 4470, ok: 1323, nothing: 0, costUsd: 0 },
      { stage: "read", strategy: "read.pdf_text", version: 1, attempts: 419, ok: 382, nothing: 0, costUsd: 0 },
    ]);
    const extract = groups.get("extract")!;
    expect(extract.map((group) => group.strategy)).toEqual(["extract.table", "extract.rules"]);
    const rules = extract.find((group) => group.strategy === "extract.rules")!;
    expect(rules.current.version).toBe(12);
    expect(rules.older.map((row) => row.version)).toEqual([11]);
    expect(groups.get("read")).toHaveLength(1);
  });
});

describe("getMethodScorecard", () => {
  it("counts partial successes as worked and found-nothing outcomes apart from failures", async () => {
    const { sql } = await import("./connection");
    const calls: { text: string; values: unknown[] }[] = [];
    (sql as unknown as ReturnType<typeof vi.fn>).mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([
        { stage: "extract", strategy: "extract.family.checks", strategy_version: 4, attempts: 12307, ok: 4304, nothing: 8003, cost: 0 },
      ]);
    });
    const { getMethodScorecard, NOTHING_OUTCOMES } = await import("./method-scorecard");
    const card = await getMethodScorecard(7);
    expect(card.rows[0]).toMatchObject({ attempts: 12307, ok: 4304, nothing: 8003 });
    expect(calls[0].text).toContain("'ok', 'ok_partial'");
    expect(calls[0].values).toContainEqual(NOTHING_OUTCOMES);
  });
});
