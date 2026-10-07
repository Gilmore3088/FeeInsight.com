import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { getMarketLeaders, loadMarketLeaderIds, MARKET_LEADERS_PER_STATE } from "./market-leaders";

type Db = NonNullable<Parameters<typeof getMarketLeaders>[0]>["db"];

function createDb(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  });
  return { db: db as unknown as Db, calls };
}

const row = (state: string, id: number, depositRank: number) => ({
  state_code: state,
  institution_id: String(id),
  deposits: "1200.5",
  service_charge_income: null,
  total_income: "88",
  deposit_rank: String(depositRank),
  service_charge_rank: "20",
  total_income_rank: "3",
});

describe("market leaders", () => {
  it("ranks the top 15 per state by default and reads only same-scale call report rows", async () => {
    const { db, calls } = createDb([row("TN", 7, 1)]);
    const leaders = await getMarketLeaders({ db });
    expect(calls[0].text).toContain("-- market leaders by state");
    expect(calls[0].text).toContain("source IN ('fdic', 'ncua')");
    expect(calls[0].values).toEqual([MARKET_LEADERS_PER_STATE, MARKET_LEADERS_PER_STATE, MARKET_LEADERS_PER_STATE, null, null]);
    expect(leaders).toEqual([
      {
        state_code: "TN",
        institution_id: 7,
        deposits: 1200.5,
        service_charge_income: null,
        total_income: 88,
        deposit_rank: 1,
        service_charge_rank: 20,
        total_income_rank: 3,
      },
    ]);
  });

  it("narrows to one state, upper-cased", async () => {
    const { db, calls } = createDb([]);
    await getMarketLeaders({ db, stateCode: " tn ", perState: 10 });
    expect(calls[0].values).toEqual([10, 10, 10, "TN", "TN"]);
  });

  it("returns each leader id once, sorted, when it leads several states", async () => {
    const { db } = createDb([row("NY", 9, 2), row("NJ", 9, 4), row("NJ", 3, 1)]);
    expect(await loadMarketLeaderIds(db, { stateCode: null })).toEqual([3, 9]);
  });
});
