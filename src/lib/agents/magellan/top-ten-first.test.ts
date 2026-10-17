import { describe, expect, it, vi } from "vitest";

import { loadTopTenMissingIds, pickTopTenFirst, TOP_TEN_RETRY_DAYS } from "./top-ten-first";
import { MISS_COOLDOWN_DAYS } from "./cooldowns";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));
const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof loadTopTenMissingIds>[0]>;

const leader = (stateCode: string, institutionId: number, rank: number) => ({
  state_code: stateCode, institution_id: institutionId, deposits: 1000 - rank, service_charge_income: null, total_income: null,
  deposit_rank: rank, service_charge_rank: rank, total_income_rank: rank,
});

describe("state top-10 slot holders with nothing live go first (top-ten-first.ts)", () => {
  it("retries well inside the miss cooldown, but at most weekly", () => {
    expect(TOP_TEN_RETRY_DAYS).toBe(7);
    expect(TOP_TEN_RETRY_DAYS).toBeLessThan(MISS_COOLDOWN_DAYS);
  });

  it("reads the shared top-10 count: slot holders with nothing live, each once", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const sqlText = text(strings);
      if (sqlText.includes("market leaders by state")) {
        // 12 has a live fee; 7 holds two states' slots with nothing live; 30 ranks 11th, no slot.
        return Promise.resolve([leader("NY", 7, 2), leader("UT", 7, 2), leader("NY", 12, 1), leader("VT", 40, 3), leader("VT", 30, 11)]);
      }
      if (sqlText.includes("top 10 per state: live fees")) return Promise.resolve([{ institution_id: 12, types: 9, has_overdraft: true }]);
      return Promise.resolve([]);
    });
    expect(await loadTopTenMissingIds(asDb(db))).toEqual([7, 40]);
  });

  it("returns none when the ranking fails, so the searches run as before", async () => {
    const db = vi.fn(() => Promise.reject(new Error("statement timeout")));
    expect(await loadTopTenMissingIds(asDb(db))).toEqual([]);
  });

  it("puts requesters and Pro accounts first, then top-10 slot holders, then the work lists", () => {
    const rows = [
      { id: 1, state_code: "TX", asset_size: 9_000_000, top_ten: false },
      { id: 2, state_code: "TX", asset_size: 8_000_000, top_ten: false },
      { id: 3, state_code: "AK", asset_size: 600_000, top_ten: true },
      { id: 4, state_code: "VT", asset_size: 100_000, top_ten: false, requested: true },
      { id: 5, state_code: "WY", asset_size: 1_000_000, top_ten: true },
    ];
    const picked = pickTopTenFirst(rows, new Map(), 4, (row) => row.top_ten);
    expect(picked.map((row) => row.id)).toEqual([4, 3, 5, 1]);
    expect(picked.every((row) => row.work_list)).toBe(true);
    expect(pickTopTenFirst(rows, new Map(), 2, (row) => row.top_ten).map((row) => row.id)).toEqual([4, 3]);
    expect(pickTopTenFirst(rows, new Map(), 0, (row) => row.top_ten)).toEqual([]);
  });
});
