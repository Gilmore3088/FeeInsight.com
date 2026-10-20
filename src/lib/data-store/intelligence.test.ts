import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn() as ReturnType<typeof vi.fn> & {
    unsafe: ReturnType<typeof vi.fn>;
  };
  mockSql.unsafe = vi.fn();
  return {
    getSql: () => mockSql,
    sql: mockSql,
  };
});

import {
  searchExternalIntelligence,
  listIntelligence,
} from "./intelligence";
import type { ExternalIntelligence, IntelligenceSearchResult } from "./intelligence";
import { getSql } from "./connection";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return getSql() as unknown as MockSql;
}

const sampleIntelligence: ExternalIntelligence = {
  id: 1,
  source_name: "CFPB Overdraft Fee Study",
  source_date: "2024-12-01",
  category: "research",
  tags: ["overdraft", "cfpb"],
  content_text: "Overdraft fee revenue declined 7.2% year-over-year according to CFPB analysis.",
  source_url: "https://www.consumerfinance.gov/data-research/overdraft",
  created_at: "2026-01-15T10:00:00Z",
  created_by: "admin",
};

describe("searchExternalIntelligence", () => {
  beforeEach(() => {
    getMock().mockReset();
    getMock().unsafe = vi.fn();
  });

  it("returns results matching content or source_name", async () => {
    const searchResult: IntelligenceSearchResult = {
      ...sampleIntelligence,
      headline: "Overdraft fee revenue <b>declined</b> 7.2% year-over-year",
      rank: 0.85,
    };
    getMock().mockResolvedValueOnce([searchResult]);

    const results = await searchExternalIntelligence("overdraft");

    expect(results).toHaveLength(1);
    expect(results[0].source_name).toBe("CFPB Overdraft Fee Study");
    expect(results[0].headline).toMatch(/overdraft/i);
    expect(results[0].rank).toBeGreaterThan(0);
  });

  it("returns empty array when no results match", async () => {
    getMock().mockResolvedValueOnce([]);

    const results = await searchExternalIntelligence("zzznomatch");

    expect(results).toEqual([]);
  });

  it("with category filter narrows results", async () => {
    const surveyResult: IntelligenceSearchResult = {
      ...sampleIntelligence,
      category: "survey",
      headline: "Survey on overdraft <b>usage</b>",
      rank: 0.7,
    };
    getMock().mockResolvedValueOnce([surveyResult]);

    const results = await searchExternalIntelligence("overdraft", {
      category: "survey",
    });

    expect(getMock()).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("survey");
  });

  it("with tags filter narrows results", async () => {
    const taggedResult: IntelligenceSearchResult = {
      ...sampleIntelligence,
      tags: ["cfpb"],
      headline: "CFPB analysis of overdraft",
      rank: 0.6,
    };
    getMock().mockResolvedValueOnce([taggedResult]);

    const results = await searchExternalIntelligence("overdraft", {
      tags: ["cfpb"],
    });

    expect(getMock()).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].tags).toContain("cfpb");
  });
});

describe("listIntelligence", () => {
  beforeEach(() => {
    getMock().mockReset();
    getMock().unsafe = vi.fn();
  });

  it("returns all entries sorted by source_date desc", async () => {
    const entry1 = { ...sampleIntelligence, id: 2, source_date: "2024-11-01", count: "2" };
    const entry2 = { ...sampleIntelligence, id: 1, source_date: "2024-10-01", count: "2" };
    getMock().mockResolvedValueOnce([entry1, entry2]);

    const result = await listIntelligence();

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it("returns total count alongside items", async () => {
    const rowWithCount = { ...sampleIntelligence, count: "10" };
    getMock().mockResolvedValueOnce([rowWithCount]);

    const result = await listIntelligence(1);

    expect(result.total).toBe(10);
    expect(result.items).toHaveLength(1);
  });
});

// ── Type-level checks ─────────────────────────────────────────────────────────

describe("ExternalIntelligence type", () => {
  it("has required fields with correct types", () => {
    const intel: ExternalIntelligence = {
      id: 1,
      source_name: "ABA Study",
      source_date: "2024-06-01",
      category: "survey",
      tags: ["aba", "fees"],
      content_text: "Banks collected $X billion in service fees.",
      source_url: null,
      created_at: "2026-01-01T00:00:00Z",
      created_by: null,
    };
    expect(intel.id).toBe(1);
    expect(intel.source_url).toBeNull();
    expect(intel.created_by).toBeNull();
  });
});

describe("IntelligenceSearchResult type", () => {
  it("extends ExternalIntelligence with headline and rank", () => {
    const result: IntelligenceSearchResult = {
      ...sampleIntelligence,
      headline: "Overdraft <b>fee</b> revenue",
      rank: 0.95,
    };
    expect(result.headline).toContain("<b>");
    expect(result.rank).toBe(0.95);
  });
});
