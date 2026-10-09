import { describe, expect, it, vi } from "vitest";
import { getAgentQuality, scheduleProblems } from "./agent-quality";

vi.mock("./connection", () => ({ sql: vi.fn() }));

/** A tagged-template fake that answers by the first table a query names. */
function fakeDb(answers: Record<string, unknown[] | Error>) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    const key = Object.keys(answers).find((name) => text.includes(name));
    const answer = key ? answers[key] : [];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }) as never;
}

describe("scheduleProblems", () => {
  it("keeps missed, failed and unknown schedules and drops the rest", () => {
    const problems = scheduleProblems({
      schedules: [
        { path: "/a", schedule: "0 * * * *", state: "ran" },
        { path: "/b", schedule: "0 * * * *", state: "missed", lastDueAt: "2026-10-09T09:00:00.000Z", lastCallAt: null },
        { path: "/c", schedule: "0 * * * *", state: "failed", lastCallAt: "2026-10-09T09:00:05.000Z" },
        { path: "/d", schedule: "0 * * * *", state: "unknown" },
        { path: "/e", schedule: "0 0 1 1 *", state: "not_due" },
      ],
    });
    expect(problems.map((row) => `${row.path}:${row.state}`)).toEqual(["/b:missed", "/c:failed", "/d:unknown"]);
  });

  it("reads a detail without schedules as no problems", () => {
    expect(scheduleProblems({})).toEqual([]);
  });
});

describe("getAgentQuality", () => {
  it("marks an unreadable section unknown without hiding the others", async () => {
    const quality = await getAgentQuality(fakeDb({
      eval_cases: [{ dataset: "regression", status: "active", count: "12" }],
      replay_jobs: new Error("relation does not exist"),
      agent_run_steps: new Error("timeout"),
      pipeline_feedback: [{ canonical_fee_key: "overdraft", check_name: "hamilton.source_check", count: 4 }],
    }));
    expect(quality.evalCases).toEqual([{ dataset: "regression", status: "active", count: 12 }]);
    expect(quality.replayJobs).toBeNull();
    expect(quality.deming).toBeUndefined();
    expect(quality.schedules).toBeUndefined();
    expect(quality.repeatedErrors).toEqual([{ category: "overdraft", checkName: "hamilton.source_check", count: 4 }]);
  });

  it("tells a step that never ran apart from one that could not be read", async () => {
    const quality = await getAgentQuality(fakeDb({ agent_run_steps: [] }));
    expect(quality.bayes).toBeNull();
  });
});
