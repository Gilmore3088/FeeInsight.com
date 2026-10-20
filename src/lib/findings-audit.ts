import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ALL_AGENT_LESSONS } from "@/lib/agents/learning/lesson-registry";

/**
 * Findings that end in nothing (#1108). A finding in `docs/project/findings/` is closed only when
 * it names what stops a repeat: a `**Guard:**` line (a test, a CI guard, a scorecard alarm or a
 * checklist line) or, when an agent caused it, an `**Agent lesson:** <agent>/<lesson-id>` line
 * naming the lesson in that agent's `role-lessons.ts` (James, 2026-10-20: a lesson for the agent,
 * not only a check). Read-only: it reads the folder and the lesson registry, nothing else.
 *
 * `scripts/ci-guards.sh findings-file-kill` fails a PR that adds or changes a finding without one,
 * or names a lesson id that does not exist. This audit lists the older findings that still name
 * neither, for the Sunday email (#1104).
 */

export const FINDINGS_DIR = "docs/project/findings";

const GUARD_LINE = /^\*\*Guard:\*\*[ \t]*\S/m;
const LESSON_LINE = /^\*\*Agent lesson:\*\*[ \t]*(.*)$/gm;
const LESSON_REF = /^([a-z]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface FindingAudit {
  file: string;
  hasGuard: boolean;
  /** Lesson references that resolve, as `agent/id`. */
  lessons: string[];
  /** References that do not name a real lesson of that agent. */
  unknownLessons: string[];
}

/** Lesson ids by agent, from the lesson registry. */
export function lessonIndex(lessons: ReadonlyArray<{ agent: string; id: string }> = ALL_AGENT_LESSONS): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const lesson of lessons) {
    if (!index.has(lesson.agent)) index.set(lesson.agent, new Set());
    index.get(lesson.agent)!.add(lesson.id);
  }
  return index;
}

/** Pure: what one finding names. */
export function auditFinding(file: string, text: string, lessons: Map<string, Set<string>>): FindingAudit {
  const resolved: string[] = [];
  const unknown: string[] = [];
  for (const match of text.matchAll(LESSON_LINE)) {
    for (const raw of match[1].split(",")) {
      const ref = raw.trim().replace(/^`|`$/g, "");
      if (!ref) continue;
      const parts = LESSON_REF.exec(ref);
      if (parts && lessons.get(parts[1])?.has(parts[2])) resolved.push(ref);
      else unknown.push(ref);
    }
  }
  return { file, hasGuard: GUARD_LINE.test(text), lessons: resolved, unknownLessons: unknown };
}

/** Pure: true when the finding names a guard or a real lesson. */
export function findingIsClosed(audit: FindingAudit): boolean {
  return audit.hasGuard || audit.lessons.length > 0;
}

export interface FindingsAuditReport {
  total: number;
  closed: number;
  /** Findings naming neither a guard nor a real lesson, newest first. */
  open: string[];
  /** Findings naming a lesson id that does not exist. */
  unknownLessons: Array<{ file: string; refs: string[] }>;
}

/** Pure: the report over a set of findings. */
export function summarizeFindings(audits: FindingAudit[]): FindingsAuditReport {
  const open = audits.filter((audit) => !findingIsClosed(audit)).map((audit) => audit.file).sort().reverse();
  return {
    total: audits.length,
    closed: audits.length - open.length,
    open,
    unknownLessons: audits.filter((audit) => audit.unknownLessons.length > 0).map((audit) => ({ file: audit.file, refs: audit.unknownLessons })),
  };
}

/** Reads every finding file (not the README) under `root` and audits it. */
export function readFindingsAudit(root = process.cwd(), lessons = lessonIndex()): FindingsAuditReport {
  const dir = path.join(root, FINDINGS_DIR);
  const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
  return summarizeFindings(files.map((name) => auditFinding(name, readFileSync(path.join(dir, name), "utf8"), lessons)));
}

/** Plain lines for an email: the count and the newest findings still naming nothing. */
export function findingsAuditLines(report: FindingsAuditReport, show = 10): string[] {
  if (report.open.length === 0) return [`Findings: all ${report.total} name their guard or lesson.`];
  const lines = [`Findings without a guard or lesson: ${report.open.length} of ${report.total}.`];
  lines.push(...report.open.slice(0, show).map((file) => `${FINDINGS_DIR}/${file}`));
  if (report.open.length > show) lines.push(`and ${report.open.length - show} older.`);
  return lines;
}
