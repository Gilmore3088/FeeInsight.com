import { describe, expect, it, vi } from "vitest";

import type { ContentDraft } from "@/lib/data-store/content-drafts";
import { lessonsBrief, lessonsLine, recentLessons, recordSkipLesson, skipLessonKey, withdrawSkipLesson } from "./lessons";

type Db = Parameters<typeof recentLessons>[0];

const DRAFT: ContentDraft = {
  id: 12,
  agent: "murrow",
  kind: "linkedin_post",
  workflow: "w1-market-spread",
  channel: "linkedin",
  subjectKey: "overdraft:Tampa",
  title: "Overdraft in Tampa: $0 to $36",
  caption: "text",
  facts: {},
  asOf: "2026-10-04T00:00:00.000Z",
  status: "skipped",
  agentRunId: 88,
  reviewedBy: "james",
  reviewedAt: null,
  postedAt: null,
  createdAt: "2026-10-04T13:37:00.000Z",
  skipReason: "Metro too small for a LinkedIn audience",
  prUrl: null,
  score: null,
  scoredAt: null,
};

function fakeDb(lessonRows: Record<string, unknown>[] = []) {
  const stored: Array<Record<string, unknown>> = [];
  const queries: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("INSERT INTO pipeline_feedback")) {
      const rows = JSON.parse(String(values[0])) as Array<Record<string, unknown>>;
      stored.push(...rows);
      return Promise.resolve(rows.map((_, index) => ({ id: index + 1 })));
    }
    if (query.includes("SELECT evidence, updated_at")) return Promise.resolve(lessonRows);
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, stored, queries };
}

describe("skip reasons become lessons", () => {
  it("writes a growth judgement about the marketing stage, keyed to the drafting agent", async () => {
    const { db, stored } = fakeDb();
    expect(await recordSkipLesson(db, DRAFT, "  Metro too small for a LinkedIn audience ")).toBe(1);
    expect(stored).toEqual([
      expect.objectContaining({
        about_stage: "marketing",
        about_strategy: "murrow",
        reported_by: "growth",
        signal: "wrong",
        kind: "skipped_by_james",
        check_name: "growth.skip_reason",
        agent_run_id: 88,
        dedupe_key: "growth.skip:draft:12",
        evidence: {
          draft_id: 12,
          agent: "murrow",
          kind: "linkedin_post",
          workflow: "w1-market-spread",
          subject_key: "overdraft:Tampa",
          title: "Overdraft in Tampa: $0 to $36",
          reason: "Metro too small for a LinkedIn audience",
        },
      }),
    ]);
    // No reviewer identity is stored with the lesson.
    expect(JSON.stringify(stored)).not.toContain("reviewer");
    expect(JSON.stringify(stored)).not.toContain('"james"');
  });

  it("writes nothing for a skip without a reason", async () => {
    const { db, stored, queries } = fakeDb();
    expect(await recordSkipLesson(db, DRAFT, "   ")).toBe(0);
    expect(stored).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it("withdraws the lesson when the draft goes back to review", async () => {
    const { db, queries } = fakeDb();
    await withdrawSkipLesson(db, 12);
    const update = queries.find((entry) => entry.query.includes("UPDATE pipeline_feedback"));
    expect(update?.query).toContain("SET signal = 'restored'");
    expect(update?.values).toEqual([skipLessonKey(12)]);
  });

  it("reads an agent's standing lessons for its next brief", async () => {
    const { db, queries } = fakeDb([
      { evidence: { draft_id: 12, agent: "murrow", kind: "linkedin_post", workflow: "w1-market-spread", title: "Overdraft in Tampa", reason: "Metro too small" }, updated_at: new Date("2026-10-05T09:00:00Z") },
    ]);
    const lessons = await recentLessons(db, "murrow");
    expect(lessons).toEqual([
      { draftId: 12, agent: "murrow", kind: "linkedin_post", workflow: "w1-market-spread", title: "Overdraft in Tampa", reason: "Metro too small", at: "2026-10-05T09:00:00.000Z" },
    ]);
    const read = queries.find((entry) => entry.query.includes("SELECT evidence, updated_at"))!;
    expect(read.query).toContain("signal = 'wrong'");
    expect(read.values).toEqual(["murrow", "skipped_by_james", 90, 10]);
    expect(lessonsLine(lessons)).toBe("Read 1 lesson from a skipped draft.");
    expect(lessonsBrief(lessons)).toEqual(['- "Overdraft in Tampa" skipped: Metro too small']);
    expect(lessonsLine([])).toBe("");
  });
});
