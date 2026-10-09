import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import { frontmatterName, PRD_EVALUATION_SKILLS, validateSkillManifest, type SkillManifest } from "./manifest";

/**
 * The skill manifest gate (PRD WP-02): every `.claude/skills/*\/skill.json` meets the standard,
 * points at code and tests that exist, reads only tables the migrations create, and sits next to
 * a SKILL.md that says when to abstain.
 */

const ROOT = resolve(__dirname, "../../..");
const SKILLS_DIR = join(ROOT, ".claude/skills");
const REQUIRED_SECTIONS = ["Purpose", "When to use", "Inputs", "Procedure", "Output", "When to abstain", "Boundaries"];

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "skill.json")))
  .map((entry) => entry.name)
  .sort();

const manifests = skillDirs.map((dir) => ({
  dir,
  manifest: JSON.parse(readFileSync(join(SKILLS_DIR, dir, "skill.json"), "utf8")) as SkillManifest,
  markdown: existsSync(join(SKILLS_DIR, dir, "SKILL.md")) ? readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf8") : null,
}));

const migrationsDir = join(ROOT, "supabase/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n");

function createdInMigrations(table: string): boolean {
  return new RegExp(`\\b(?:TABLE|VIEW)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`, "i").test(migrationSql);
}

/** Repo paths a SKILL.md cites in backticks (no globs). */
function citedPaths(markdown: string): string[] {
  const paths = new Set<string>();
  for (const match of markdown.matchAll(/`((?:src|Reports|supabase|docs|scripts)\/[^`*\s]+\.(?:ts|tsx|json|sql|md|html|sh))`/g)) {
    paths.add(match[1]);
  }
  return [...paths];
}

describe("validateSkillManifest", () => {
  const good: SkillManifest = {
    id: "example-skill",
    version: 1,
    maintainer: "atlas",
    owning_agent: "atlas",
    inputs: ["a"],
    outputs: ["b"],
    data_access: [{ table: "published_fee_catalog", mode: "read" }],
    external_endpoints: [],
    provider_inference: false,
    budget: "deterministic, no paid calls",
    triggering_workflows: ["manual"],
    evaluation_suite: ["src/lib/x.test.ts"],
    failure_behavior: "report and stop",
    approval_requirements: "none",
    dependencies: [{ path: "src/lib/x.ts", version_constant: "X_VERSION" }],
    last_validated: "2026-10-09",
    abstain_when: ["no data"],
  };

  it("accepts a well-formed manifest", () => {
    expect(validateSkillManifest(good)).toEqual([]);
  });

  it("refuses write access, provider inference and an unknown owner", () => {
    const problems = validateSkillManifest({
      ...good,
      owning_agent: "deming",
      provider_inference: true,
      data_access: [{ table: "published_fee_records", mode: "write" }],
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("owning_agent"),
        "provider_inference must be false",
        expect.stringContaining("data_access[0].mode"),
      ]),
    );
  });

  it("reports missing fields", () => {
    const partial: Partial<SkillManifest> = { ...good };
    delete partial.abstain_when;
    delete partial.evaluation_suite;
    const problems = validateSkillManifest(partial);
    expect(problems.some((problem) => problem.startsWith("abstain_when"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("evaluation_suite"))).toBe(true);
    expect(validateSkillManifest(null)).toEqual(["manifest must be a JSON object"]);
  });

  it("reads the frontmatter name", () => {
    expect(frontmatterName("---\nname: fee-evaluation\ndescription: x\n---\n# T")).toBe("fee-evaluation");
    expect(frontmatterName("# no frontmatter")).toBeNull();
  });
});

describe("repository skill manifests", () => {
  it("include every evaluative skill the PRD names (7.5)", () => {
    const ids = manifests.map((item) => item.manifest.id);
    for (const id of PRD_EVALUATION_SKILLS) expect(ids).toContain(id);
  });

  it.each(manifests.map((item) => [item.dir, item] as const))("%s meets the manifest standard", (dir, { manifest, markdown }) => {
    expect(validateSkillManifest(manifest)).toEqual([]);
    expect(manifest.id).toBe(dir);
    expect(manifest.provider_inference).toBe(false);
    expect(manifest.data_access.every((entry) => entry.mode === "read")).toBe(true);

    for (const entry of manifest.data_access) {
      expect(createdInMigrations(entry.table), `${dir}: table ${entry.table} is not created in supabase/migrations`).toBe(true);
    }
    for (const path of manifest.evaluation_suite) {
      expect(existsSync(join(ROOT, path)), `${dir}: evaluation_suite ${path} does not exist`).toBe(true);
    }
    for (const dependency of manifest.dependencies) {
      const file = join(ROOT, dependency.path);
      expect(existsSync(file), `${dir}: dependency ${dependency.path} does not exist`).toBe(true);
      if (dependency.version_constant) {
        const exported = new RegExp(`export const ${dependency.version_constant}\\b`).test(readFileSync(file, "utf8"));
        expect(exported, `${dir}: ${dependency.path} does not export ${dependency.version_constant}`).toBe(true);
      }
    }

    expect(markdown, `${dir}: SKILL.md is missing`).not.toBeNull();
    const text = markdown as string;
    expect(frontmatterName(text)).toBe(manifest.id);
    for (const section of REQUIRED_SECTIONS) {
      expect(new RegExp(`^##\\s+${section}\\s*$`, "m").test(text), `${dir}: SKILL.md has no "${section}" section`).toBe(true);
    }
    for (const path of citedPaths(text)) {
      expect(existsSync(join(ROOT, path)), `${dir}: SKILL.md cites ${path}, which does not exist`).toBe(true);
    }
  });
});
