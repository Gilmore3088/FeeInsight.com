/**
 * The skill manifest standard (Agentic OS PRD 9.2, WP-02). Every repository-local skill in
 * `.claude/skills/<id>/` that carries a `skill.json` declares who owns it, what it reads, what
 * it may reach, whether it calls a model, what it costs, which tests exercise the code it relies
 * on, and when it was last checked. Skills are called by existing agents, never run as agents
 * themselves (PRD 9.2), and the evaluative skills grant no write access (PRD 7.5).
 *
 * `validateSkillManifest` checks the shape of one manifest and returns every problem as a plain
 * sentence; an empty list means the manifest is well formed. Checks that need the file system
 * (paths exist, SKILL.md has its sections) live in `manifest.test.ts`.
 */

export const SKILL_OWNING_AGENTS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton", "growth"] as const;
export type SkillOwningAgent = (typeof SKILL_OWNING_AGENTS)[number];

/** The six evaluative skills the PRD names in 7.5. */
export const PRD_EVALUATION_SKILLS = [
  "fee-evaluation",
  "source-evidence-audit",
  "fee-taxonomy-regression",
  "adversarial-document-testing",
  "report-reconciliation",
  "error-to-test",
] as const;

export interface SkillDataAccess {
  table: string;
  /** Evaluative skills only read. A manifest that asks for "write" is refused here. */
  mode: "read";
}

export interface SkillDependency {
  /** Repo-relative path of a code file the procedure relies on. */
  path: string;
  /** An exported version constant in that file, when the dependency is versioned. */
  version_constant?: string;
}

export interface SkillManifest {
  id: string;
  version: number;
  maintainer: string;
  owning_agent: SkillOwningAgent;
  inputs: string[];
  outputs: string[];
  data_access: SkillDataAccess[];
  external_endpoints: string[];
  provider_inference: false;
  budget: string;
  triggering_workflows: string[];
  evaluation_suite: string[];
  failure_behavior: string;
  approval_requirements: string;
  dependencies: SkillDependency[];
  last_validated: string;
  abstain_when: string[];
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TABLE = /^[a-z_][a-z0-9_]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown, field: string, problems: string[], { allowEmpty }: { allowEmpty: boolean }): void {
  if (!Array.isArray(value)) {
    problems.push(`${field} must be an array of strings`);
    return;
  }
  if (!allowEmpty && value.length === 0) problems.push(`${field} must not be empty`);
  value.forEach((item, index) => {
    if (!nonEmptyString(item)) problems.push(`${field}[${index}] must be a non-empty string`);
  });
}

function relativePath(value: unknown): boolean {
  return nonEmptyString(value) && !value.startsWith("/") && !value.split("/").includes("..");
}

/** Every problem with one parsed `skill.json`; an empty list means it meets the standard. */
export function validateSkillManifest(json: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(json)) return ["manifest must be a JSON object"];
  const m = json;

  if (!nonEmptyString(m.id) || !ID.test(m.id)) problems.push("id must be a kebab-case string");
  if (typeof m.version !== "number" || !Number.isInteger(m.version) || m.version < 1) {
    problems.push("version must be an integer of 1 or more");
  }
  if (!nonEmptyString(m.maintainer)) problems.push("maintainer must be a non-empty string");
  if (!SKILL_OWNING_AGENTS.includes(m.owning_agent as SkillOwningAgent)) {
    problems.push(`owning_agent must be one of ${SKILL_OWNING_AGENTS.join(", ")}`);
  }
  stringList(m.inputs, "inputs", problems, { allowEmpty: false });
  stringList(m.outputs, "outputs", problems, { allowEmpty: false });

  if (!Array.isArray(m.data_access)) {
    problems.push("data_access must be an array of { table, mode }");
  } else {
    m.data_access.forEach((entry, index) => {
      if (!isObject(entry)) {
        problems.push(`data_access[${index}] must be an object`);
        return;
      }
      if (!nonEmptyString(entry.table) || !TABLE.test(entry.table)) {
        problems.push(`data_access[${index}].table must be a table or view name`);
      }
      if (entry.mode !== "read") problems.push(`data_access[${index}].mode must be "read" (skills grant no write access)`);
    });
  }

  stringList(m.external_endpoints, "external_endpoints", problems, { allowEmpty: true });
  if (m.provider_inference !== false) problems.push("provider_inference must be false");
  if (!nonEmptyString(m.budget)) problems.push("budget must be a non-empty string");
  stringList(m.triggering_workflows, "triggering_workflows", problems, { allowEmpty: false });

  stringList(m.evaluation_suite, "evaluation_suite", problems, { allowEmpty: false });
  if (Array.isArray(m.evaluation_suite)) {
    m.evaluation_suite.forEach((item, index) => {
      if (!relativePath(item)) problems.push(`evaluation_suite[${index}] must be a repo-relative path`);
      else if (!/\.test\.tsx?$/.test(item as string)) problems.push(`evaluation_suite[${index}] must be a test file`);
    });
  }

  if (!nonEmptyString(m.failure_behavior)) problems.push("failure_behavior must be a non-empty string");
  if (!nonEmptyString(m.approval_requirements)) problems.push("approval_requirements must be a non-empty string");

  if (!Array.isArray(m.dependencies) || m.dependencies.length === 0) {
    problems.push("dependencies must be a non-empty array of { path, version_constant? }");
  } else {
    m.dependencies.forEach((entry, index) => {
      if (!isObject(entry)) {
        problems.push(`dependencies[${index}] must be an object`);
        return;
      }
      if (!relativePath(entry.path)) problems.push(`dependencies[${index}].path must be a repo-relative path`);
      if (entry.version_constant !== undefined && !(nonEmptyString(entry.version_constant) && /^[A-Z][A-Z0-9_]*$/.test(entry.version_constant))) {
        problems.push(`dependencies[${index}].version_constant must be an UPPER_SNAKE constant name`);
      }
    });
  }

  if (!nonEmptyString(m.last_validated) || !ISO_DATE.test(m.last_validated) || Number.isNaN(Date.parse(m.last_validated))) {
    problems.push("last_validated must be an ISO date (YYYY-MM-DD)");
  }
  stringList(m.abstain_when, "abstain_when", problems, { allowEmpty: false });

  return problems;
}

/** The `name` in a SKILL.md's YAML frontmatter, or null when there is none. */
export function frontmatterName(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return null;
  const line = match[1].split(/\r?\n/).find((row) => /^name:\s*/.test(row));
  return line ? line.replace(/^name:\s*/, "").trim().replace(/^["']|["']$/g, "") : null;
}
