/**
 * Structural tests for migration-backed Hamilton persistence.
 *
 * Runtime modules must not create or alter production schema. The Supabase
 * migration chain owns table definitions, metadata columns, and published
 * report seeds.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));

import { getPublishedReports } from "./pro-tables";

const SOURCE = readFileSync(resolve(__dirname, "pro-tables.ts"), "utf-8");
const BASE_MIGRATION = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20260815083600_hamilton_pro_base_tables.sql"),
  "utf-8",
);
const ARTIFACT_POLICY_MIGRATION = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20260815110200_hamilton_artifact_policy_metadata.sql"),
  "utf-8",
);
const SELECTED_SOURCE_MIGRATION = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20270101000000_hamilton_selected_source_labels.sql"),
  "utf-8",
);
const PUBLISHED_REPORT_SEED_MIGRATION = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20270101010000_hamilton_published_report_seeds.sql"),
  "utf-8",
);

describe("Hamilton runtime persistence", () => {
  it("exports query helpers without runtime schema bootstrapping", () => {
    expect(typeof getPublishedReports).toBe("function");
    expect(SOURCE).not.toContain("ensureHamiltonProTables");
    expect(SOURCE).not.toMatch(/\bCREATE TABLE\b/i);
    expect(SOURCE).not.toMatch(/\bALTER TABLE\b/i);
    expect(SOURCE).not.toMatch(/\bCREATE INDEX\b/i);
    expect(SOURCE).not.toMatch(/\bENABLE ROW LEVEL SECURITY\b/i);
    expect(SOURCE).not.toMatch(/\bREVOKE\b/i);
  });
});

describe("Hamilton schema migrations", () => {
  it("create the expected base tables", () => {
    const tables = [
      "hamilton_saved_analyses",
      "hamilton_scenarios",
      "hamilton_reports",
      "hamilton_watchlists",
      "hamilton_signals",
      "hamilton_priority_alerts",
    ];

    for (const table of tables) {
      expect(BASE_MIGRATION).toContain(`public.${table}`);
    }
  });

  it("keeps report and scenario artifacts evidence-policy aware", () => {
    expect(ARTIFACT_POLICY_MIGRATION).toContain("ALTER TABLE public.hamilton_reports");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("ALTER TABLE public.hamilton_scenarios");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("evidence_policy TEXT NOT NULL DEFAULT 'provisional-first'");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("evidence_policy TEXT NOT NULL DEFAULT 'verified-only'");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("peer_baseline_source TEXT");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("selected_fee_delta_count INTEGER NOT NULL DEFAULT 0");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("idx_hamilton_report_policy_baseline");
    expect(ARTIFACT_POLICY_MIGRATION).toContain("idx_hamilton_scenario_policy_baseline");
  });

  it("persists selected institution source labels on reports, scenarios, and watchlists", () => {
    expect(SELECTED_SOURCE_MIGRATION).toContain("ALTER TABLE public.hamilton_reports");
    expect(SELECTED_SOURCE_MIGRATION).toContain("ALTER TABLE public.hamilton_scenarios");
    expect(SELECTED_SOURCE_MIGRATION).toContain("ALTER TABLE public.hamilton_watchlists");
    expect(SELECTED_SOURCE_MIGRATION).toContain("selected_source TEXT NOT NULL DEFAULT 'manual'");
    expect(SELECTED_SOURCE_MIGRATION).toContain("selected_source TEXT NOT NULL DEFAULT 'watchlist'");
    expect(SELECTED_SOURCE_MIGRATION).toContain("hamilton_reports_selected_source_check");
    expect(SELECTED_SOURCE_MIGRATION).toContain("hamilton_scenarios_selected_source_check");
    expect(SELECTED_SOURCE_MIGRATION).toContain("hamilton_watchlists_selected_source_check");
  });

  it("seeds BFI-authored published reports through an idempotent forward migration", () => {
    expect(PUBLISHED_REPORT_SEED_MIGRATION).toContain("INSERT INTO public.hamilton_reports");
    expect(PUBLISHED_REPORT_SEED_MIGRATION).toContain("ON CONFLICT (id) DO UPDATE");
    expect(PUBLISHED_REPORT_SEED_MIGRATION).toContain("'00000000-0000-4000-8000-000000000001'");
    expect(PUBLISHED_REPORT_SEED_MIGRATION).toContain("'00000000-0000-4000-8000-000000000004'");
    expect(PUBLISHED_REPORT_SEED_MIGRATION).toContain("'BFI authored publication'");
    expect(PUBLISHED_REPORT_SEED_MIGRATION).toContain("'published'");
  });
});
