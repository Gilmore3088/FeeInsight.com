import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { sql } from "./connection";
import type { MarketingTouch } from "@/lib/marketing-touch";
import { insertMarketingTouch, recordLeadFirstTouch } from "./marketing-touches";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;

const FIRST_COLUMNS = [
  "first_utm_source",
  "first_utm_medium",
  "first_utm_campaign",
  "first_utm_content",
  "first_landing_path",
] as const;
type LeadRow = Record<(typeof FIRST_COLUMNS)[number], string | null> & { id: number };

function touch(source: string, campaign: string): MarketingTouch {
  return {
    utm_source: source,
    utm_medium: "social",
    utm_campaign: campaign,
    utm_content: null,
    utm_term: null,
    landing_path: "/for-institutions",
    referrer_host: null,
  };
}

/**
 * A one-row stand-in for leads that applies the UPDATE the way Postgres would: the SET only
 * happens when every WHERE guard the statement names holds for the row.
 */
function fakeLeads(row: LeadRow) {
  sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    const where = text.slice(text.indexOf("WHERE"));
    const guarded = FIRST_COLUMNS.filter((column) => where.includes(`${column} IS NULL`));
    const matches = values[5] === row.id && guarded.every((column) => row[column] === null);
    if (!matches) return Promise.resolve([]);
    FIRST_COLUMNS.forEach((column, index) => {
      row[column] = values[index] as string | null;
    });
    return Promise.resolve([{ id: row.id }]);
  });
}

describe("recordLeadFirstTouch", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("guards on every first-touch column, so a lead's values all come from one touch", async () => {
    sqlMock.mockResolvedValue([]);
    await recordLeadFirstTouch(9, touch("linkedin", "a"));
    const text = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join("?");
    for (const column of FIRST_COLUMNS) expect(text).toContain(`${column} IS NULL`);
  });

  it("first touch wins: a later touch never replaces the stored one", async () => {
    const row: LeadRow = {
      id: 9,
      first_utm_source: null,
      first_utm_medium: null,
      first_utm_campaign: null,
      first_utm_content: null,
      first_landing_path: null,
    };
    fakeLeads(row);

    expect(await recordLeadFirstTouch(9, touch("linkedin", "market-spread"))).toBe(true);
    expect(await recordLeadFirstTouch(9, touch("mailerlite", "pulse"))).toBe(false);

    expect(row).toMatchObject({
      first_utm_source: "linkedin",
      first_utm_medium: "social",
      first_utm_campaign: "market-spread",
      first_utm_content: null,
      first_landing_path: "/for-institutions",
    });
  });

  it("leaves a lead with any stored first-touch value alone", async () => {
    const row: LeadRow = {
      id: 9,
      first_utm_source: null,
      first_utm_medium: null,
      first_utm_campaign: "earlier",
      first_utm_content: null,
      first_landing_path: null,
    };
    fakeLeads(row);
    expect(await recordLeadFirstTouch(9, touch("linkedin", "later"))).toBe(false);
    expect(row.first_utm_source).toBeNull();
    expect(row.first_utm_campaign).toBe("earlier");
  });
});

describe("insertMarketingTouch", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("stores the seven touch fields and nothing that identifies a person", async () => {
    sqlMock.mockResolvedValue([]);
    await insertMarketingTouch({ ...touch("linkedin", "fee-depth"), referrer_host: "lnkd.in" });
    const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = strings.join("?");
    expect(text).toContain("INSERT INTO marketing_touches");
    expect(text).not.toMatch(/\bip\b|user_agent|cookie|email/i);
    expect(values).toEqual(["linkedin", "social", "fee-depth", null, null, "/for-institutions", "lnkd.in"]);
  });
});
