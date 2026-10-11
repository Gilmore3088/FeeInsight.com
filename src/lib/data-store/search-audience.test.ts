import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[] }));

vi.mock("./connection", () => {
  const unsafe = vi.fn(async (query: string) => {
    state.queries.push(query);
    return query.startsWith("SELECT COUNT(*) as cnt") ? [{ cnt: 0 }] : [];
  });
  const sql = Object.assign(vi.fn(), { unsafe });
  return { sql, getSql: () => sql };
});

import { searchInstitutions } from "./search";

beforeEach(() => {
  state.queries.length = 0;
});

describe("institution directory fee focus audience boundary", () => {
  it("sorts on one sourced consumer/both value and preserves real zero", async () => {
    await searchInstitutions({ fee_category: "overdraft", fee_sort: "asc", page: 1, pageSize: 25 });

    expect(state.queries).toHaveLength(2);
    const query = state.queries[1];
    expect(query).toContain("LEFT JOIN LATERAL");
    expect(query).toContain("source_document_id IS NOT NULL");
    expect(query).toContain("fee_audience IN ('consumer', 'both')");
    expect(query).toContain("ef.amount >= 0");
    expect(query).not.toContain("ef.amount > 0");
    expect(query).toContain("THEN MAX(ef.amount)");
    expect(query).toContain("PERCENTILE_CONT(0.5)");
    expect(query).not.toContain("ORDER BY ef.amount ASC");
  });
});
