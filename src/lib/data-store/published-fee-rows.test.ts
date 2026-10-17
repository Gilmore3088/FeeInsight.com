import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import { getSql } from "./connection";
import { listPublishedFeeRows, publishedFeeRowWhere } from "./published-fee-rows";
import { rateFeeListWhere } from "./rate-fees";

describe("changed-since row readers", () => {
  it("filters dollar fee rows on the catalog's publish date, values as parameters only", () => {
    const since = new Date("2026-10-01T00:00:00Z");
    expect(publishedFeeRowWhere({ institution_id: 12, state_code: "TX", charter_type: "bank", updated_since: since })).toEqual({
      where:
        "ef.review_status = 'approved' AND ef.institution_id = $1 AND ct.state_code = $2 AND ct.charter_type = $3 AND ef.created_at >= $4::timestamptz",
      params: [12, "TX", "bank", "2026-10-01T00:00:00.000Z"],
    });
  });

  it("filters rate fees the same way, keeping only usable rates", () => {
    expect(rateFeeListWhere({ fee_category: "card_foreign_txn", updated_since: new Date("2026-10-01T00:00:00Z") })).toEqual({
      where: "ef.rate_percent > 0 AND ef.fee_category = $1 AND ef.created_at >= $2::timestamptz",
      params: ["card_foreign_txn", "2026-10-01T00:00:00.000Z"],
    });
  });

  it("pages in publish-date then id order from published_fee_catalog", async () => {
    const mockSql = getSql() as unknown as { unsafe: ReturnType<typeof vi.fn> };
    mockSql.unsafe = vi.fn()
      .mockResolvedValueOnce([{ total: "3" }])
      .mockResolvedValueOnce([{
        id: "501", institution_id: "12", institution_name: "EXAMPLE BANK", state_code: "TX", charter_type: "bank",
        fee_name: "Overdraft Fee", fee_category: "overdraft", amount: "35.00", frequency: null, conditions: null,
        source_url: null, created_at: new Date("2026-10-02T14:05:00Z"),
      }]);

    const result = await listPublishedFeeRows({ state_code: "TX" }, { limit: 2, offset: 2 });

    const [query, params] = mockSql.unsafe.mock.calls[1];
    expect(query).toContain("FROM published_fee_catalog ef");
    expect(query).toContain("ORDER BY ef.created_at ASC NULLS FIRST, ef.id ASC");
    expect(params).toEqual(["TX", 2, 2]);
    expect(result.total).toBe(3);
    expect(result.rows[0]).toMatchObject({ fee_id: 501, institution_id: 12, amount: 35, published_at: "2026-10-02T14:05:00.000Z" });
  });
});
