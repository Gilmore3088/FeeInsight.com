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

// Background gc/maintenance can still be writing into .git when afterEach removes the temp repo
// (ENOTEMPTY in CI run 39326702861), so every git call here, the guard's included, turns it off.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "gc.auto",
  GIT_CONFIG_VALUE_0: "0",
  GIT_CONFIG_KEY_1: "maintenance.auto",
  GIT_CONFIG_VALUE_1: "false",
};
delete env.GITHUB_BASE_REF;

let repo = "";
afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  it("fails a Hamilton lesson that names an internal agent, since it reaches customer answers", () => {
    const leaky = entry("issue-6", "hamilton").replace("Read the per-item price.", "Trust what Knox extracted.");
    const { status, output } = lessonRepo({
      "src/lib/agents/hamilton/role-lessons.ts": file(leaky, entry("issue-7", "hamilton")),
    }, 'import { H } from "@/lib/agents/hamilton/role-lessons";\n');
    expect(status, output).toBe(1);
    expect(output).toContain("a Hamilton lesson names an internal agent");
    expect(output).not.toContain("issue-7");
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

/** findings-file-kill (#1108): a new or changed finding names its guard or a real agent lesson. */
describe("findings-file-kill guard or lesson", () => {
  const FINDINGS = "docs/project/findings";
  const LESSONS = 'export const K = [\n  {\n    id: "issue-2209",\n  },\n];\n';

  function findingsRepo(change: Record<string, string>) {
    repo = mkdtempSync(join(tmpdir(), "findings-guard-"));
    git("init", "-q", "-b", "main");
    write("docs/project/FINDINGS.md", "# Findings\n## 2026-10-01 old\n");
    // The template's example line is not a finding's reference.
    write(`${FINDINGS}/README.md`, "# Findings\n**Agent lesson:** knox/issue-2209 (when an agent caused it)\n");
    write(`${FINDINGS}/2026-10-01-old-unguarded.md`, "# old\n**Lesson:** prose only.\n");
    write("src/lib/agents/knox/role-lessons.ts", LESSONS);
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "-b", "pr");
    for (const [path, text] of Object.entries(change)) write(path, text);
    git("add", "-A");
    git("commit", "-qm", "pr");
    const out = spawnSync("bash", [GUARD, "findings-file-kill"], { cwd: repo, env, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("passes a new finding with a Guard line or a real agent lesson, and only counts old ones", () => {
    const { status, output } = findingsRepo({
      [`${FINDINGS}/2026-10-21-guarded.md`]: "# a\n**Guard:** `src/lib/x.test.ts`\n",
      [`${FINDINGS}/2026-10-21-lesson.md`]: "# b\n**Agent lesson:** knox/issue-2209\n",
    });
    expect(status, output).toBe(0);
    expect(output).toContain("1 older findings name neither");
  });

  it("fails a new finding and a changed old finding that name neither", () => {
    const { status, output } = findingsRepo({
      [`${FINDINGS}/2026-10-21-bare.md`]: "# c\n**Lesson:** prose only.\n",
      [`${FINDINGS}/2026-10-01-old-unguarded.md`]: "# old, edited\n**Lesson:** prose only.\n",
    });
    expect(status, output).toBe(1);
    expect(output).toContain(`${FINDINGS}/2026-10-21-bare.md`);
    expect(output).toContain(`${FINDINGS}/2026-10-01-old-unguarded.md`);
  });

  it("fails an empty agent lesson line and a lesson id that only matches as a pattern", () => {
    const { status, output } = findingsRepo({
      [`${FINDINGS}/2026-10-21-empty.md`]: "# e\n**Agent lesson:**\n",
      [`${FINDINGS}/2026-10-21-dot.md`]: "# f\n**Agent lesson:** knox/issue.2209\n",
    });
    expect(status, output).toBe(1);
    expect(output).toMatch(/2026-10-21-empty\.md|2026-10-21-dot\.md: knox\/issue\.2209/);
  });

  it("fails an agent lesson that does not exist", () => {
    const { status, output } = findingsRepo({
      [`${FINDINGS}/2026-10-21-wrong.md`]: "# d\n**Agent lesson:** darwin/issue-2209, knox/issue-9999\n",
    });
    expect(status, output).toBe(1);
    expect(output).toContain("2026-10-21-wrong.md: darwin/issue-2209");
    expect(output).toContain("2026-10-21-wrong.md: knox/issue-9999");
  });
});

/** lessons-index-kill (DECISIONS 2026-10-20): LESSONS.md has a line per finding and per decision. */
describe("lessons-index-kill", () => {
  const DECISIONS = [
    "# Decisions",
    "",
    "## 2026-10-20",
    "",
    "**One front door.** James, 2026-10-20.",
    "",
    "**Lessons for agents.** James, 2026-10-20: a",
    "**bold** word mid-paragraph is not an entry.",
    "",
    "```",
    "",
    "**Inside a code block** is not an entry.",
    "```",
    "",
    "## 2026-10-05",
    "",
    "**Older.** James.",
    "",
    "## 2026-10-05",
    "",
    "**Same date, second heading.** James.",
    "",
  ].join("\n");
  const INDEX = [
    "# Lessons and decisions",
    "- 2026-10-20 — One front door. — [decision](DECISIONS.md#2026-10-20)",
    "- 2026-10-20 — Lessons for agents. — [decision](DECISIONS.md#2026-10-20)",
    "- 2026-10-05 — Older. — [decision](DECISIONS.md#2026-10-05)",
    "- 2026-10-05 — Same date. — [decision](DECISIONS.md#2026-10-05-1)",
    "- 2026-10-19 — A lesson. — [finding](findings/2026-10-19-a.md) — Guard: `x.test.ts`",
    "",
  ].join("\n");

  function indexRepo(files: Record<string, string | null>) {
    repo = mkdtempSync(join(tmpdir(), "lessons-index-"));
    const all: Record<string, string | null> = {
      "docs/project/DECISIONS.md": DECISIONS,
      "docs/project/LESSONS.md": INDEX,
      "docs/project/findings/README.md": "# Findings\n",
      "docs/project/findings/2026-10-19-a.md": "# a\n**Guard:** `x.test.ts`\n",
      ...files,
    };
    for (const [path, text] of Object.entries(all)) if (text !== null) write(path, text);
    const out = spawnSync("bash", [GUARD, "lessons-index-kill"], { cwd: repo, env, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("passes when every finding and decision entry has a line", () => {
    const { status, output } = indexRepo({});
    expect(status, output).toBe(0);
    expect(output).toContain("lessons-index-kill: OK");
  });

  it("fails a finding with no line and a line for a finding that does not exist", () => {
    const { status, output } = indexRepo({
      "docs/project/findings/2026-10-21-new.md": "# new\n**Guard:** `y.test.ts`\n",
      "docs/project/findings/2026-10-19-a.md": null,
    });
    expect(status, output).toBe(1);
    expect(output).toContain("add a one-line entry");
    expect(output).toContain("finding docs/project/findings/2026-10-21-new.md has no line");
    expect(output).toContain("links findings/2026-10-19-a.md, which does not exist");
  });

  it("fails a new decision entry with no line and a link to a heading that does not exist", () => {
    const { status, output } = indexRepo({
      "docs/project/DECISIONS.md": DECISIONS.replace("## 2026-10-20\n", "## 2026-10-20\n\n**Brand new.** James.\n"),
      "docs/project/LESSONS.md": `${INDEX}- 2026-10-01 — Gone. — [decision](DECISIONS.md#2026-10-01)\n`,
    });
    expect(status, output).toBe(1);
    expect(output).toContain("DECISIONS.md#2026-10-20 has 3 entries but docs/project/LESSONS.md has 2 lines");
    expect(output).toContain("links DECISIONS.md#2026-10-01, which is not a DECISIONS.md heading");
  });
});

/** queue-owner-kill (#1108): a migration's *_queue table has an owner and an alarm in the registry. */
describe("queue-owner-kill", () => {
  function queueRepo(migration: string, registry: string) {
    repo = mkdtempSync(join(tmpdir(), "queue-guard-"));
    write("supabase/migrations/20270101000000_q.sql", migration);
    write("src/lib/agents/queue-registry.ts", registry);
    const out = spawnSync("bash", [GUARD, "queue-owner-kill"], { cwd: repo, env, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("passes a queue table the registry lists", () => {
    const { status, output } = queueRepo("CREATE TABLE IF NOT EXISTS public.label_queue (id bigint);\n", '    tables: ["label_queue", "raw_fee_observations"],\n');
    expect(status, output).toBe(0);
  });

  it("fails a queue table the registry does not list, even when its name appears elsewhere", () => {
    const { status, output } = queueRepo("create table public.label_queue (id bigint);\n", '// label_queue is mentioned but not owned\n    tables: ["other"],\n');
    expect(status, output).toBe(1);
    expect(output).toContain("label_queue");
  });
});

/** migration-lock-kill (2026-10-15-migration-lock-timeout): a migration that locks a busy table sets lock_timeout. */
describe("migration-lock-kill", () => {
  function lockRepo(files: Record<string, string>) {
    repo = mkdtempSync(join(tmpdir(), "lock-guard-"));
    for (const [name, sql] of Object.entries(files)) write(`supabase/migrations/${name}`, sql);
    const out = spawnSync("bash", [GUARD, "migration-lock-kill"], { cwd: repo, env, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("passes a busy-table ALTER that sets lock_timeout, a quiet table, and applied history", () => {
    const { status, output } = lockRepo({
      "20270110000048_old.sql": "ALTER TABLE public.raw_fee_observations ADD COLUMN note text;\n",
      "20270110000072_note.sql": "SET lock_timeout = '10s';\nALTER TABLE public.raw_fee_observations\n  ADD COLUMN extraction_note text;\n",
      "20270110000073_quiet.sql": "ALTER TABLE public.state_expert_notes ADD COLUMN body text;\n-- ALTER TABLE raw_fee_observations in a comment\n",
    });
    expect(status, output).toBe(0);
  });

  it("fails a new ALTER, index, catalog view or trigger on a busy table without lock_timeout", () => {
    const { status, output } = lockRepo({
      "20270110000072_alter.sql": "alter table\n  raw_fee_observations add column extraction_note text;\n",
      "20270110000073_index.sql": "CREATE UNIQUE INDEX dedup_idx\n  ON public.verified_fee_observations (fee_raw_id);\n",
      "20270110000074_view.sql": "CREATE OR REPLACE VIEW public.published_fee_catalog AS SELECT 1;\n",
      "20270110000075_trigger.sql": "CREATE TRIGGER t AFTER INSERT ON public.agent_run_steps FOR EACH ROW EXECUTE FUNCTION f();\n",
      "20270110000076_ok.sql": "SET LOCAL lock_timeout = '5s';\nALTER TABLE institution_sources ADD COLUMN x int;\n",
    });
    expect(status, output).toBe(1);
    for (const name of ["072_alter", "073_index", "074_view", "075_trigger"]) expect(output).toContain(`20270110000${name}.sql`);
    expect(output).not.toContain("076_ok");
  });

  it("fails a policy, ALTER VIEW, TRUNCATE or DROP INDEX on a busy table, quoted names included", () => {
    const { status, output } = lockRepo({
      "20270110000048_old.sql": "CREATE INDEX raw_fee_obs_cat_idx ON public.raw_fee_observations (category);\n",
      "20270110000072_policy.sql": "CREATE POLICY p ON \"public\".\"agent_runs\" FOR SELECT USING (true);\n",
      "20270110000073_alter_policy.sql": "ALTER POLICY p ON ONLY public.source_documents USING (false);\n",
      "20270110000074_alter_view.sql": "ALTER VIEW IF EXISTS published_fee_catalog OWNER TO postgres;\n",
      "20270110000075_truncate.sql": "TRUNCATE TABLE public.state_notes, \"agent_run_events\";\n",
      "20270110000076_drop_index.sql": "DROP INDEX IF EXISTS \"public\".raw_fee_obs_cat_idx;\n",
      "20270110000077_drop_quiet_index.sql": "DROP INDEX IF EXISTS public.state_notes_idx;\n",
    });
    expect(status, output).toBe(1);
    for (const name of ["072_policy", "073_alter_policy", "074_alter_view", "075_truncate", "076_drop_index"]) {
      expect(output).toContain(`20270110000${name}.sql`);
    }
    expect(output).not.toContain("077_drop_quiet_index");
  });

  it("ignores busy tables named only inside a block comment", () => {
    const { status, output } = lockRepo({
      "20270110000072_comment.sql": "/* ALTER TABLE raw_fee_observations\n   ADD COLUMN x int; */\nALTER TABLE public.state_notes ADD COLUMN y int;\n",
    });
    expect(status, output).toBe(0);
  });

  it("fails when lock_timeout is set only after the first locking statement", () => {
    const late = lockRepo({
      "20270110000072_late.sql": "ALTER TABLE raw_fee_observations ADD COLUMN x int;\nSET lock_timeout = '10s';\nALTER TABLE agent_runs ADD COLUMN y int;\n",
    });
    expect(late.status, late.output).toBe(1);
    expect(late.output).toContain("20270110000072_late.sql");
    rmSync(repo, { recursive: true, force: true });
    const early = lockRepo({
      "20270110000072_early.sql": "SET lock_timeout = '10s';\nTRUNCATE agent_run_events;\nALTER VIEW published_fee_catalog OWNER TO postgres;\n",
    });
    expect(early.status, early.output).toBe(0);
  });

  it("fails a foreign key to a busy table or DROP TABLE of one, and reads comments and strings as Postgres does", () => {
    const { status, output } = lockRepo({
      "20270110000072_fk.sql": "CREATE TABLE public.notes (id bigint, run_id bigint REFERENCES public.agent_runs(id));\n",
      "20270110000073_add_fk.sql": "ALTER TABLE public.notes ADD CONSTRAINT notes_doc_fk FOREIGN KEY (doc_id)\n  REFERENCES \"source_documents\" (id);\n",
      "20270110000074_drop.sql": "DROP TABLE IF EXISTS public.old_notes, public.agent_run_events;\n",
      "20270110000075_comment_dash.sql": "/* x -- y */ ALTER TABLE raw_fee_observations ADD COLUMN z int;\n",
      "20270110000076_string_dash.sql": "COMMENT ON TABLE public.notes IS 'a -- b'; ALTER TABLE agent_runs ADD COLUMN z int;\n",
      "20270110000077_quiet.sql": "CREATE TABLE public.notes2 (id bigint REFERENCES public.state_notes(id));\n/* outer /* inner */ ALTER TABLE agent_runs ADD COLUMN q int; */\n",
    });
    expect(status, output).toBe(1);
    for (const name of ["072_fk", "073_add_fk", "074_drop", "075_comment_dash", "076_string_dash"]) {
      expect(output).toContain(`20270110000${name}.sql`);
    }
    expect(output).not.toContain("077_quiet");
  });

  it("counts a top-level SET or set_config to a value above zero, not RESET, zero or a function's SET clause", () => {
    const { status, output } = lockRepo({
      "20270110000072_reset.sql": "RESET lock_timeout;\nALTER TABLE agent_runs ADD COLUMN a int;\n",
      "20270110000073_zero.sql": "SET lock_timeout = 0;\nALTER TABLE agent_runs ADD COLUMN b int;\n",
      "20270110000074_fn_clause.sql": "CREATE FUNCTION f() RETURNS void LANGUAGE sql SET lock_timeout = '5s' AS $$ select 1 $$;\nALTER TABLE agent_runs ADD COLUMN c int;\n",
      "20270110000075_set_config.sql": "SELECT set_config('lock_timeout', '5s', true);\nALTER TABLE agent_runs ADD COLUMN d int;\n",
      "20270110000076_set_to.sql": "BEGIN;\nSET LOCAL lock_timeout TO '10s';\nALTER TABLE agent_runs ADD COLUMN e int;\nCOMMIT;\n",
      "20270110000077_fn_body.sql": "CREATE FUNCTION g() RETURNS void LANGUAGE plpgsql AS $$ begin set lock_timeout = '5s'; end $$;\nALTER TABLE agent_runs ADD COLUMN f int;\n",
      "20270110000078_do_block.sql": "DO $$ BEGIN PERFORM set_config('lock_timeout', '0.5s', true); END $$;\nALTER TABLE agent_runs ADD COLUMN g int;\n",
    });
    expect(status, output).toBe(1);
    for (const name of ["072_reset", "073_zero", "074_fn_clause", "077_fn_body"]) expect(output).toContain(`20270110000${name}.sql`);
    for (const name of ["075_set_config", "076_set_to", "078_do_block"]) expect(output).not.toContain(name);
  });
});

/** migration-claim-kill (#1048): two open PRs must not add the same migration number. */
describe("migration-claim-kill", () => {
  // A stand-in gh on PATH: the open-PR list and each PR's added migrations come from the case.
  function claimRepo(pr: string, open: string[] | null, added: Record<string, string[]>, failing: string[] = []) {
    repo = mkdtempSync(join(tmpdir(), "claim-guard-"));
    const answers = Object.entries(added).map(([n, files]) => `*"pulls/${n}/files"*) printf '%s\\n' ${files.map((f) => `'${f}'`).join(" ")} ;;`);
    write(
      "bin/gh",
      [
        "#!/usr/bin/env bash",
        'case "$*" in',
        open === null ? '  *"pulls?state=open"*) exit 1 ;;' : `  *"pulls?state=open"*) printf '%s\\n' ${open.join(" ")} ;;`,
        ...failing.map((n) => `  *"pulls/${n}/files"*) exit 1 ;;`),
        ...answers.map((line) => `  ${line}`),
        '  *"pulls/"*"/files"*) ;;',
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    execFileSync("chmod", ["+x", join(repo, "bin/gh")]);
    const out = spawnSync("bash", [GUARD, "migration-claim-kill"], {
      cwd: repo,
      env: { ...env, PATH: `${join(repo, "bin")}:${process.env.PATH}`, PR_NUMBER: pr, GITHUB_REPOSITORY: "o/r" },
      encoding: "utf8",
    });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  }

  it("fails when an earlier open PR adds the same number, and names it", () => {
    const { status, output } = claimRepo("20", ["12", "20", "25"], {
      "12": ["supabase/migrations/20270110000080_other.sql"],
      "20": ["supabase/migrations/20270110000080_mine.sql"],
    });
    expect(status, output).toBe(1);
    expect(output).toContain("20270110000080: also added by open PR #12");
  });

  it("passes when only a later PR claims the number, or the numbers differ", () => {
    const later = claimRepo("12", ["12", "20"], {
      "12": ["supabase/migrations/20270110000080_mine.sql"],
      "20": ["supabase/migrations/20270110000080_later.sql"],
    });
    expect(later.status, later.output).toBe(0);
    rmSync(repo, { recursive: true, force: true });
    const differ = claimRepo("20", ["12", "20"], {
      "12": ["supabase/migrations/20270110000080_other.sql"],
      "20": ["supabase/migrations/20270110000081_mine.sql"],
    });
    expect(differ.status, differ.output).toBe(0);
    expect(differ.output).toContain("1 checked");
  });

  it("skips with a note outside a pull request run or when GitHub does not answer", () => {
    repo = mkdtempSync(join(tmpdir(), "claim-guard-"));
    const outside = spawnSync("bash", [GUARD, "migration-claim-kill"], { cwd: repo, env: { ...env, PR_NUMBER: "" }, encoding: "utf8" });
    expect(outside.status).toBe(0);
    expect(outside.stdout).toContain("skipped");
    rmSync(repo, { recursive: true, force: true });
    const failing = claimRepo("20", null, { "20": ["supabase/migrations/20270110000080_mine.sql"] });
    expect(failing.status, failing.output).toBe(0);
    expect(failing.output).toContain("could not list open PRs");
    rmSync(repo, { recursive: true, force: true });
    // PR 11's files call fails (the stand-in has no answer for it): counted as unread, not checked.
    const partial = claimRepo("20", ["11", "12", "20"], {
      "12": ["supabase/migrations/20270110000079_other.sql"],
      "20": ["supabase/migrations/20270110000080_mine.sql"],
    }, ["11"]);
    expect(partial.status, partial.output).toBe(0);
    expect(partial.output).toContain("1 checked; could not read #11");
  });
});
