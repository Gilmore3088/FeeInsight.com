import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * bayes-manifest-kill's local base (#1434, #1586): a branch cut before main bumped a version
 * passes, a branch that changes a version with no manifest entry fails, and with no merge base
 * the guard says it fell back to origin/main. Each case builds a throwaway repo, so it needs no
 * history from this clone (CI checks out shallow).
 */
const GUARD = resolve("scripts/ci-guards.sh");
const VERSION_FILE = "src/lib/agents/darwin/selftest-version.ts";
const MANIFESTS = "src/lib/agents/bayes/manifests.ts";

const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
delete env.GITHUB_BASE_REF;

let repo = "";
afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = "";
});

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
}

function write(path: string, text: string) {
  mkdirSync(join(repo, dirname(path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** A repo whose fake main bumps SELFTEST_VERSION 1 -> 2 with a manifest entry, on a branch `base`. */
function fakeRepo() {
  repo = mkdtempSync(join(tmpdir(), "bayes-guard-"));
  git("init", "-q", "-b", "base");
  write(VERSION_FILE, "export const SELFTEST_VERSION = 1;\n");
  write(MANIFESTS, "// manifests\n");
  write("src/lib/agents/registry-scheduler.ts", "// registry parser versions\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "fakemain");
  write(VERSION_FILE, "export const SELFTEST_VERSION = 2;\n");
  write(MANIFESTS, "// manifests\n// SELFTEST_VERSION\n");
  git("commit", "-qam", "bump");
  git("update-ref", "refs/remotes/origin/main", "fakemain");
}

function runGuard() {
  const out = spawnSync("bash", [GUARD, "bayes-manifest-kill"], { cwd: repo, env, encoding: "utf8" });
  return { status: out.status, output: `${out.stdout}${out.stderr}` };
}

describe("bayes-manifest-kill local base", () => {
  it("passes a branch cut before main bumped a version", () => {
    fakeRepo();
    git("checkout", "-q", "-b", "behind", "base");
    const { status, output } = runGuard();
    expect(output).not.toContain("note: no merge base");
    expect(status, output).toBe(0);
  });

  it("fails a branch that changes a version with no manifest entry", () => {
    fakeRepo();
    git("checkout", "-q", "-b", "real", "base");
    write(VERSION_FILE, "export const SELFTEST_VERSION = 3;\n");
    git("commit", "-qam", "real");
    const { status, output } = runGuard();
    expect(status, output).toBe(1);
    expect(output).toContain("SELFTEST_VERSION");
  });

  it("says when it has no merge base and compares with origin/main instead", () => {
    fakeRepo();
    git("checkout", "-q", "--orphan", "unrelated");
    git("commit", "-qm", "unrelated history");
    const { output } = runGuard();
    expect(output).toContain("note: no merge base with origin/main");
  });
});

/** runtime-ddl-kill (#2234): request code never creates schema; tests may. */
describe("runtime-ddl-kill", () => {
  function ddlRepo(files: Record<string, string>) {
    repo = mkdtempSync(join(tmpdir(), "ddl-guard-"));
    git("init", "-q", "-b", "main");
    for (const [path, text] of Object.entries(files)) write(path, text);
    git("add", "-A");
    git("commit", "-qm", "files");
    const out = spawnSync("bash", [GUARD, "runtime-ddl-kill"], { cwd: repo, env, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("fails a helper that creates a table or index at request time", () => {
    const { status, output } = ddlRepo({
      "src/lib/news.ts": "await sql`CREATE TABLE IF NOT EXISTS reg_articles (guid TEXT)`;\n",
      "src/app/research/page.tsx": "await sql`create unique index if not exists idx_x on t(a)`;\n",
    });
    expect(status, output).toBe(1);
    expect(output).toContain("src/lib/news.ts");
    expect(output).toContain("src/app/research/page.tsx");
  });

  it.each([
    "aLtEr TaBlE t ADD COLUMN a int",
    "DROP INDEX idx_t",
    "CREATE TEMPORARY TABLE t (a int)",
    "CREATE OR REPLACE VIEW v AS SELECT 1",
    "CREATE MATERIALIZED VIEW v AS SELECT 1",
    "CREATE FUNCTION f() RETURNS int AS 1",
  ])("rejects runtime schema writes with portable identifier boundaries: %s", (ddl) => {
    const { status, output } = ddlRepo({ "src/lib/runtime.ts": `await sql\`${ddl}\`;\n` });
    expect(status, output).toBe(1);
    expect(output).toContain("src/lib/runtime.ts");
  });

  it("recognizes statement boundaries at the start and end of a line", () => {
    const { status, output } = ddlRepo({ "src/lib/runtime.ts": "CREATE TABLE\n" });
    expect(status, output).toBe(1);
    expect(output).toContain("src/lib/runtime.ts");
  });

  it("does not interpret identifier prefixes or suffixes as SQL statements", () => {
    const { status, output } = ddlRepo({
      "src/lib/runtime.ts": [
        'export const a = "recreate table";',
        'export const b = "_CREATE TABLE";',
        'export const c = "CREATE TABLE_ROWS";',
        'export const d = "create indexed";',
      ].join("\n"),
    });
    expect(status, output).toBe(0);
  });

  it("passes tests that build throwaway tables and comments that name DDL", () => {
    const { status, output } = ddlRepo({
      "src/lib/news.db.test.ts": "await sql`CREATE TEMP TABLE t (a int)`;\n",
      "src/lib/news.ts": "// reg_articles comes from a migration; never CREATE TABLE here.\nexport const x = 1;\n",
    });
    expect(status, output).toBe(0);
  });
});

/** lesson-kill (DECISIONS 2026-10-20): every agent's role lessons are complete, its own and unique. */
describe("lesson-kill", () => {
  const REGISTRY = "src/lib/agents/learning/lesson-registry.ts";
  const entry = (id: string, agent: string, since = "2026-10-19") => [
    "  {",
    `    id: "${id}",`,
    `    agent: "${agent}",`,
    '    stage: "extract",',
    '    lesson: "Read the per-item price.",',
    '    why: "Totals were read as prices.",',
    "    evidence: { issues: [1], prs: [], files: [] },",
    '    appliesTo: "all",',
    `    since: "${since}",`,
    "  },",
  ].join("\n");
  const file = (...entries: string[]) => `export const LESSONS = [\n${entries.join("\n")}\n];\n`;

  function lessonRepo(files: Record<string, string>, registry = 'import { K } from "@/lib/agents/knox/role-lessons";\nimport { D } from "@/lib/agents/darwin/role-lessons";\n') {
    repo = mkdtempSync(join(tmpdir(), "lesson-guard-"));
    write(REGISTRY, registry);
    for (const [path, text] of Object.entries(files)) write(path, text);
    const out = spawnSync("bash", [GUARD, "lesson-kill"], { cwd: repo, env, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("passes complete lessons with unique ids", () => {
    const { status, output } = lessonRepo({
      "src/lib/agents/knox/role-lessons.ts": file(entry("issue-1", "knox"), entry("issue-2", "knox")),
      "src/lib/agents/darwin/role-lessons.ts": file(entry("issue-3", "darwin")),
    });
    expect(status, output).toBe(0);
    expect(output).toContain("3 role lessons in 2 agent files");
  });

  it("fails a reused id, another agent's lesson, a missing field and a bad date", () => {
    const missingWhy = entry("issue-4", "knox").replace(/\n {4}why: .*,/, "");
    const { status, output } = lessonRepo({
      "src/lib/agents/knox/role-lessons.ts": file(entry("issue-1", "knox"), entry("issue-2", "darwin"), missingWhy, entry("issue-5", "knox", "Oct 19")),
      "src/lib/agents/darwin/role-lessons.ts": file(entry("issue-1", "darwin")),
    });
    expect(status, output).toBe(1);
    expect(output).toContain("lesson ids used more than once: issue-1");
    expect(output).toContain('names another agent (agent: "darwin",)');
    expect(output).toContain("4 lessons but 3 'why:' fields");
    expect(output).toContain('since: "Oct 19"');
  });

  it("fails an agent file the registry does not import, and a folder that is not a pipeline agent", () => {
    const { status, output } = lessonRepo({
      "src/lib/agents/knox/role-lessons.ts": file(entry("issue-1", "knox")),
      "src/lib/agents/growth/role-lessons.ts": file(entry("Issue_2", "growth")),
    }, 'import { K } from "@/lib/agents/knox/role-lessons";\n');
    expect(status, output).toBe(1);
    expect(output).toContain("growth is not a pipeline agent");
    expect(output).toContain("src/lib/agents/growth/role-lessons.ts: not imported");
    expect(output).toContain("lesson id 'Issue_2'");
  });
});
