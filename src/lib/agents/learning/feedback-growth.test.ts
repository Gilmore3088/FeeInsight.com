import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it, vi } from "vitest";

import { FEEDBACK_REPORTERS, FEEDBACK_STAGES, recordFeedback } from "./feedback";

const MIGRATION = readFileSync(
  resolve(__dirname, "../../../../supabase/migrations/20270110000024_pipeline_feedback_growth.sql"),
  "utf-8",
);

/** The quoted values inside the named constraint's `IN (...)` list. */
function checkList(constraint: string): string[] {
  const match = MIGRATION.match(new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`));
  if (!match) throw new Error(`${constraint} not found in the migration`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
}

describe("growth in the shared learning store", () => {
  it("keeps the database checks equal to the code lists", () => {
    expect(checkList("pipeline_feedback_reported_by_check")).toEqual([...FEEDBACK_REPORTERS]);
    expect(checkList("pipeline_feedback_about_stage_check")).toEqual([...FEEDBACK_STAGES]);
    expect(FEEDBACK_REPORTERS).toContain("growth");
    expect(FEEDBACK_STAGES).toContain("marketing");
  });

  it("writes a growth judgement and reads back what was stored", async () => {
    const stored: Array<Record<string, unknown>> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("INSERT INTO pipeline_feedback")) {
        const rows = JSON.parse(String(values[0])) as Array<Record<string, unknown>>;
        stored.push(...rows);
        return Promise.resolve(rows.map((_, index) => ({ id: index + 1 })));
      }
      return Promise.resolve([]);
    });
    const written = await recordFeedback(db as unknown as Parameters<typeof recordFeedback>[0], [
      {
        aboutStage: "marketing",
        aboutStrategy: "content.market_spread",
        signal: "wrong",
        kind: "skipped_by_james",
        reportedBy: "growth",
        checkName: "growth.skip_reason",
        evidence: { draft_id: 12, reason: "Metro too small" },
        dedupeKey: "growth.skip:draft:12",
      },
    ]);
    expect(written).toBe(1);
    expect(stored).toEqual([
      expect.objectContaining({
        about_stage: "marketing",
        reported_by: "growth",
        kind: "skipped_by_james",
        evidence: { draft_id: 12, reason: "Metro too small" },
        dedupe_key: "growth.skip:draft:12",
      }),
    ]);
  });
});
