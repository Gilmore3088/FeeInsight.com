import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_AGENT_LESSONS } from "./lesson-registry";
import {
  lessonAgentForStep,
  lessonsFor,
  lessonsForModel,
  lessonsForStep,
  lessonsPromptBlock,
  PROMPT_LESSON_LIMIT,
} from "./lesson-reader";
import { LESSON_AGENTS, type AgentLesson } from "./lesson-types";

function lesson(id: string, since: string, overrides: Partial<AgentLesson> = {}): AgentLesson {
  return {
    id, agent: "knox", stage: "extract", lesson: `Lesson ${id}.`, why: "Because.",
    evidence: { issues: [1], prs: [], files: [] }, appliesTo: "all", since, ...overrides,
  };
}

describe("lessonsFor", () => {
  const lessons = [
    lesson("issue-1", "2026-10-01"),
    lesson("issue-3", "2026-10-03", { appliesTo: ["extract-paid"] }),
    lesson("issue-2", "2026-10-02", { agent: "darwin" }),
  ];

  it("returns the agent's lessons for the step, newest first", () => {
    expect(lessonsFor("knox", "extract-paid", lessons).map((l) => l.id)).toEqual(["issue-3", "issue-1"]);
  });

  it("leaves out lessons scoped to other steps and other agents", () => {
    expect(lessonsFor("knox", "extract", lessons).map((l) => l.id)).toEqual(["issue-1"]);
    expect(lessonsFor("darwin", "verify", lessons).map((l) => l.id)).toEqual(["issue-2"]);
    expect(lessonsFor("growth", "growth-score", lessons)).toEqual([]);
  });
});

describe("lessonAgentForStep", () => {
  it("charges each step to the agent whose role it is", () => {
    expect(lessonAgentForStep("atlas", "deming-regression")).toBe("deming");
    expect(lessonAgentForStep("hamilton", "publish")).toBe("gutenberg");
    expect(lessonAgentForStep("magellan", "registry-cfpb")).toBe("hoovie");
    expect(lessonAgentForStep("knox", "extract")).toBe("knox");
    expect(lessonAgentForStep("atlas", "atlas-lesson-sync")).toBe("atlas");
    expect(lessonAgentForStep("growth", "growth-score")).toBeNull();
  });

  it("reads a step's lessons through that agent", () => {
    expect(lessonsForStep("magellan", "registry-cfpb").every((l) => l.agent === "hoovie")).toBe(true);
  });
});

describe("lessonsPromptBlock", () => {
  it("is empty without lessons, so the request is unchanged", () => {
    expect(lessonsPromptBlock([])).toBe("");
    expect(lessonsForModel("knox", "extract-paid", [])).toEqual({ lessonIds: [] });
  });

  it("carries at most ten lessons, newest first, each with its id", () => {
    const many = Array.from({ length: 14 }, (_, i) => lesson(`issue-${100 + i}`, `2026-10-${String(i + 1).padStart(2, "0")}`));
    const block = lessonsPromptBlock(many);
    expect(block).toContain("LESSONS FOR YOUR ROLE");
    const lines = block.split("\n").filter((line) => line.startsWith("- ["));
    expect(lines).toHaveLength(PROMPT_LESSON_LIMIT);
    expect(lines[0]).toBe("- [issue-113] Lesson issue-113.");
    expect(block).not.toContain("issue-103]");
    const model = lessonsForModel("knox", "extract-paid", many);
    expect(model.lessonIds).toHaveLength(PROMPT_LESSON_LIMIT);
    expect(model.lessonIds[0]).toBe("issue-113");
    expect(model.system).toBe(block);
  });

  it("puts the real Knox lessons into the paid extraction's instructions", () => {
    const model = lessonsForModel("knox", "extract-paid");
    // The newest PROMPT_LESSON_LIMIT lessons go in, so pin none by id: an added lesson pushes the oldest out.
    expect(model.lessonIds.length).toBeGreaterThan(0);
    for (const id of model.lessonIds) expect(model.system).toContain(`[${id}]`);
    expect(model.lessonIds).toContain("issue-2286");
    expect(lessonsForModel("knox", "extract").lessonIds).not.toContain("issue-2286");
  });
});

describe("the lesson registry", () => {
  it("has unique ids, valid agents and every field filled", () => {
    const ids = ALL_AGENT_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of ALL_AGENT_LESSONS) {
      expect(LESSON_AGENTS).toContain(l.agent);
      expect(l.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(l.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(l.lesson.trim().length, l.id).toBeGreaterThan(20);
      expect(l.why.trim().length, l.id).toBeGreaterThan(20);
      expect(l.evidence.issues.length + l.evidence.prs.length, l.id).toBeGreaterThan(0);
      for (const file of l.evidence.files) expect(existsSync(file), `${l.id}: ${file}`).toBe(true);
    }
  });
});
