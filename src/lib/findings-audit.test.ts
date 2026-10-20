import { describe, expect, it } from "vitest";
import { ALL_AGENT_LESSONS } from "@/lib/agents/learning/lesson-registry";
import { auditFinding, findingIsClosed, findingsAuditLines, lessonIndex, readFindingsAudit, summarizeFindings } from "./findings-audit";

const lessons = lessonIndex([{ agent: "knox", id: "issue-2209" }, { agent: "darwin", id: "issue-1052" }]);

describe("findings audit (#1108)", () => {
  it("counts a Guard line as closed", () => {
    const audit = auditFinding("2026-10-21-a.md", "# x\n**Guard:** `src/lib/x.test.ts` pins it.\n", lessons);
    expect(audit.hasGuard).toBe(true);
    expect(findingIsClosed(audit)).toBe(true);
  });

  it("counts a real agent lesson as closed, and only a real one", () => {
    const real = auditFinding("2026-10-21-b.md", "**Agent lesson:** knox/issue-2209, `darwin/issue-1052`\n", lessons);
    expect(real.lessons).toEqual(["knox/issue-2209", "darwin/issue-1052"]);
    expect(findingIsClosed(real)).toBe(true);
    const wrongAgent = auditFinding("2026-10-21-c.md", "**Agent lesson:** darwin/issue-2209\n", lessons);
    expect(wrongAgent.unknownLessons).toEqual(["darwin/issue-2209"]);
    expect(findingIsClosed(wrongAgent)).toBe(false);
  });

  it("does not count the free-text Lesson line, an empty Guard line or a mention in prose", () => {
    const audit = auditFinding("2026-10-21-d.md", "**Lesson:** measure first.\n**Guard:**\nSee **Guard:** below.\n", lessons);
    expect(findingIsClosed(audit)).toBe(false);
  });

  it("lists open findings newest first and words them for an email", () => {
    const report = summarizeFindings([
      auditFinding("2026-10-10-old.md", "nothing", lessons),
      auditFinding("2026-10-12-newer.md", "nothing", lessons),
      auditFinding("2026-10-13-guarded.md", "**Guard:** a test", lessons),
    ]);
    expect(report).toMatchObject({ total: 3, closed: 1, open: ["2026-10-12-newer.md", "2026-10-10-old.md"] });
    expect(findingsAuditLines(report, 1)).toEqual([
      "Findings without a guard or lesson: 2 of 3.",
      "docs/project/findings/2026-10-12-newer.md",
      "and 1 older.",
    ]);
  });

  it("reads the real folder, and every lesson a finding names exists", () => {
    const report = readFindingsAudit(process.cwd(), lessonIndex(ALL_AGENT_LESSONS));
    expect(report.total).toBeGreaterThan(200);
    expect(report.closed + report.open.length).toBe(report.total);
    expect(report.unknownLessons).toEqual([]);
  });
});
