import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { loadGroupGaps, NATIONAL_LIST, pickFromWorkLists, sizeGroupOf, stateGroupOrder, stateWorkLists, workListLedger, workListPoolRankSql, type GroupGaps } from "./work-list";

function gaps(entries: Array<[string, string, number, number]>): GroupGaps {
  // [state, group, total, covered]: target 30, or 75% of a group under 40 (#1028).
  return new Map(entries.map(([state, group, total, covered]) => {
    const target = total < 40 ? Math.ceil(total * 0.75) : 30;
    return [`${state}|${group}`, { total, covered, target, short: Math.max(0, target - covered) }];
  }));
}

describe("size groups (#1028): asset_size is in thousands of dollars", () => {
  it("puts $300M and $1B and $10B at the bottom of the next group up", () => {
    expect(sizeGroupOf(299_999)).toBe("under_300m");
    expect(sizeGroupOf(300_000)).toBe("300m_1b");
    expect(sizeGroupOf(999_999)).toBe("300m_1b");
    expect(sizeGroupOf(1_000_000)).toBe("1b_10b");
    expect(sizeGroupOf(9_999_999)).toBe("1b_10b");
    expect(sizeGroupOf(10_000_000)).toBe("over_10b");
  });

  it("reads thousands, not dollars: a $50M bank is 50,000", () => {
    expect(sizeGroupOf(50_000)).toBe("under_300m");
    expect(sizeGroupOf("2500000")).toBe("1b_10b");
    expect(sizeGroupOf(null)).toBe("unknown");
    expect(sizeGroupOf("")).toBe("unknown");
  });
});

describe("state experts' work lists (#1029)", () => {
  // TX is 90 short across its groups; VT is 4 short in one group and at target in another.
  const coverage = gaps([
    ["TX", "under_300m", 200, 0],
    ["TX", "300m_1b", 100, 0],
    ["TX", "1b_10b", 60, 0],
    ["VT", "under_300m", 12, 5],
    ["VT", "300m_1b", 40, 30],
  ]);
  // The order the pass's query gives today: largest first, so TX fills every slot.
  const rows = [
    { id: 1, state_code: "TX", asset_size: 9_000_000, website_url: "https://a.example" },
    { id: 2, state_code: "TX", asset_size: 5_000_000, website_url: "https://b.example" },
    { id: 3, state_code: "TX", asset_size: 800_000, website_url: "https://c.example" },
    { id: 4, state_code: "VT", asset_size: 700_000, website_url: "https://d.example" },
    { id: 5, state_code: "TX", asset_size: 200_000, website_url: "https://e.example" },
    { id: 6, state_code: "TX", asset_size: 150_000, website_url: null },
    { id: 7, state_code: "VT", asset_size: 90_000, website_url: "https://g.example" },
    { id: 8, state_code: "VT", asset_size: 80_000, website_url: "https://h.example", requested: true },
  ];

  it("serves two states with different gaps in one run", () => {
    const picked = pickFromWorkLists(rows, coverage, 4);
    const states = new Set(picked.map((row) => row.state_code));
    expect(states).toEqual(new Set(["TX", "VT"]));
    // By assets alone the first four would be 1, 2, 3, 4 (no VT institution short of target).
    expect(picked.map((row) => row.id)).toEqual([8, 1, 7, 2]);
  });

  it("puts a requester first even from the smaller gap, and a paying customer with it", () => {
    const picked = pickFromWorkLists([...rows, { id: 9, state_code: "TX", asset_size: 400_000, paying: true }], coverage, 3);
    expect(picked.map((row) => row.id)).toEqual([8, 9, 1]);
    expect(picked[0].work_list).toMatchObject({ first: true, list: "VT" });
  });

  it("orders each state's list by the group furthest below target, then website on file, platform and size", () => {
    const lists = stateWorkLists(rows, coverage);
    expect(lists.map((entry) => [entry.list, entry.short])).toEqual([["TX", 90], ["VT", 4]]);
    // TX: every group is 30 short (share 1), so a website on file, then size, decides.
    expect(lists[0].rows.map((row) => row.id)).toEqual([1, 2, 3, 5, 6]);
    // VT: under_300m is 4 of 9 short; 300m_1b is at target, so it goes last.
    expect(lists[1].rows.map((row) => row.id)).toEqual([7, 4]);
    const withPlatform = stateWorkLists([
      { id: 10, state_code: "VT", asset_size: 100_000, website_url: "https://x.example" },
      { id: 11, state_code: "VT", asset_size: 60_000, website_url: "https://y.example", platform: "fiserv" },
    ], coverage);
    expect(withPlatform[0].rows.map((row) => row.id)).toEqual([11, 10]);
  });

  it("keeps institutions over $10B on one national list that takes its turn", () => {
    const picked = pickFromWorkLists([
      { id: 20, state_code: "NY", asset_size: 500_000_000, website_url: "https://big.example" },
      { id: 21, state_code: "NY", asset_size: 300_000_000, website_url: "https://big2.example" },
      ...rows.filter((row) => !("requested" in row)),
    ], coverage, 3);
    expect(picked.map((row) => row.id)).toEqual([1, 7, 20]);
    expect(picked[2].work_list).toMatchObject({ list: NATIONAL_LIST, group: "over_10b", groupShort: null });
  });

  it("never takes more than the pass's cap, and still rotates when the gaps are unread", () => {
    expect(pickFromWorkLists(rows, coverage, 0)).toEqual([]);
    expect(pickFromWorkLists(rows, coverage, 100)).toHaveLength(rows.length);
    const unread = pickFromWorkLists(rows.filter((row) => !("requested" in row)), new Map(), 2);
    expect(new Set(unread.map((row) => row.state_code))).toEqual(new Set(["TX", "VT"]));
  });

  it("lists one state's groups furthest below target first, for the state expert's step", () => {
    expect(stateGroupOrder(coverage, "vt").map((row) => [row.group, row.short])).toEqual([["under_300m", 4], ["300m_1b", 0]]);
    expect(stateGroupOrder(coverage, "TX").map((row) => row.group)).toEqual(["1b_10b", "300m_1b", "under_300m"]);
    expect(stateGroupOrder(coverage, "WY")).toEqual([]);
  });

  it("reads the gaps from the scorecard's groups query, and fails open to no gaps", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("FROM (") && text.includes(") coverage_groups")) {
        return Promise.resolve([{ state_code: "VT", size_group: "under_300m", total: 12, covered: 5, target: 9, short: 4 }]);
      }
      return Promise.resolve([]);
    });
    const read = await loadGroupGaps(db as never);
    expect(read.get("VT|under_300m")).toEqual({ total: 12, covered: 5, target: 9, short: 4 });
    expect(db.mock.calls.some((call) => (call[0] as unknown as string[]).join(" ").includes("GREATEST(0, target - covered)"))).toBe(true);

    const failing = vi.fn((strings: TemplateStringsArray) => (strings.join(" ").includes(") coverage_groups")
      ? Promise.reject(new Error("statement timeout"))
      : Promise.resolve([])));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await loadGroupGaps(failing as never)).size).toBe(0);
  });

  it("ranks the pool inside each state × size group cell, so the cut keeps every cell's first rows (#1269)", () => {
    const db = vi.fn((strings: TemplateStringsArray | string, ...values: unknown[]) => ({ strings, values }));
    const rank = workListPoolRankSql(db as never, { state: "state_code", assets: "asset_size", id: "id", within: "priority" }) as unknown as { strings: string[]; values: unknown[] };
    expect(rank.strings.join("?")).toMatch(/row_number\(\) OVER \(\s+PARTITION BY \?\s+CASE WHEN \? >= \?::bigint/);
    expect(rank.values).toEqual(expect.arrayContaining([NATIONAL_LIST, "under_300m", "300m_1b", "1b_10b", 300_000, 1_000_000, 10_000_000]));
    expect(db).toHaveBeenCalledWith("priority");
  });

  it("keeps every work-list entry for the ledger and counts real tries in short groups (#1269)", () => {
    const ledger = workListLedger([
      { institution_id: 1, outcome: "ok", by: "pick" },
      { institution_id: 2, outcome: "not_found", rung: "schedule", work_list: "VT", work_group: "under_300m", work_group_short: 4 },
      { institution_id: 3, outcome: "budget_blocked", by: "schedule_search", work_list: "TX", work_group: "1b_10b", work_group_short: 20 },
      { institution_id: 4, outcome: "ok", by: "website_search", work_list: "requested_or_paying", work_group: "300m_1b", work_group_short: 0 },
      { institution_id: 5, would_search: true, work_list: "national", work_group: "over_10b", work_group_short: null },
    ]);
    expect(ledger.entries.map((entry) => [entry.institution_id, entry.by])).toEqual([[2, "web_search"], [3, "schedule_search"], [4, "website_search"], [5, null]]);
    expect(ledger.entries[0]).toMatchObject({ rung: "schedule", work_list: "VT", work_group: "under_300m", work_group_short: 4 });
    expect([ledger.tries, ledger.short_group_tries]).toEqual([2, 1]);
  });
});
