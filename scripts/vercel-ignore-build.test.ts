import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideBuild, isShippedPath } from "./vercel-ignore-build.mjs";

/**
 * 2026-10-20-preview-build-queue-from-merge-main-pushes: the old ignoreCommand diffed HEAD^..HEAD,
 * so a "merge main" push built a full preview and an empty retry after a failed build was
 * skipped (and showed as a pass). The skip now depends on the PR's own change against its
 * merge-base with main and on what changed since the branch's last successful deployment.
 */
describe("isShippedPath", () => {
  it("treats docs, tests, agent code, scripts and tooling folders as not shipped", () => {
    for (const path of [
      "docs/project/findings/2026-10-20-x.md",
      "README.md",
      "src/app/(public)/about/notes.md",
      "src/lib/fees.test.ts",
      "src/components/x.test.tsx",
      "src/lib/agents/knox/read.ts",
      "scripts/ci-guards.sh",
      "supabase/migrations/20270101000000_x.sql",
      ".github/workflows/ci.yml",
      ".claude/settings.json",
      "handoff/notes.txt",
    ]) {
      expect(isShippedPath(path), path).toBe(false);
    }
  });

  it("treats pages, libraries, config and vercel.json as shipped", () => {
    for (const path of ["src/app/(public)/about/page.tsx", "src/lib/fees.ts", "package.json", "vercel.json", "docsite/x.ts"]) {
      expect(isShippedPath(path), path).toBe(true);
    }
  });
});

describe("decideBuild", () => {
  const page = "src/app/(public)/about/page.tsx";
  const doc = "docs/x.md";

  it("always builds production, even for a docs-only change", () => {
    expect(decideBuild({ vercelEnv: "production", prFiles: [doc], sinceLastDeployFiles: [] }).build).toBe(true);
  });

  it("builds when the merge-base with main could not be found", () => {
    expect(decideBuild({ vercelEnv: "preview", prFiles: null, sinceLastDeployFiles: [] }).build).toBe(true);
  });

  it("skips a preview whose PR changes nothing that ships, even right after merging main", () => {
    // A merge-main push into a docs-only PR: main's new pages are in HEAD^..HEAD but not in the PR.
    expect(decideBuild({ vercelEnv: "preview", prFiles: [doc, "src/lib/x.test.ts"], sinceLastDeployFiles: null }).build).toBe(false);
    expect(decideBuild({ vercelEnv: "preview", prFiles: [], sinceLastDeployFiles: null }).build).toBe(false);
  });

  it("builds a PR that ships code when the branch has no successful deployment yet", () => {
    // VERCEL_GIT_PREVIOUS_SHA is unset (first push, or every earlier build failed).
    expect(decideBuild({ vercelEnv: "preview", prFiles: [page], sinceLastDeployFiles: null }).build).toBe(true);
  });

  it("builds an empty retry commit when the previous real build failed", () => {
    // PR #1779: the failed build's commit is after the last successful deployment, so its page
    // change is still in the diff from that deployment.
    expect(decideBuild({ vercelEnv: "preview", prFiles: [page], sinceLastDeployFiles: [page] }).build).toBe(true);
  });

  it("skips a push that changes only docs or tests since the last successful deployment", () => {
    expect(decideBuild({ vercelEnv: "preview", prFiles: [page, doc], sinceLastDeployFiles: [doc] }).build).toBe(false);
    expect(decideBuild({ vercelEnv: "preview", prFiles: [page], sinceLastDeployFiles: [] }).build).toBe(false);
  });

  it("builds a page PR when a push brings shipped code, from the branch or from main", () => {
    expect(decideBuild({ vercelEnv: "preview", prFiles: [page], sinceLastDeployFiles: [doc, "src/lib/fees.ts"] }).build).toBe(true);
  });

  it("explains every decision", () => {
    expect(decideBuild({ vercelEnv: "preview", prFiles: [doc], sinceLastDeployFiles: null }).reason).toMatch(/main/);
  });
});

/** The script end to end in throwaway repos: exit 0 skips the build, exit 1 builds. */
describe("vercel-ignore-build.mjs", () => {
  const SCRIPT = resolve("scripts/vercel-ignore-build.mjs");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "gc.auto",
    GIT_CONFIG_VALUE_0: "0",
    GIT_CONFIG_KEY_1: "maintenance.auto",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "protocol.file.allow",
    GIT_CONFIG_VALUE_2: "always",
  };
  delete env.VERCEL_GIT_PREVIOUS_SHA;
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    dir = "";
  });

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      env,
    })
      .toString()
      .trim();
  }

  function commit(cwd: string, path: string): string {
    mkdirSync(join(cwd, dirname(path)), { recursive: true });
    writeFileSync(join(cwd, path), `${path} ${Math.random()}\n`);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-qm", path);
    return git(cwd, "rev-parse", "HEAD");
  }

  /** origin has main with a page; the branch starts from it. Returns the working repo. */
  function setup(): { origin: string; work: string } {
    dir = mkdtempSync(join(tmpdir(), "vercel-ignore-build-"));
    const origin = join(dir, "origin");
    mkdirSync(origin);
    git(origin, "init", "-q", "-b", "main");
    commit(origin, "src/app/page.tsx");
    const work = join(dir, "work");
    git(dir, "clone", "-q", origin, work);
    git(work, "checkout", "-q", "-b", "feature");
    return { origin, work };
  }

  /** Clone the branch tip the way Vercel does (shallow, single branch) and run the script. */
  function runInVercelClone(work: string, vars: Record<string, string>): string {
    git(work, "push", "-q", "origin", "feature");
    const clone = join(dir, `vercel-${Math.random().toString(36).slice(2)}`);
    git(dir, "clone", "-q", "--depth", "2", "--single-branch", "--branch", "feature", `file://${join(dir, "origin")}`, clone);
    const run = spawnSync("node", [SCRIPT], { cwd: clone, env: { ...env, ...vars }, encoding: "utf8" });
    return `${run.status} ${run.stdout}`;
  }

  it("skips a merge-main push into a docs-only PR, though main's merge brings pages", () => {
    const { origin, work } = setup();
    commit(work, "docs/a.md");
    commit(origin, "src/app/(public)/new/page.tsx");
    git(work, "pull", "-q", "--no-rebase", "--no-edit", "origin", "main");
    expect(runInVercelClone(work, { VERCEL_ENV: "preview" })).toMatch(/^0 .*changes nothing that ships/);
  });

  it("builds an empty retry commit after a page commit whose build failed", () => {
    const { work } = setup();
    const lastGood = commit(work, "src/lib/fees.ts");
    commit(work, "src/app/(public)/about/page.tsx");
    git(work, "commit", "-q", "--allow-empty", "-m", "retry");
    expect(runInVercelClone(work, { VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: lastGood })).toMatch(
      /^1 .*1 shipped file\(s\) changed since the last successful deployment/,
    );
  });

  it("skips a docs commit pushed after a successful page build", () => {
    const { work } = setup();
    const lastGood = commit(work, "src/app/(public)/about/page.tsx");
    commit(work, "docs/b.md");
    expect(runInVercelClone(work, { VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: lastGood })).toMatch(
      /^0 .*nothing that ships changed since the last successful deployment/,
    );
  });

  it("builds a page PR whose branch has no successful deployment", () => {
    const { work } = setup();
    commit(work, "src/app/(public)/about/page.tsx");
    expect(runInVercelClone(work, { VERCEL_ENV: "preview" })).toMatch(/^1 .*no readable successful deployment/);
  });

  it("always builds production", () => {
    const { work } = setup();
    commit(work, "docs/a.md");
    expect(runInVercelClone(work, { VERCEL_ENV: "production" })).toMatch(/^1 .*production always builds/);
  });

  it("builds when there is no git repository", () => {
    dir = mkdtempSync(join(tmpdir(), "vercel-ignore-build-"));
    expect(spawnSync("node", [SCRIPT], { cwd: dir, env: { ...env, VERCEL_ENV: "preview" } }).status).toBe(1);
  });
});
