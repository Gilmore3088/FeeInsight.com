import { beforeEach, describe, expect, it, vi } from "vitest";
import { STATS_ROW_FILTER } from "./fee-stats";

/** The coverage read (#1891): live published fees only, the stats row rule, and each document's own stated date. */
const calls: { query: string; params: unknown[] }[] = [];
let rows: unknown[] = [];

vi.mock("@/lib/data-store/connection", () => ({
  sql: { unsafe: (query: string, params: unknown[]) => { calls.push({ query, params }); return Promise.resolve(rows); } },
}));

import { getInstitutionFeeCoverage } from "./institution-coverage";

describe("getInstitutionFeeCoverage", () => {
  beforeEach(() => { calls.length = 0; rows = []; });

  it("reads published_fee_catalog under the stats row rule, never extracted_fees", async () => {
    await getInstitutionFeeCoverage(7101);
    const [{ query, params }] = calls;
    expect(query).toContain("FROM published_fee_catalog ef");
    expect(query).toContain(STATS_ROW_FILTER);
    expect(query).toContain("ef.review_status = 'approved'");
    expect(query).toContain("doc.stated_date");
    expect(query).toContain("doc.stated_date_version");
    expect(query).not.toContain("doc.institution_id = $1");
    expect(query).toContain("verified_fee_observations fv");
    expect(query).not.toContain("extracted_fees");
    expect(params).toEqual([7101]);
  });

  it("shapes the row: counts as numbers, days as YYYY-MM-DD, the verified time as ISO, unread dates as unread", async () => {
    rows = [{
      fees: "47",
      categories: ["nsf", "overdraft"],
      last_verified_at: new Date("2026-10-17T13:50:37Z"),
      documents: [
        { id: "6680", stated_date: "2026-08-01", stated_basis: "effective_statement", stated_version: 1 },
        { id: 14133, stated_date: null, stated_basis: "none", stated_version: "1" },
        { id: 14134, stated_date: null, stated_basis: null, stated_version: null },
        { id: 14135, stated_date: null, stated_basis: "none", stated_version: 0 },
      ],
    }];
    expect(await getInstitutionFeeCoverage(7101)).toEqual({
      fees: 47,
      categories: ["nsf", "overdraft"],
      documents: [
        { id: 6680, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
        { id: 14133, statedDate: null, statedBasis: "none", statedRead: true },
        // Not read yet (no version, or a version older than STATED_DATE_VERSION): never "states no date".
        { id: 14134, statedDate: null, statedBasis: null, statedRead: false },
        { id: 14135, statedDate: null, statedBasis: null, statedRead: false },
      ],
      lastVerifiedAt: "2026-10-17T13:50:37.000Z",
    });
  });

  it("reads an institution with nothing on file as empty, not as an error", async () => {
    rows = [{ fees: 0, categories: [], last_verified_at: null, documents: [] }];
    expect(await getInstitutionFeeCoverage(1)).toEqual({ fees: 0, categories: [], documents: [], lastVerifiedAt: null });
  });
});
