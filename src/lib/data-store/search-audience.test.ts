import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[], params: [] as unknown[][] }));

vi.mock("./connection", () => {
  const unsafe = vi.fn(async (query: string, params: unknown[] = []) => {
    state.queries.push(query);
    state.params.push(params);
    return query.startsWith("SELECT COUNT(*) as cnt") ? [{ cnt: 0 }] : [];
  });
  const sql = Object.assign(vi.fn(), { unsafe });
  return { sql, getSql: () => sql };
});

import { searchInstitutions } from "./search";

beforeEach(() => {
  state.queries.length = 0;
  state.params.length = 0;
});

describe("institution directory fee focus audience boundary", () => {
  it("sorts on one sourced consumer/both value and preserves real zero", async () => {
    await searchInstitutions({ fee_category: "overdraft", fee_sort: "asc", page: 1, pageSize: 25 });

    expect(state.queries).toHaveLength(2);
    const query = state.queries[1];
    expect(query).toContain("LEFT JOIN LATERAL");
    expect(query).toContain("source_document_id IS NOT NULL");
    expect(query).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain("ef.amount >= 0");
    expect(query).not.toContain("ef.amount > 0");
    expect(query).toContain("THEN MAX(ef.amount)");
    expect(query).toContain("PERCENTILE_CONT(0.5)");
    expect(query).not.toContain("ORDER BY ef.amount ASC");
  });
});


describe("institution directory SQL category placeholders (#1012)", () => {
  it.each([
    {
      name: "category only",
      input: { fee_category: "overdraft" },
      feeParamIndex: 1,
      values: ["overdraft", 25, 0],
    },
    {
      name: "state and category",
      input: { state_code: "TN", fee_category: "overdraft" },
      feeParamIndex: 2,
      values: ["TN", "overdraft", 25, 0],
    },
    {
      name: "search, state, charter and category",
      input: {
        query: "Pinnacle",
        state_code: "TN",
        charter_type: "bank",
        fee_category: "overdraft",
      },
      // The name match binds three values: the typed name, its squashed form and short-name aliases.
      feeParamIndex: 6,
      values: ["%Pinnacle%", "%pinnacle%", [], "TN", "bank", "overdraft", 25, 0],
    },
  ])("binds the fee category as text with $name", async ({ input, feeParamIndex, values }) => {
    const result = await searchInstitutions({ ...input, page: 1, pageSize: 25 });

    expect(result).toEqual({ rows: [], total: 0 });
    expect(state.queries).toHaveLength(2);
    expect(state.params[1]).toEqual(values);
    const query = state.queries[1];
    // Never embed the numeric argument index as a literal: 1 = 'overdraft'
    // produces PostgreSQL 22P02 (invalid integer input syntax).
    expect(query).toContain("CASE WHEN $" + feeParamIndex + " = 'overdraft'");
    expect(query).toContain("ef.fee_category = $" + feeParamIndex);
    expect(query).not.toMatch(/CASE WHEN \d+ = 'overdraft'/);
    expect(query).not.toMatch(/ef\.fee_category = \d+\b/);
    expect(query).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain("ef.amount >= 0");
  });

  it("binds a non-overdraft fee for page two without changing median semantics", async () => {
    await searchInstitutions({
      state_code: "FL",
      fee_category: "nsf_fee",
      fee_sort: "desc",
      page: 2,
      pageSize: 25,
    });
    expect(state.queries).toHaveLength(2);
    expect(state.params[1]).toEqual(["FL", "nsf_fee", 25, 25]);
    const query = state.queries[1];
    expect(query).toContain("CASE WHEN $2 = 'overdraft'");
    expect(query).toContain("ef.fee_category = $2");
    expect(query).toContain("PERCENTILE_CONT(0.5)");
    expect(query).toContain("ORDER BY focus.amount DESC NULLS LAST");
  });

  it("does not create a category join when the fee filter is absent", async () => {
    await searchInstitutions({ state_code: "TN", page: 1, pageSize: 25 });
    expect(state.queries).toHaveLength(2);
    expect(state.params[1]).toEqual(["TN", 25, 0]);
    expect(state.queries[1]).not.toContain("LEFT JOIN LATERAL");
  });
});
