import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({
  sql: {
    unsafe: vi.fn(),
  },
}));

import { autocompleteInstitutions, institutionSearchPatterns } from "./search";
import { sql } from "./connection";

const unsafeMock = sql.unsafe as unknown as ReturnType<typeof vi.fn>;

describe("autocompleteInstitutions", () => {
  beforeEach(() => {
    unsafeMock.mockReset();
  });

  it("returns public-safe quality labels and prioritizes asset size in the query", async () => {
    unsafeMock.mockResolvedValueOnce([
      {
        id: 1,
        institution_name: "JPMorgan Chase Bank, National Association",
        city: "Columbus",
        state_code: "OH",
        charter_type: "bank",
        asset_size_tier: "super_regional",
        asset_size: "3813431000",
        source: "fdic",
        cert_number: "628",
        website_url: "https://www.jpmorganchase.com",
        fee_schedule_url:
          "https://www.jpmorganchase.com/ir/news/2021/chase-helps-more-than-two-million-customers-avoid-overdraft-service-fees",
        fee_count: "0",
        published_fee_count: "0",
        provisional_fee_count: "0",
        latest_source_status: "failed",
        latest_extracted_fee_count: "0",
        latest_source_error: null,
        latest_source_collected_at: "2026-03-17T01:00:43Z",
      },
    ]);

    const rows = await autocompleteInstitutions("jpm");

    expect(unsafeMock.mock.calls[0][0]).toContain("ct.asset_size DESC NULLS LAST");
    expect(rows[0]).toMatchObject({
      id: 1,
      quality_status: "needs_review",
      quality_label: "Fee schedule under review",
      fee_publication_status: "under_review",
      fee_publication_label: "Fee data under review",
      insight_readiness: "under_review",
      source_needed_reason: "latest_source_failed",
      published_fee_count: 0,
      provisional_fee_count: 0,
      fee_count: 0,
    });
  });

  it("surfaces provisional fee counts separately from approved fee counts", async () => {
    unsafeMock.mockResolvedValueOnce([
      {
        id: 2945,
        institution_name: "1st Advantage Bank",
        city: "Saint Peters",
        state_code: "MO",
        charter_type: "bank",
        asset_size_tier: "community",
        asset_size: "208795",
        source: "fdic",
        cert_number: "2945",
        website_url: "https://example.com",
        fee_schedule_url: "https://example.com/fees.pdf",
        fee_count: "7",
        published_fee_count: "0",
        provisional_fee_count: "7",
        latest_source_status: "success",
        latest_extracted_fee_count: "7",
        latest_source_error: null,
        latest_source_collected_at: "2026-08-01T12:00:00Z",
      },
    ]);

    const rows = await autocompleteInstitutions("1st");

    expect(rows[0]).toMatchObject({
      id: 2945,
      fee_count: 7,
      published_fee_count: 0,
      provisional_fee_count: 7,
      fee_publication_status: "provisional",
      fee_publication_label: "Provisional fees",
      insight_readiness: "directional",
      source_needed_reason: "not_applicable",
      quality_status: "needs_review",
    });
  });
});

describe("institution search short names (#1545)", () => {
  it("finds M&T (id 21, filed as Manufacturers and Traders Trust Company) from M&T and M&T Bank", async () => {
    for (const q of ["M&T", "M&T Bank", "m&t bank"]) {
      expect(institutionSearchPatterns(q).aliases).toEqual(["Manufacturers and Traders Trust%"]);
    }
    unsafeMock.mockReset();
    unsafeMock.mockResolvedValueOnce([]);
    await autocompleteInstitutions("M&T Bank");
    const [text, params] = unsafeMock.mock.calls[0];
    expect(text).toContain("ct.institution_name ILIKE ANY($5::text[])");
    expect(params).toEqual(["%M&T Bank%", "M&T Bank", 8, "%m&t bank%", ["Manufacturers and Traders Trust%"]]);
  });
  it("reads U.S. Bank and US Bank alike, and keeps the ampersand", () => {
    expect(institutionSearchPatterns("US Bank").aliases).toEqual(["U.S. Bank%"]);
    expect(institutionSearchPatterns("U.S. Bank").squashed).toBe("%us bank%");
    expect(institutionSearchPatterns("BofA").aliases).toEqual(["Bank of America%"]);
    expect(institutionSearchPatterns("Navy Federal").aliases).toEqual([]);
  });
});

describe("institution search bounds (2026-10-18 scrape)", () => {
  beforeEach(() => {
    unsafeMock.mockReset();
  });

  it("never sends a wildcard-only or punctuation-only query to the database", async () => {
    for (const q of ["%%", "__", "%_%_", "!!", "--", "a%"]) {
      expect(await autocompleteInstitutions(q)).toEqual([]);
    }
    expect(unsafeMock).not.toHaveBeenCalled();
  });

  it("matches % and _ literally, so a typed wildcard cannot widen the read", () => {
    expect(institutionSearchPatterns("50% Bank").pattern).toBe("%50\\% Bank%");
    expect(institutionSearchPatterns("a_b").pattern).toBe("%a\\_b%");
    // Punctuation squashes away; a term left with under two letters keeps the literal pattern.
    expect(institutionSearchPatterns("%%ab").squashed).toBe("%ab%");
    expect(institutionSearchPatterns("é%").squashed).toBe("%é\\%%");
  });

  it("cuts a long query and caps the row count", async () => {
    unsafeMock.mockResolvedValueOnce([]);
    await autocompleteInstitutions("x".repeat(5_000), 100_000);
    const [, params] = unsafeMock.mock.calls[0];
    expect(String(params[1])).toHaveLength(100);
    expect(params[2]).toBe(25);
  });
});
