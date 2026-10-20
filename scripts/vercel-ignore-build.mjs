// Vercel's ignored build step (vercel.json "ignoreCommand"): exit 0 skips the build, exit 1
// builds. Any other exit fails the deployment, so every error path here exits 1 instead.
//
// 2026-10-20-preview-build-queue-from-merge-main-pushes: diffing HEAD^..HEAD built a full
// preview on every "merge main" push and skipped an empty retry after a failed build. A preview
// now builds only when the PR's own change against main ships code, and something that ships
// changed since the branch's last successful deployment (VERCEL_GIT_PREVIOUS_SHA).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NOT_SHIPPED_DIRS = ["docs/", "supabase/", "src/lib/agents/", "scripts/", ".github/", ".claude/", "handoff/"];
const NOT_SHIPPED_SUFFIXES = [".md", ".test.ts", ".test.tsx"];
const MAIN_REF = "refs/remotes/origin/main";
const MAIN_FETCH_DEPTH = 200;
const DEEPEN_STEPS = [200, 2000];
const GIT_TIMEOUT_MS = 60_000;

/** Whether a changed path can change what the preview serves. */
export function isShippedPath(path) {
  if (NOT_SHIPPED_DIRS.some((dir) => path.startsWith(dir))) return false;
  return !NOT_SHIPPED_SUFFIXES.some((suffix) => path.endsWith(suffix));
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
  if (!prFiles.some(isShippedPath)) {
    return { build: false, reason: "the PR changes nothing that ships compared with main" };
  }
  if (sinceLastDeployFiles === null) {
    return { build: true, reason: "no readable successful deployment for this branch; building" };
  }
  const shipped = sinceLastDeployFiles.filter(isShippedPath);
  if (shipped.length === 0) {
    return { build: false, reason: "nothing that ships changed since the last successful deployment" };
  }
  return { build: true, reason: `${shipped.length} shipped file(s) changed since the last successful deployment` };
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

function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  let decision;
  if (vercelEnv === "production" || git("rev-parse", "--verify", "-q", "HEAD") === null) {
    decision = decideBuild({ vercelEnv, prFiles: vercelEnv === "production" ? [] : null, sinceLastDeployFiles: null });
  } else {
    const base = findMergeBase();
    const prFiles = base ? changedFiles(base) : null;
    const sinceLastDeployFiles = prFiles?.some(isShippedPath) ? filesSinceLastDeploy(process.env.VERCEL_GIT_PREVIOUS_SHA) : null;
    decision = decideBuild({ vercelEnv, prFiles, sinceLastDeployFiles });
  }
  process.stdout.write(`vercel-ignore-build: ${decision.build ? "build" : "skip"} (${decision.reason})\n`);
  process.exit(decision.build ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`vercel-ignore-build: build (check failed: ${error instanceof Error ? error.message : error})\n`);
    process.exit(1);
  }
}
