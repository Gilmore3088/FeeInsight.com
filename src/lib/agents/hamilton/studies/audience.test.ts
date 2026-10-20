import { describe, expect, it, vi } from "vitest";

import { readInstitutionPrices } from "./common";
import { readIncomeAndFees } from "./inferred-volume";

function dbMock() {
  const queries: string[] = [];
  const db = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.reduce(
        (out, part, index) => out + part + (index < values.length ? String(values[index]) : ""),
        "",
      );
      queries.push(text);
      return [];
    }),
    { unsafe: vi.fn((text: string) => text) },
  );
  return { db, queries };
}

describe("Hamilton study fee audience boundaries", () => {
  it("reads consumer/both study prices, preserves real zero, and uses the highest overdraft tier", async () => {
    const { db, queries } = dbMock();

    await readInstitutionPrices(db as never);

    expect(queries).toHaveLength(1);
    const query = queries[0];
    expect(query).toContain("f.source_document_id IS NOT NULL");
    expect(query).toContain("f.fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain("f.amount >= 0");
    expect(query).not.toContain("f.amount > 0");
    expect(query).toContain("THEN MAX(f.amount)");
    expect(query).toContain("percentile_cont(0.5)");
  });

  it("keeps inferred-volume denominators positive while excluding business/unknown fee rows", async () => {
    const { db, queries } = dbMock();

    await readIncomeAndFees(db as never);

    expect(queries).toHaveLength(1);
    const query = queries[0];
    expect(query).toContain("f.source_document_id IS NOT NULL");
    expect(query).toContain("f.fee_audience IN ('consumer', 'both', 'unknown')");
    expect(query).toContain("f.amount > 0");
    // #2052: each row carries its charter's newest filing so stale income can be left out.
    expect(query).toMatch(/MAX\(report_date\)[\s\S]*service_charge_income IS NOT NULL/);
    expect(query).toContain("newest_filing");
  });
});
