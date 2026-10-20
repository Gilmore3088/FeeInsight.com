import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    ignoreCommand?: string;
    crons?: { path: string; schedule: string }[];
  };

  // Vercel rejects a longer ignoreCommand before building, production included (#1647).
  it("keeps ignoreCommand within Vercel's 256-character limit", () => {
    expect(config.ignoreCommand?.length ?? 0).toBeLessThanOrEqual(256);
  });

  // The skip check runs git, so Vercel must not strip .git from the clone first (#1647).
  it("does not drop .git from the build source while ignoreCommand runs git", () => {
    if (!config.ignoreCommand?.includes("git ")) return;
    const ignored = readFileSync(join(root, ".vercelignore"), "utf8")
      .split("\n")
      .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""));
    expect(ignored).not.toContain(".git");
  });

  // 2026-10-17-vercel-usage-agents-tick: the agents tick fills each slot it is given, so it is
  // most of the team's function time. Every 10 minutes halves that bill; every 5 doubled it.
  it("runs the agents tick every 10 minutes, no more often", () => {
    const tick = config.crons?.filter((cron) => cron.path === "/api/admin/agents/tick") ?? [];
    expect(tick).toEqual([{ path: "/api/admin/agents/tick", schedule: "*/10 * * * *" }]);
  });
});

/**
 * 2026-10-09-vercel-preview-build-queue: a preview for every push to every branch held up
 * Vercel's build queue (253 previews in 13 hours, 41-minute median). The ignoreCommand runs here
 * in a throwaway repo: exit 0 skips the build, anything else builds.
 */
describe("vercel.json ignoreCommand", () => {
  const { ignoreCommand = "" } = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { ignoreCommand?: string };
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
  let repo = "";
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    repo = "";
  });

  function git(...args: string[]) {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo, env });
  }

  function commit(path: string) {
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), `${path} ${Math.random()}\n`);
    git("add", "-A");
    git("commit", "-qm", path);
  }

  /** The exit code of ignoreCommand after a commit that changes `path`: 0 skips, 1 builds. */
  function exitAfter(path: string, vercelEnv: "preview" | "production"): number | null {
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    repo = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
    git("init", "-q", "-b", "main");
    commit("src/app/page.tsx");
    commit(path);
    return spawnSync("sh", ["-c", ignoreCommand], { cwd: repo, env: { ...env, VERCEL_ENV: vercelEnv } }).status;
  }

  it("skips a preview whose push changes only docs or tests", () => {
    expect(exitAfter("docs/project/findings/2026-10-09-x.md", "preview")).toBe(0);
    expect(exitAfter("src/lib/fees.test.ts", "preview")).toBe(0);
  });

  it("builds a preview whose push changes a page", () => {
    expect(exitAfter("src/app/(public)/about/page.tsx", "preview")).toBe(1);
  });

  it("always builds production", () => {
    expect(exitAfter("docs/project/findings/2026-10-09-x.md", "production")).toBe(1);
  });
});
