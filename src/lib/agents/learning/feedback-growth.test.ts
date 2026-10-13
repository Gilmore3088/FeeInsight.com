import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it, vi } from "vitest";

import { FEEDBACK_REPORTERS, FEEDBACK_STAGES, recordFeedback } from "./feedback";

const MIGRATIONS_DIR = resolve(__dirname, "../../../../supabase/migrations");

/** The quoted values in the named constraint's `IN (...)` list, as the newest migration that sets it leaves it. */
function checkList(constraint: string): string[] {
  let latest: string[] | null = null;
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    const match = text.match(new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`));
    if (match) latest = [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
  }
  if (!latest) throw new Error(`${constraint} not found in any migration`);
  return latest;
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
