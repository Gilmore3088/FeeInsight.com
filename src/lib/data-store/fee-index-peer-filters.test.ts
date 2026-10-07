import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import {
  getPeerFeeValues,
  getPeerGroupCounts,
  getPeerIndex,
  getPeerIndexes,
  matchesPeerFilters,
  peerInstitutionIds,
} from "./fee-index";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function peerRow(institution_id: number, state_code: string, amount = 30, charter_type = "bank") {
  return {
    fee_category: "overdraft",
    amount,
    institution_id,
    institution_name: `Bank ${institution_id}`,
    review_status: "approved",
    created_at: "2026-10-03T00:00:00Z",
    charter_type,
    asset_size_tier: "community_mid",
    fed_district: 6,
    state_code,
    source_document_id: institution_id * 10,
    document_url: null,
  };
}

const base = { charter_type: "bank", asset_size_tier: "community_mid", fed_district: 6 };

describe("matchesPeerFilters with the new filters", () => {
  it("keeps only the chosen institutions and ignores the other filters", () => {
    const filters = { institutionIds: [1, 3], charter_type: "credit_union", states: ["TX"] };
    expect(matchesPeerFilters({ ...base, state_code: "GA", institution_id: 1 }, filters)).toBe(true);
    expect(matchesPeerFilters({ ...base, state_code: "GA", institution_id: "3" }, filters)).toBe(true);
    expect(matchesPeerFilters({ ...base, state_code: "TX", institution_id: 2 }, filters)).toBe(false);
  });

  it("matches any of the listed states", () => {
    expect(matchesPeerFilters({ ...base, state_code: "GA", institution_id: 1 }, { states: ["GA", "FL"] })).toBe(true);
    expect(matchesPeerFilters({ ...base, state_code: "AL", institution_id: 1 }, { states: ["GA", "FL"] })).toBe(false);
    expect(matchesPeerFilters({ ...base, state_code: null, institution_id: 1 }, { states: ["GA"] })).toBe(false);
  });

  it("treats an empty id list as no hand-picked peers", () => {
    expect(peerInstitutionIds({ institutionIds: [] })).toBeNull();
    expect(peerInstitutionIds({ institutionIds: [4, 4, 0, -1] })).toEqual([4]);
  });
});

describe("getPeerIndex with the new filters", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("limits the SQL to the chosen institutions only", async () => {
    db.unsafe.mockResolvedValue([]);
    await getPeerIndex({ institutionIds: [11, 12], charter_type: "bank", states: ["GA"] });
    const [text, params] = db.unsafe.mock.calls[0];
    expect(text).toContain("ct.id = ANY($1::int[])");
    expect(text).not.toContain("ct.charter_type =");
    expect(params).toEqual([[11, 12]]);
  });

  it("filters by a list of states", async () => {
    db.unsafe.mockResolvedValue([]);
    await getPeerIndex({ charter_type: "bank", states: ["GA", "FL"] });
    const [text, params] = db.unsafe.mock.calls[0];
    expect(text).toContain("ct.charter_type = $1");
    expect(text).toContain("ct.state_code = ANY($2::text[])");
    expect(params).toEqual(["bank", ["GA", "FL"]]);
  });
});

describe("getPeerIndexes with the new filters", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("anchors the read on chosen ids and states, then splits per set", async () => {
    db.unsafe.mockResolvedValue([peerRow(1, "GA", 10), peerRow(2, "FL", 20), peerRow(3, "TX", 30)]);
    const [picked, southeast] = await getPeerIndexes([{ institutionIds: [3] }, { states: ["GA", "FL"] }]);
    const [text, params] = db.unsafe.mock.calls[0];
    expect(text).toContain("ct.id = ANY($3::int[])");
    expect(params).toEqual([[], ["GA", "FL"], [3]]);
    expect(picked[0]).toMatchObject({ institution_count: 1 });
    expect(southeast[0]).toMatchObject({ institution_count: 2 });
  });
});

describe("getPeerFeeValues with the new filters", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("returns exactly the chosen peers, without the asking institution", async () => {
    db.unsafe.mockResolvedValue([peerRow(1, "GA", 10), peerRow(2, "FL", 20), peerRow(3, "TX", 30), peerRow(9, "GA", 5)]);
    const [byCategory] = await getPeerFeeValues([{ institutionIds: [2, 3, 9] }], ["overdraft"], 9);
    expect(byCategory.get("overdraft")?.map((v) => v.institution_id)).toEqual([2, 3]);
  });

  it("keeps peers in any of the listed states", async () => {
    db.unsafe.mockResolvedValue([peerRow(1, "GA", 10), peerRow(2, "FL", 20), peerRow(3, "TX", 30)]);
    const [byCategory] = await getPeerFeeValues([{ states: ["TX", "FL"] }], ["overdraft"]);
    expect(byCategory.get("overdraft")?.map((v) => v.institution_id)).toEqual([2, 3]);
  });
});

describe("getPeerGroupCounts", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("counts members and publishers per set from one registry read", async () => {
    db.unsafe.mockResolvedValue([
      { ...base, institution_id: 1, state_code: "GA", publishes: true },
      { ...base, institution_id: 2, state_code: "GA", publishes: false },
      { ...base, institution_id: 3, state_code: "TX", publishes: true },
      { ...base, institution_id: 7, state_code: "GA", publishes: true },
    ]);
    const counts = await getPeerGroupCounts([{ states: ["GA"] }, { institutionIds: [3, 7] }], 7);
    expect(db.unsafe).toHaveBeenCalledTimes(1);
    expect(counts).toEqual([
      { institutions: 2, publishing: 1 },
      { institutions: 1, publishing: 1 },
    ]);
  });
});
