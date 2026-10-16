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
