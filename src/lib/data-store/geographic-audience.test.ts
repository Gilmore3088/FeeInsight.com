import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[] }));

vi.mock("./connection", () => {
  const sql = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      state.queries.push(
        parts.reduce(
          (out, part, index) => out + part + (index < values.length ? String(values[index]) : ""),
          "",
        ),
      );
      return [];
    }),
    { unsafe: vi.fn((text: string) => text) },
  );
  return { sql, getSql: () => sql };
});

import { getCityFeeAverages, getCityInstitutions } from "./geographic";

beforeEach(() => {
  state.queries.length = 0;
});

function expectConsumerBoundary(query: string) {
  expect(query).toContain("source_document_id IS NOT NULL");
  expect(query).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
  expect(query).toContain("amount >= 0");
  expect(query).not.toContain("amount > 0");
}

describe("city fee comparison audience boundaries", () => {
  it("uses one consumer-applicable value per headline fee and preserves zero", async () => {
    await getCityInstitutions("Nashville", "TN");

    // The city's stored spellings (#2092), then the list.
    expect(state.queries).toHaveLength(2);
    const query = state.queries[1];
    expectConsumerBoundary(query);
    expect(query).toContain("MAX(ef.amount)");
    expect(query).toContain("PERCENTILE_CONT(0.5)");
  });

  it("filters city averages to sourced consumer/both observations", async () => {
    await getCityFeeAverages("Nashville", "TN");

    expect(state.queries).toHaveLength(2);
    expectConsumerBoundary(state.queries[1]);
  });
});

describe("getCityAutocomplete bounds (2026-10-18 scrape)", () => {
  it("matches a typed % literally and caps the rows at 25", async () => {
    const { getCityAutocomplete } = await import("./geographic");
    await getCityAutocomplete("%%", 100_000);
    const query = state.queries.at(-1) ?? "";
    expect(query).toContain("ILIKE ANY(\\%\\%%::text[])");
    // Room to fold spellings (#2092); the answer itself is cut to 25 after the fold.
    expect(query).toMatch(/LIMIT 75\s*$/);
  });
});
