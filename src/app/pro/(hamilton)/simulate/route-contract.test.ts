// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(resolve(root, "src/app/pro/(hamilton)/simulate/page.tsx"), "utf8");
describe("current simulation route after legacy UI retirement", () => {
  it("keeps the memo-based interface and current calculation engine", () => {
    expect(page).toContain("<MemoPage>");
    expect(page).toContain("@/lib/hamilton/fee-scenario");
    expect(page).not.toContain("@/components/hamilton/simulate");
    expect(existsSync(resolve(root, "src/components/hamilton/simulate/SimulateWorkspace.tsx"))).toBe(false);
  });
  it("preserves both saved-scenario URL aliases and user-scoped lookup", () => {
    expect(page).toContain("params.scenario_id || params.scenario");
    expect(page).toContain("getHamiltonScenarioById(scenarioId, user.id)");
    expect(page).toContain("saved?.institution_id");
    expect(page).toContain("saved?.fee_category");
  });
  it("retains the scenario API and answer-key validation", () => {
    expect(existsSync(resolve(root, "src/app/api/hamilton/simulate/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "src/lib/agents/knox/answer-key-gate.ts"))).toBe(true);
  });
  it("keeps historical payment SQL outside active application source", () => {
    expect(existsSync(resolve(root, "src/lib/data-store/migrations/001-payments.sql"))).toBe(false);
    const archived = readFileSync(resolve(root, "docs/archive/legacy-payment-schema/001-payments.sql"), "utf8");
    expect(archived).toContain("datetime('now')");
    expect(existsSync(resolve(root, "supabase/migrations/20270110000039_lead_report_refund.sql"))).toBe(true);
  });
});
