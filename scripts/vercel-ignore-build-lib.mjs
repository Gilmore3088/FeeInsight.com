// The decision behind Vercel's ignored build step. scripts/vercel-ignore-build.mjs is the entry
// point vercel.json runs; this module has no side effects so tests can import it.
// Exit 0 skips the build, exit 1 builds; any other exit fails the deployment.
//
// 2026-10-20-preview-build-queue-from-merge-main-pushes: diffing HEAD^..HEAD built a full
// preview on every "merge main" push and skipped an empty retry after a failed build. A preview
// now builds only when the PR's own change against main is visible, and something visible
// changed since the branch's last successful deployment (VERCEL_GIT_PREVIOUS_SHA).
//
// James, 2026-10-20 (DECISIONS.md): previews are for PRs that change what someone sees. The
// allowlist below is the only list of visible paths; everything else skips the preview, and a
// build failure there surfaces at the production deploy, which keeps the last good version.
import { spawnSync } from "node:child_process";

const VISIBLE_DIRS = ["src/app/", "src/components/", "public/"];
const VISIBLE_SUFFIXES = [".css", ".scss"];
const VISIBLE_ROOT_FILES = ["package.json", "package-lock.json", "vercel.json"];
const VISIBLE_ROOT_CONFIG = /^(next|tailwind|postcss)\.config\.[a-z]+$/;
const NEVER_VISIBLE_SUFFIXES = [".md", ".test.ts", ".test.tsx"];
const MAIN_REF = "refs/remotes/origin/main";
const MAIN_FETCH_DEPTH = 200;
const DEEPEN_STEPS = [200, 2000];
const GIT_TIMEOUT_MS = 60_000;

/** Whether a changed path can change what a visitor sees on the preview. */
export function isVisiblePath(path) {
  if (NEVER_VISIBLE_SUFFIXES.some((suffix) => path.endsWith(suffix))) return false;
  if (VISIBLE_DIRS.some((dir) => path.startsWith(dir))) return true;
  if (VISIBLE_SUFFIXES.some((suffix) => path.endsWith(suffix))) return true;
  return VISIBLE_ROOT_FILES.includes(path) || VISIBLE_ROOT_CONFIG.test(path);
}

/**
 * @param {{ vercelEnv: string | undefined, prFiles: string[] | null, sinceLastDeployFiles: string[] | null }} input
 *   prFiles: paths changed between the merge-base with main and HEAD (null when unknown).
 *   sinceLastDeployFiles: paths changed since the branch's last successful deployment (null when
 *   there is none, or its commit could not be read).
 * @returns {{ build: boolean, reason: string }}
 */
export function decideBuild({ vercelEnv, prFiles, sinceLastDeployFiles }) {
  if (vercelEnv === "production") return { build: true, reason: "production always builds" };
  if (prFiles === null) return { build: true, reason: "merge-base with main not found; building to be safe" };
  if (!prFiles.some(isVisiblePath)) {
    return { build: false, reason: "the PR changes nothing visible compared with main" };
  }
  if (sinceLastDeployFiles === null) {
    return { build: true, reason: "no readable successful deployment for this branch; building" };
  }
  const visible = sinceLastDeployFiles.filter(isVisiblePath);
  if (visible.length === 0) {
    return { build: false, reason: "nothing visible changed since the last successful deployment" };
  }
  return { build: true, reason: `${visible.length} visible file(s) changed since the last successful deployment` };
}

function git(...args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function changedFiles(from) {
  const out = git("diff", "--name-only", "--no-renames", from, "HEAD");
  return out === null ? null : out.split("\n").filter(Boolean);
}

function isShallow() {
  return git("rev-parse", "--is-shallow-repository") === "true";
}

/** Vercel clones one branch shallowly, so fetch main and deepen until a merge-base appears. */
function findMergeBase() {
  const depth = isShallow() ? [`--depth=${MAIN_FETCH_DEPTH}`] : [];
  git("fetch", "-q", "--no-tags", ...depth, "origin", `+refs/heads/main:${MAIN_REF}`);
  if (git("rev-parse", "-q", "--verify", MAIN_REF) === null) return null;
  for (const deepen of [0, ...DEEPEN_STEPS]) {
    if (deepen > 0) {
      if (!isShallow()) return null;
      git("fetch", "-q", "--no-tags", `--deepen=${deepen}`, "origin");
      git("fetch", "-q", "--no-tags", `--deepen=${deepen}`, "origin", `+refs/heads/main:${MAIN_REF}`);
    }
    const base = git("merge-base", MAIN_REF, "HEAD");
    if (base) return base;
  }
  return null;
}

function hasCommit(sha) {
  return git("cat-file", "-e", `${sha}^{commit}`) !== null;
}

/** VERCEL_GIT_PREVIOUS_SHA is the branch's last successful deployment; failed builds are not. */
function filesSinceLastDeploy(previousSha) {
  if (!previousSha || !/^[0-9a-f]{7,40}$/i.test(previousSha)) return null;
  if (!hasCommit(previousSha)) git("fetch", "-q", "--no-tags", "--depth=1", "origin", previousSha);
  return hasCommit(previousSha) ? changedFiles(previousSha) : null;
}

/** Reads the clone Vercel checked out and decides whether this deployment builds. */
export function decideFromRepo() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || git("rev-parse", "--verify", "-q", "HEAD") === null) {
    return decideBuild({ vercelEnv, prFiles: vercelEnv === "production" ? [] : null, sinceLastDeployFiles: null });
  }
  const base = findMergeBase();
  const prFiles = base ? changedFiles(base) : null;
  const sinceLastDeployFiles = prFiles?.some(isVisiblePath) ? filesSinceLastDeploy(process.env.VERCEL_GIT_PREVIOUS_SHA) : null;
  return decideBuild({ vercelEnv, prFiles, sinceLastDeployFiles });
}

/**
 * 2026-10-20-vercel-skip-check-fails-open: exit 0 skips the build, production included, so it
 * is returned only for a decision whose `build` is literally false. A throw, a missing decision
 * or anything else exits 1 and builds.
 * @param {() => unknown} decide
 * @param {(line: string) => void} [log]
 * @returns {0 | 1}
 */
export function exitCodeFor(decide, log = () => {}) {
  try {
    const decision = /** @type {{ build?: unknown, reason?: unknown } | null | undefined} */ (decide());
    if (decision?.build === false) {
      log(`vercel-ignore-build: skip (${decision.reason})\n`);
      return 0;
    }
    log(`vercel-ignore-build: build (${decision?.reason ?? "no decision returned; building to be safe"})\n`);
    return 1;
  } catch (error) {
    log(`vercel-ignore-build: build (check failed: ${error instanceof Error ? error.message : error})\n`);
    return 1;
  }
}
