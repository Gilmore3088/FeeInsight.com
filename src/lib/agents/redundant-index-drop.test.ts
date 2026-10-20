import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20270110000076_drop_redundant_indexes.sql",
);

// DB review LOW-2 (2026-10-20): each dropped index is covered by the index that stays.
const DROPPED_TO_COVERING: Record<string, string> = {
  idx_fed_indicators_series: "fed_economic_indicators_series_id_observation_date_key",
  institution_analysis_results_institution_type_idx:
    "institution_analysis_results_institution_type_key",
  idx_research_articles_slug: "research_articles_slug_key",
  idx_articles_slug: "articles_slug_key",
  institution_branch_deposits_cert_year_idx:
    "institution_branch_deposits_cert_year_branch_number_key",
  historical_fee_observation_archive_institution_review_idx:
    "historical_fee_observation_archive_institution_status_idx",
  idx_hamilton_refresh_jobs_signal: "hamilton_refresh_jobs_source_signal_id_job_type_key",
  institution_complaint_records_institution_idx:
    "institution_complaint_records_inst_period_product_issue_key",
  institution_network_memberships_network_asof_idx:
    "institution_network_memberships_network_as_of_listed_key_key",
  nic_relationships_parent_idx: "nic_relationships_key",
};

const sql = readFileSync(MIGRATION, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.trim().startsWith("--"));

describe("redundant index drop migration", () => {
  it("sets lock_timeout before any drop", () => {
    expect(statements[0]).toBe("SET lock_timeout = '5s';");
  });

  it("drops exactly the ten reviewed indexes, each with IF EXISTS", () => {
    const dropped = statements
      .filter((line) => line.startsWith("DROP INDEX"))
      .map((line) => line.match(/^DROP INDEX IF EXISTS public\.(\w+);$/)?.[1]);
    expect(dropped.sort()).toEqual(Object.keys(DROPPED_TO_COVERING).sort());
  });

  it("never drops a covering index or changes data", () => {
    for (const covering of Object.values(DROPPED_TO_COVERING)) {
      expect(sql).not.toMatch(new RegExp(`DROP INDEX[^;]*\\b${covering}\\b`));
    }
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER TABLE|DROP TABLE)\b/i);
  });
});
