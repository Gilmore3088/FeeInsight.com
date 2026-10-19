import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({
  sql: {
    unsafe: vi.fn(),
  },
}));

import {
  autocompleteInstitutions,
  getLargestInstitutions,
  institutionNameRank,
  institutionSearchPatterns,
  searchInstitutions,
} from "./search";
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
    expect(params).toEqual(["\\mM&T Bank", "M&T Bank", 8, "% m&t bank%", ["Manufacturers and Traders Trust%"]]);
  });
  it("reads U.S. Bank and US Bank alike, and keeps the ampersand", () => {
    expect(institutionSearchPatterns("US Bank").aliases).toEqual(["U.S. Bank%"]);
    expect(institutionSearchPatterns("U.S. Bank").squashed).toBe("% us bank%");
    expect(institutionSearchPatterns("BofA").aliases).toEqual(["Bank of America%"]);
    expect(institutionSearchPatterns("Navy Federal").aliases).toEqual([]);
  });
});

describe("searchInstitutions name match", () => {
  it("matches a full search the way the typeahead does, so Enter on M&T finds M&T", async () => {
    unsafeMock.mockReset();
    unsafeMock.mockResolvedValueOnce([{ cnt: 0 }]).mockResolvedValueOnce([]);
    await searchInstitutions({ query: "M&T Bank", state_code: "NY" });
    const [countText, countParams] = unsafeMock.mock.calls[0];
    expect(countText).toContain("ct.institution_name ILIKE ANY($3::text[])");
    expect(countText).toContain("ct.state_code = $4");
    expect(countParams).toEqual(["\\mM&T Bank", "% m&t bank%", ["Manufacturers and Traders Trust%"], "NY"]);
    const [, rowParams] = unsafeMock.mock.calls[1];
    expect(rowParams).toEqual(["\\mM&T Bank", "% m&t bank%", ["Manufacturers and Traders Trust%"], "NY", 25, 0]);
  });
});

describe("institution search patterns treat typed text literally", () => {
  it("escapes regex characters, keeps % and _ as plain text, and needs two letters or digits for the squashed match", () => {
    expect(institutionSearchPatterns("50%_off").pattern).toBe("\\m50%_off");
    expect(institutionSearchPatterns("&.").squashed).toBe("");
    expect(institutionSearchPatterns("U.S. (Bank)").pattern).toBe("\\mU\\.S\\. \\(Bank\\)");
    expect(institutionSearchPatterns("(M&T)").pattern).toBe("\\(M&T\\)");
    expect(institutionSearchPatterns("Navy").squashed).toBe("% navy%");
  });
});

/**
 * The name match as Postgres runs it: `name ~* pattern` (\m is a word start), the squashed name
 * after a leading space LIKE squashed, or a short-name prefix. JS \b stands in for \m here: every
 * pattern starts with a word character when it carries \m.
 */
function nameMatches(name: string, query: string): boolean {
  const { pattern, squashed, aliases } = institutionSearchPatterns(query);
  const like = (text: string, p: string) =>
    p !== "" && new RegExp(`^${p.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i").test(text);
  const squashedName = ` ${name.toLowerCase().replace(/[^a-z0-9& ]+/g, "")}`;
  return (
    new RegExp(pattern.replace(/^\\m/, "\\b"), "i").test(name) ||
    like(squashedName, squashed) ||
    aliases.some((alias) => like(name, alias))
  );
}

describe("a name search matches from the start of a word", () => {
  const NAMES = [
    "U.S. Bank National Association",
    "First US Bank",
    "Pegasus Bank",
    "Focus Bank",
    "OPTUS Bank",
    "Locus Bank, Inc.",
    "Columbus Bank and Trust Company",
    "Solutions Plus Bank",
    "Verus Bank of Commerce",
    "American Plus Bank, N.A.",
    "Manufacturers and Traders Trust Company",
    "First-Citizens Bank & Trust Company",
  ];
  const found = (query: string) => NAMES.filter((name) => nameMatches(name, query));

  it("finds U.S. Bank and First US Bank for US Bank, not names that only contain the letters", () => {
    expect(found("US Bank")).toEqual(["U.S. Bank National Association", "First US Bank"]);
    expect(found("U.S. Bank")).toEqual(["U.S. Bank National Association", "First US Bank"]);
  });
  it("still finds M&T, a word after a hyphen, and a name typed in part", () => {
    expect(found("M&T")).toEqual(["Manufacturers and Traders Trust Company"]);
    expect(found("Citizens")).toEqual(["First-Citizens Bank & Trust Company"]);
    expect(found("Manufac")).toEqual(["Manufacturers and Traders Trust Company"]);
    expect(found("pegasus")).toEqual(["Pegasus Bank"]);
  });
});

describe("institutionNameRank", () => {
  it("ranks the institution the query names ahead of other matches", () => {
    expect(institutionNameRank("U.S. Bank National Association", "US Bank")).toBe(0);
    expect(institutionNameRank("First US Bank", "US Bank")).toBe(1);
    expect(institutionNameRank("Manufacturers and Traders Trust Company", "M&T")).toBe(0);
    expect(institutionNameRank("Pegasus Bank", "pegasus bank")).toBe(0);
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

  it("cuts a long query and caps the row count", async () => {
    unsafeMock.mockResolvedValueOnce([]);
    await autocompleteInstitutions("x".repeat(5_000), 100_000);
    const [, params] = unsafeMock.mock.calls[0];
    expect(String(params[1])).toHaveLength(100);
    expect(params[2]).toBe(25);
  });
});

describe("getLargestInstitutions", () => {
  beforeEach(() => {
    unsafeMock.mockReset();
  });

  it("reads only the top rows by assets, of one type when asked, and caps the count", async () => {
    unsafeMock.mockResolvedValueOnce([]);
    await getLargestInstitutions({ charter_type: "credit_union", limit: 5_000 });
    const [text, params] = unsafeMock.mock.calls[0];
    expect(text).toContain("ORDER BY ct.asset_size DESC, ct.id\n    LIMIT $1");
    expect(text).toContain("WHERE ct.id IN (SELECT id FROM scope)");
    expect(params).toEqual([100, "credit_union"]);

    unsafeMock.mockResolvedValueOnce([]);
    await getLargestInstitutions();
    expect(unsafeMock.mock.calls[1][1]).toEqual([25, null]);
  });
});
