import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { buildLeaders, buildStateFeeMedians, districtStates, getDistrictHub, isEmptyDistrictHub } from "./district-hub";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function fee(state_code: string, institution_id: number, amount: number, fee_category = "overdraft") {
  return { state_code, fee_category, amount, institution_id, review_status: "approved", created_at: "2026-10-03T00:00:00Z", charter_type: "bank" };
}

describe("districtStates", () => {
  it("lists the district's states", () => {
    expect(districtStates(8)).toEqual(["AR", "MO"]);
    expect(districtStates(11)).toEqual(["TX"]);
  });
});

describe("buildStateFeeMedians", () => {
  it("gives a median only from five institutions, one value each", () => {
    const rows = [
      ...[20, 25, 30, 35, 40].map((v, i) => fee("MO", i + 1, v)),
      fee("MO", 1, 99), // a second overdraft row for institution 1 does not count twice
      ...[10, 12].map((v, i) => fee("AR", i + 10, v)),
    ];
    const result = buildStateFeeMedians(rows);
    const mo = result.find((s) => s.state_code === "MO")!;
    expect(mo.fees.overdraft.institutions).toBe(5);
    expect(mo.fees.overdraft.median).not.toBeNull();
    const ar = result.find((s) => s.state_code === "AR")!;
    expect(ar.fees.overdraft).toEqual({ median: null, institutions: 2 });
  });
});

describe("buildLeaders", () => {
  it("sums each bank across states, ranks by deposits and never lists Frost Bank", () => {
    const leaders = buildLeaders([
      { institution_id: 1, institution_name: "Frost Bank", branches: 150, deposits: 50_000_000 },
      { institution_id: 2, institution_name: "First Bank", branches: 10, deposits: 1_000 },
      { institution_id: 2, institution_name: "First Bank", branches: 5, deposits: 500 },
      { institution_id: 3, institution_name: "Second Bank", branches: 3, deposits: 2_000 },
      { institution_id: null, institution_name: null, branches: 1, deposits: 9_999_999 },
    ]);
    expect(leaders.map((l) => l.name)).toEqual(["Second Bank", "First Bank"]);
    expect(leaders[1]).toEqual({ institution_id: 2, name: "First Bank", branches: 15, deposits: 1_500_000 });
  });
});

describe("getDistrictHub", () => {
  beforeEach(() => { db.unsafe.mockReset(); });

  it("reads fees only from approved published_fee_catalog rows in the district", async () => {
    db.unsafe.mockResolvedValue([]);
    await getDistrictHub(8, new Date("2026-10-16T00:00:00Z"));
    const texts = db.unsafe.mock.calls.map(([text]) => String(text));
    const feeRead = db.unsafe.mock.calls.find(([text]) => String(text).includes("ef.fee_category = ANY"))!;
    expect(feeRead[0]).toContain("FROM published_fee_catalog");
    expect(feeRead[0]).toContain("review_status = 'approved'");
    expect(feeRead[1][0]).toBe(8);
    expect(texts.join("\n")).not.toMatch(/extracted_fees|crawl_/);
    // Complaints count only accepted CFPB matches.
    expect(texts.find((t) => t.includes("institution_complaint_records"))).toContain("l.status = 'accepted'");
  });

  it("returns empty parts when tables fail, and is then empty for the cache", async () => {
    db.unsafe.mockImplementation(async () => {
      throw new Error("relation is missing");
    });
    const hub = await getDistrictHub(12, new Date("2026-10-16T00:00:00Z"));
    expect(hub.states).toContain("CA");
    expect(hub.branches).toBeNull();
    expect(hub.complaints).toBeNull();
    expect(hub.revenue).toEqual([]);
    expect(hub.fee_changes_since).toBe("2025-10-16");
    expect(isEmptyDistrictHub(hub)).toBe(true);
  });
});
