import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Data refreshed" and "updated" dates tell a visitor when the published fees last changed.
 * A document crawl publishes nothing, so a crawl date must never stand in for one (#1811).
 */
const rows = vi.hoisted(() => ({ headline: {} as Record<string, unknown> }));

vi.mock("@/lib/data-store/connection", () => {
  // A tagged-template call reads a row; `sql([...])` and `sql.unsafe` build fragments.
  const sql = (first: unknown) => {
    const strings = first as TemplateStringsArray;
    if (!Array.isArray(first) || !("raw" in strings)) return first;
    return Promise.resolve(strings.join("").includes("published_fee_catalog") ? [rows.headline] : [{ cnt: 9000 }]);
  };
  return { sql: Object.assign(sql, { unsafe: (text: string) => text }) };
});
vi.mock("@/lib/data-store/fees", () => ({
  getFeeCategorySummaries: vi.fn(async () => []),
}));

import { getPublicSnapshot } from "./public-stats";

const headline = (overrides: Record<string, unknown>) => ({
  observations: 100,
  institutions: 10,
  categories: ["overdraft"],
  states: ["TX"],
  last_fee_at: null,
  last_crawl_at: null,
  ...overrides,
});

describe("public freshness date (#1811)", () => {
  beforeEach(() => {
    rows.headline = headline({});
  });

  it("dates the data by the newest published fee", async () => {
    rows.headline = headline({
      last_fee_at: "2026-10-12T15:00:00.000Z",
      last_crawl_at: "2026-10-19T15:00:00.000Z",
    });
    const { summary } = await getPublicSnapshot();
    expect(summary.refreshedOn).toBe("Oct 12, 2026");
    expect(summary.freshnessLabel).toBe("Data refreshed Oct 12, 2026");
  });

  it("never shows a crawl date as the update date when no fee date is known", async () => {
    rows.headline = headline({ last_fee_at: null, last_crawl_at: "2026-10-19T15:00:00.000Z" });
    const { summary } = await getPublicSnapshot();
    expect(summary.refreshedOn).toBeNull();
    expect(summary.freshnessLabel).toBe("Data refresh pending");
  });
});
