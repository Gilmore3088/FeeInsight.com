import { describe, expect, it } from "vitest";
import type { sql } from "@/lib/data-store/connection";
import { lessonSyncDetail, readAgentLessons, summarizeLessonSync, syncAgentLessons } from "./lesson-sync";
import type { AgentLesson } from "./lesson-types";

type SqlTag = typeof sql;

interface Row {
  lesson_id: number;
  agent_name: string;
  lesson_name: string;
  description: string;
  evidence_refs: Record<string, unknown> | unknown[];
  superseded_by: number | null;
}

/**
 * A small in-memory stand-in for the four statements the sync runs (readiness, registry, upsert,
 * retire), matched on their text. It keeps rows by (agent_name, lesson_name) like the table's key.
 */
function fakeDb(registry: string[], rows: Row[] = []) {
  const statements: string[] = [];
  let nextId = rows.reduce((max, row) => Math.max(max, row.lesson_id), 0) + 1;
  const db = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    statements.push(text);
    if (text.includes("to_regclass")) return [{ ready: true }];
    if (text.startsWith("SELECT agent_name FROM agent_registry")) {
      return registry.filter((name) => (values[0] as string[]).includes(name)).map((agent_name) => ({ agent_name }));
    }
    if (text.startsWith("INSERT INTO agent_lessons")) {
      const [agent, name, description, refsText] = values as [string, string, string, string];
      const refs = JSON.parse(refsText);
      const existing = rows.find((row) => row.agent_name === agent && row.lesson_name === name);
      if (!existing) {
        rows.push({ lesson_id: nextId++, agent_name: agent, lesson_name: name, description, evidence_refs: refs, superseded_by: null });
        return [{ inserted: true }];
      }
      const changed = existing.description !== description || JSON.stringify(existing.evidence_refs) !== JSON.stringify(refs) || existing.superseded_by !== null;
      if (!changed) return [];
      Object.assign(existing, { description, evidence_refs: refs, superseded_by: null });
      return [{ inserted: false }];
    }
    const repoRows = (keys: string[]) => rows.filter((row) =>
      !Array.isArray(row.evidence_refs) && row.evidence_refs.source === "repo" && row.superseded_by === null
      && !keys.includes(`${row.agent_name}:${row.lesson_name}`));
    if (text.startsWith("UPDATE agent_lessons SET superseded_by = lesson_id")) {
      const retired = repoRows(values[1] as string[]);
      for (const row of retired) row.superseded_by = row.lesson_id;
      return retired.map(({ agent_name, lesson_name }) => ({ agent_name, lesson_name }));
    }
    if (text.startsWith("SELECT agent_name, lesson_name FROM agent_lessons")) {
      return repoRows(values[1] as string[]).map(({ agent_name, lesson_name }) => ({ agent_name, lesson_name }));
    }
    if (text.startsWith("SELECT lesson_name, description, evidence_refs")) {
      return rows.filter((row) => row.agent_name === values[0] && row.superseded_by === null).map((row) => ({ ...row, created_at: new Date("2026-10-20T00:00:00Z") }));
    }
    throw new Error(`unexpected statement: ${text}`);
  }) as unknown as SqlTag;
  return { db, rows, statements };
}

const lesson = (id: string, agent: AgentLesson["agent"] = "knox", text = `Lesson ${id}.`): AgentLesson => ({
  id, agent, stage: "extract", lesson: text, why: `Why ${id}.`,
  evidence: { issues: [Number(id.replace(/\D/g, "")) || 1], prs: [7], files: ["src/lib/agents/knox/rules.ts"] },
  appliesTo: "all", since: "2026-10-19",
});

describe("syncAgentLessons", () => {
  it("inserts new lessons, leaves unchanged ones, updates edited ones and counts each", async () => {
    const { db, rows } = fakeDb(["knox", "darwin"]);
    const first = await syncAgentLessons({ db, lessons: [lesson("issue-1"), lesson("issue-2", "darwin")] });
    expect(first).toMatchObject({ ready: true, inserted: 2, updated: 0, unchanged: 0, superseded: [], perAgent: { knox: 1, darwin: 1 } });
    expect(rows[0].evidence_refs).toMatchObject({ source: "repo", why: "Why issue-1.", issues: [1], prs: [7], since: "2026-10-19" });

    const second = await syncAgentLessons({ db, lessons: [lesson("issue-1", "knox", "Edited."), lesson("issue-2", "darwin")] });
    expect(second).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
    expect(rows[0].description).toBe("Edited.");
  });

  it("marks a lesson removed from the repo as superseded and never deletes it", async () => {
    const { db, rows } = fakeDb(["knox"]);
    await syncAgentLessons({ db, lessons: [lesson("issue-1"), lesson("issue-2")] });
    const result = await syncAgentLessons({ db, lessons: [lesson("issue-1")] });
    expect(result.superseded).toEqual(["knox:issue-2"]);
    expect(rows).toHaveLength(2);
    const retired = rows.find((row) => row.lesson_name === "issue-2")!;
    expect(retired.superseded_by).toBe(retired.lesson_id);

    // Put back in the repo, it is active again.
    const back = await syncAgentLessons({ db, lessons: [lesson("issue-1"), lesson("issue-2")] });
    expect(back).toMatchObject({ updated: 1, unchanged: 1, superseded: [] });
    expect(retired.superseded_by).toBeNull();
  });

  it("never retires a lesson the sync did not write", async () => {
    const legacy: Row = { lesson_id: 50, agent_name: "knox", lesson_name: "old-loop", description: "x", evidence_refs: [], superseded_by: null };
    const { db, rows } = fakeDb(["knox"], [legacy]);
    const result = await syncAgentLessons({ db, lessons: [lesson("issue-1")] });
    expect(result.superseded).toEqual([]);
    expect(rows.find((row) => row.lesson_id === 50)?.superseded_by).toBeNull();
  });

  it("skips and reports lessons whose agent has no agent_registry row", async () => {
    const { db, rows } = fakeDb(["knox"]);
    const result = await syncAgentLessons({ db, lessons: [lesson("issue-1"), lesson("issue-9", "deming")] });
    expect(result.skippedAgents).toEqual([{ agent: "deming", lessons: 1 }]);
    expect(rows.map((row) => row.agent_name)).toEqual(["knox"]);
    expect(summarizeLessonSync(result)).toContain("Skipped 1 for deming");
    expect(lessonSyncDetail(result)).toMatchObject({ inserted: 1, skipped_agents: [{ agent: "deming", lessons: 1 }] });
  });

  it("writes nothing on a dry run", async () => {
    const { db, rows, statements } = fakeDb(["knox"]);
    const result = await syncAgentLessons({ db, dryRun: true, lessons: [lesson("issue-1")] });
    expect(result.dryRun).toBe(true);
    expect(rows).toEqual([]);
    expect(statements.some((text) => /^(INSERT|UPDATE)/.test(text))).toBe(false);
  });

  it("reports a missing table instead of failing", async () => {
    const db = (async () => [{ ready: false }]) as unknown as SqlTag;
    const result = await syncAgentLessons({ db, lessons: [lesson("issue-1")] });
    expect(result.ready).toBe(false);
    expect(summarizeLessonSync(result)).toContain("Skipped the lesson sync");
    expect(await readAgentLessons(db, "knox")).toBeNull();
  });
});

describe("readAgentLessons", () => {
  it("returns the agent's active lessons with why, evidence and since", async () => {
    const { db } = fakeDb(["knox"]);
    await syncAgentLessons({ db, lessons: [lesson("issue-1"), lesson("issue-2")] });
    await syncAgentLessons({ db, lessons: [lesson("issue-1")] });
    const stored = await readAgentLessons(db, "knox");
    expect(stored).toEqual([{
      id: "issue-1", lesson: "Lesson issue-1.", why: "Why issue-1.", stage: "extract", since: "2026-10-19",
      issues: [1], prs: [7], files: ["src/lib/agents/knox/rules.ts"],
    }]);
  });
});
