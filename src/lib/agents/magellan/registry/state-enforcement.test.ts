import { describe, expect, it, vi } from "vitest";
import { runRegistryStateEnforcement } from "./state-enforcement";
import type { RegistryDb } from "./partitions";

function createDb(candidates: unknown[]) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) return Promise.resolve(candidates);
    if (text.includes("INSERT INTO institution_enforcement_actions")) {
      const payload = JSON.parse(String(values[0])) as unknown[];
      return Promise.resolve(payload.map((_, i) => ({ id: i })));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const TABLE = `<table><tr><th>Bank</th><th>Action</th><th>Date</th></tr>
  <tr><td>Lamont Bank of St. John</td><td>Consent Order</td><td>01/10/2025</td></tr>
  <tr><td>Connect Community Bank</td><td>Consent Order</td><td>05/13/2026</td></tr></table>`;

describe("registry-state-enforcement", () => {
  it("reads each state on its own, skips missing year pages, matches in-state banks and records what each state found", async () => {
    const { db, statements } = createDb([
      { id: 31, institution_name: "Lamont Bank of St. John", state_code: "WA", city: "St. John", holding_company_name: null, active: true },
    ]);
    const pages: Record<string, string | null> = { "https://wa.example/orders": TABLE, "https://il.example/2026": null };
    const result = await runRegistryStateEnforcement({
      db,
      runId: 4,
      today: new Date("2026-10-07T00:00:00Z"),
      sources: [
        { state: "WA", reader: "table", urls: () => ["https://wa.example/orders"] },
        { state: "IL", reader: "table", urls: () => ["https://il.example/2026"] },
        { state: "NY", reader: "links", urls: () => ["https://ny.example/orders"] },
      ],
      fetchPage: async (url) => {
        if (url in pages) return pages[url];
        throw new Error("HTTP 403");
      },
    });
    expect(result.byState.map((s) => [s.state, s.pages, s.missing, s.orders, s.matched, s.failed.length])).toEqual([
      ["WA", 1, 0, 2, 1, 0],
      ["IL", 0, 1, 0, 0, 0],
      ["NY", 0, 0, 0, 0, 1],
    ]);
    expect(result.upserted).toBe(2);
    const insert = statements.find((s) => s.text.includes("INSERT INTO institution_enforcement_actions"))!;
    const rows = JSON.parse(String(insert.values[0])) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ agency: "STATE_WA", institution_id: 31, party_state: "WA", start_date: "2025-01-10", agent_run_id: 4 });
    expect(rows[1]).toMatchObject({ institution_id: null, party_name: "Connect Community Bank" });
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    expect(partition.values).toContain("succeeded");
    expect(partition.values).toContain("No page read for NY");
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb([]);
    await runRegistryStateEnforcement({ db, dryRun: true, sources: [{ state: "WA", reader: "table", urls: () => ["u"] }], fetchPage: async () => TABLE });
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });
});
