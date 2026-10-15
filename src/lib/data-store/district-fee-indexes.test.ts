import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { getDistrictFeeIndexes } from "./fee-index";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function row(institution_id: number, amount: number, charter_type = "bank") {
  return {
    fee_category: "overdraft",
    amount,
    institution_id,
    review_status: "approved",
    created_at: "2026-10-03T00:00:00Z",
    charter_type,
  };
}

describe("getDistrictFeeIndexes", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("reads only the district's approved published fees", async () => {
    db.unsafe.mockResolvedValue([]);
    await getDistrictFeeIndexes(8);
    const [text, params] = db.unsafe.mock.calls[0];
    expect(text).toContain("FROM published_fee_catalog");
    expect(text).toContain("ct.fed_district = $1");
    expect(text).toContain("review_status = 'approved'");
    expect(params).toEqual([8]);
  });

  it("builds the same shape as the state read, overall and by charter", async () => {
    db.unsafe.mockResolvedValue([
      row(1, 20),
      row(2, 25),
      row(3, 30),
      row(4, 35, "credit_union"),
      row(5, 40, "credit_union"),
    ]);
    const result = await getDistrictFeeIndexes(8);
    const overall = result.all.find((e) => e.fee_category === "overdraft");
    expect(overall?.institution_count).toBe(5);
    expect(overall?.median_amount).toBe(30);
    expect(result.bank.find((e) => e.fee_category === "overdraft")?.institution_count).toBe(3);
  });
});
