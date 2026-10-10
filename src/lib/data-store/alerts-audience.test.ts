import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[] }));

vi.mock("./connection", () => {
  const sql = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.reduce(
        (out, part, index) => out + part + (index < values.length ? String(values[index]) : ""),
        "",
      );
      state.queries.push(text);
      return [];
    }),
    { unsafe: vi.fn((text: string) => text) },
  );
  return { sql, getSql: () => sql };
});

import { getSavedInstitutionFees } from "./alerts";

beforeEach(() => {
  state.queries.length = 0;
});

describe("saved institution guide fee audience boundary", () => {
  it("uses sourced consumer/both evidence, keeps zero, and uses the highest overdraft tier", async () => {
    await getSavedInstitutionFees(7, "overdraft");

    expect(state.queries).toHaveLength(1);
    const query = state.queries[0];
    expect(query).toContain("ef.source_document_id IS NOT NULL");
    expect(query).toContain("ef.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("ef.amount >= 0");
    expect(query).not.toContain("ef.amount > 0");
    expect(query).toContain("THEN MAX(ef.amount)");
    expect(query).toContain("PERCENTILE_CONT(0.5)");
    expect(query).not.toContain("ORDER BY ef.amount ASC");
  });
});
