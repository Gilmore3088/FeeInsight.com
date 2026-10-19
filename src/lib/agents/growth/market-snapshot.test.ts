import { describe, expect, it, vi } from "vitest";

import { loadMarket, SNAPSHOT_STATE_PEERS } from "./market-snapshot";

type Db = Parameters<typeof loadMarket>[0];

function fakeDb(subject: Record<string, unknown>) {
  const queries: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("FROM institution_sources WHERE id =")) return Promise.resolve([subject]);
    return Promise.resolve([
      { id: 20, institution_name: "Zeta Bank", city: "Abilene", state_code: "KS", cbsa_code: null, cbsa_name: null, charter_type: "bank" },
      { id: 21, institution_name: "Alpha Credit Union", city: "Salina", state_code: "KS", cbsa_code: "41460", cbsa_name: "Salina, KS", charter_type: "credit_union" },
    ]);
  });
  return { db: db as unknown as Db, queries };
}

const base = { id: 1, institution_name: "Prairie Bank", city: "Hays", state_code: "KS", cbsa_name: null, charter_type: "bank", asset_size: 800_000 };

describe("loadMarket", () => {
  it("compares an institution in no metro with the state's institutions closest in assets", async () => {
    const { db, queries } = fakeDb({ ...base, cbsa_code: null });
    const market = await loadMarket(db, 1);
    expect(market?.scope).toBe("state");
    expect(market?.peers.map((peer) => peer.name)).toEqual(["Alpha Credit Union", "Zeta Bank"]);
    const peerQuery = queries[1];
    expect(peerQuery.query).toContain("s.state_code =");
    expect(peerQuery.query).toContain("ORDER BY ABS(s.asset_size -");
    expect(peerQuery.values).toEqual(expect.arrayContaining(["KS", 800_000, SNAPSHOT_STATE_PEERS]));
  });

  it("keeps a metro institution's peers in its CBSA", async () => {
    const { db, queries } = fakeDb({ ...base, cbsa_code: "25700", cbsa_name: "Hays, KS" });
    const market = await loadMarket(db, 1);
    expect(market?.scope).toBe("metro");
    expect(queries[1].query).toContain("s.cbsa_code =");
  });

  it("finds no peers for an institution with neither a metro nor a state", async () => {
    const { db, queries } = fakeDb({ ...base, cbsa_code: null, state_code: null });
    expect(await loadMarket(db, 1)).toMatchObject({ peers: [], scope: "state" });
    expect(queries).toHaveLength(1);
  });
});
