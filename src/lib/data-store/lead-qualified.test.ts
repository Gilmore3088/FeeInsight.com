import { describe, expect, it, vi } from "vitest";

import type { sql } from "./connection";
import { qualifiedFieldsOf } from "@/lib/admin-queries";
import { leadQualifiedReady, listQualifiedLeads, setLeadQualified } from "./lead-qualified";

type Db = typeof sql;

function fakeDb(options: { columns?: number; updated?: number; rows?: Array<Record<string, unknown>> } = {}) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("information_schema.columns")) return Promise.resolve([{ n: options.columns ?? 2 }]);
    if (query.includes("UPDATE leads")) return Promise.resolve(Array.from({ length: options.updated ?? 1 }, (_, i) => ({ id: i + 1 })));
    if (query.includes("FROM leads")) return Promise.resolve(options.rows ?? []);
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, calls };
}

describe("lead qualified flag", () => {
  it("is ready only when both columns exist", async () => {
    expect(await leadQualifiedReady(fakeDb().db)).toBe(true);
    expect(await leadQualifiedReady(fakeDb({ columns: 1 }).db)).toBe(false);
  });

  it("records who marked a lead and when, keeping the first mark", async () => {
    const { db, calls } = fakeDb();
    expect(await setLeadQualified(7, true, "james", db)).toBe(true);
    expect(calls[0].query).toContain("qualified_at = now(), qualified_by = ?");
    expect(calls[0].query).toContain("qualified_at IS NULL");
    expect(calls[0].values).toEqual(["james", 7]);
    expect(await setLeadQualified(7, true, "james", fakeDb({ updated: 0 }).db)).toBe(false);
  });

  it("clears the mark", async () => {
    const { db, calls } = fakeDb();
    expect(await setLeadQualified(7, false, "james", db)).toBe(true);
    expect(calls[0].query).toContain("qualified_at = NULL, qualified_by = NULL");
  });

  it("lists qualified leads, and nothing before the migration", async () => {
    const rows = [{ id: 3, institution_id: "12", qualified_at: "2026-10-09T15:00:00Z" }, { id: 4, institution_id: null, qualified_at: "2026-10-09T16:00:00Z" }];
    expect(await listQualifiedLeads(new Date("2026-10-12T00:00:00Z"), fakeDb({ rows }).db)).toEqual([
      { leadId: 3, institutionId: 12, at: "2026-10-09T15:00:00.000Z" },
      { leadId: 4, institutionId: null, at: "2026-10-09T16:00:00.000Z" },
    ]);
    const before = fakeDb({ columns: 0, rows });
    expect(await listQualifiedLeads(new Date(), before.db)).toEqual([]);
    expect(before.calls.some((call) => call.query.includes("FROM leads"))).toBe(false);
  });

  it("reads the mark from a lead row's JSON, before and after the migration", () => {
    expect(qualifiedFieldsOf({ id: 1 })).toEqual({ qualified_at: null, qualified_by: null, qualified_columns: false });
    expect(qualifiedFieldsOf({ qualified_at: "2026-10-09T15:00:00+00:00", qualified_by: "james" })).toEqual({
      qualified_at: "2026-10-09T15:00:00+00:00",
      qualified_by: "james",
      qualified_columns: true,
    });
  });
});
