import { describe, expect, it, vi } from "vitest";
import type { EnforcementAction } from "@/lib/regulatory/enforcement";
import { runRegistryEnforcement } from "./enforcement";
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

const action = (i: number, overrides: Partial<EnforcementAction> = {}): EnforcementAction => ({
  agency: "OCC",
  source_key: `occ:${i}`,
  party_name: i === 0 ? "Example Bank, N.A." : `Other Bank ${i}`,
  party_city: "Dallas",
  party_state: "TX",
  action_type: "Formal Agreement",
  subject: null,
  start_date: "2024-01-05",
  termination_date: null,
  penalty_amount: null,
  document_url: null,
  ...overrides,
});

describe("registry-enforcement", () => {
  it("loads one agency when the other fails, matches, and records the failure", async () => {
    const { db, statements } = createDb([
      { id: 7, institution_name: "Example Bank, National Association", state_code: "TX", city: "Dallas", holding_company_name: null, active: true },
    ]);
    const occ = Array.from({ length: 600 }, (_, i) => action(i));
    const result = await runRegistryEnforcement({
      db,
      runId: 9,
      fetchers: { OCC: async () => occ, FRB: async () => Promise.reject(new Error("HTTP 403")) },
    });
    expect(result.byAgency.OCC).toEqual({ actions: 600, matched: 1, holdingCompany: 0 });
    expect(result.failed).toEqual(["FRB: HTTP 403"]);
    expect(result.upserted).toBe(600);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    expect(partition.values).toContain("succeeded");
    expect(partition.values).toContain("FRB: HTTP 403");
  });

  it("treats a short file as broken and writes nothing on a dry run", async () => {
    const { db, statements } = createDb([]);
    const result = await runRegistryEnforcement({
      db,
      dryRun: true,
      fetchers: { OCC: async () => [action(1)], FRB: async () => [] },
    });
    expect(result.failed).toHaveLength(2);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });
});
