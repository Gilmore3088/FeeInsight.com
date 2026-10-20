import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { PIPELINE_QUEUES, QUEUE_GROWTH_WINDOW_DAYS, queueEntryProblems, type PipelineQueue } from "./queue-registry";
import { LESSON_AGENTS } from "./learning/lesson-types";

describe("pipeline queue registry (#1108)", () => {
  it("names the piles the 2026-10-12 reviews found", () => {
    const keys = PIPELINE_QUEUES.map((queue) => queue.key);
    expect(keys).toEqual(expect.arrayContaining(["knox_held_lines", "darwin_undecided", "darwin_held_for_review", "hidden_by_fee_minimum"]));
  });

  it("gives every pile a pipeline owner, limits, a way out and one read-only query", () => {
    expect(new Set(PIPELINE_QUEUES.map((queue) => queue.key)).size).toBe(PIPELINE_QUEUES.length);
    for (const queue of PIPELINE_QUEUES) {
      expect(LESSON_AGENTS).toContain(queue.owner);
      expect(queueEntryProblems(queue), queue.key).toEqual([]);
      expect(queue.growthWindowDays).toBe(QUEUE_GROWTH_WINDOW_DAYS);
    }
  });

  it("rejects a query that writes, runs two statements or misses its columns", () => {
    const base: PipelineQueue = { ...PIPELINE_QUEUES[0], key: "fixture", tables: ["fixture_queue"] };
    expect(queueEntryProblems({ ...base, sql: "UPDATE fixture_queue SET x = 1 RETURNING 1 AS size, now() AS oldest" }))
      .toEqual(expect.arrayContaining(["sql must be one SELECT (or WITH ... SELECT)"]));
    expect(queueEntryProblems({ ...base, sql: "WITH d AS (DELETE FROM fixture_queue RETURNING 1) SELECT COUNT(*) AS size, NULL AS oldest FROM d" }).join(" "))
      .toContain("read-only");
    expect(queueEntryProblems({ ...base, sql: "SELECT 1 AS size, NULL AS oldest FROM fixture_queue; SELECT 2" }).join(" "))
      .toContain("one statement");
    expect(queueEntryProblems({ ...base, sql: "SELECT COUNT(*) FROM fixture_queue" }).join(" ")).toContain("size and oldest");
    expect(queueEntryProblems({ ...base, sql: "SELECT COUNT(*) AS size, NULL AS oldest FROM other_table" }).join(" "))
      .toContain("listed table fixture_queue");
    // A quoted flag is data: 'superseded_by_reread' must not read as a write.
    expect(queueEntryProblems({ ...base, sql: "SELECT COUNT(*) AS size, NULL AS oldest FROM fixture_queue WHERE f <> 'delete me'" })).toEqual([]);
  });

  it("lists every *_queue table the migrations create (what queue-owner-kill checks)", () => {
    const dir = "supabase/migrations";
    const created = new Set<string>();
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      for (const match of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+_queue)"?/gi)) created.add(match[1].toLowerCase());
    }
    const listed = new Set(PIPELINE_QUEUES.flatMap((queue) => queue.tables));
    expect([...created].filter((table) => !listed.has(table))).toEqual([]);
  });
});
