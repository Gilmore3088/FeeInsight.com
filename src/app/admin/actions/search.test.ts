import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => sql(strings, ...values),
}));

import { searchDashboard } from "./search";

// A name pasted with spaces around it found nothing (#1860: " TowneBank ", Beacon).
describe("admin search", () => {
  beforeEach(() => {
    sql.mockReset();
    sql.mockResolvedValue([]);
  });

  it("matches on the name without the spaces around it", async () => {
    await searchDashboard("  Beacon Bank  ");
    const institutionQuery = sql.mock.calls[0];
    expect(institutionQuery.slice(1)).toContain("%Beacon Bank%");
  });

  it("treats a query that is only spaces as too short", async () => {
    const result = await searchDashboard("   a ");
    expect(result.institutions).toEqual([]);
    expect(sql).not.toHaveBeenCalled();
  });
});
