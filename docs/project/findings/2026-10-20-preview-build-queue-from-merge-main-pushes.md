# 2026-10-20: "merge main" pushes queued full preview builds

Whether a preview builds should depend on the PR's own change against its merge-base, not on the last commit.

**What happened:** `vercel.json`'s `ignoreCommand` diffs only `HEAD^..HEAD`. On a "merge main"
push that diff holds all of `main`'s new work, so every such push builds a full preview. On Oct 20
about 20 deployments in an hour (`vercel ls feeschedule-hub`, 06:53 UTC) queued a 4-minute build for about 7 minutes (that list: created 11 minutes earlier, build duration 4 minutes). One preview failed
prerendering `/sitemap.xml` on a database timeout.

**Cause:** `HEAD^` of a merge commit is the branch's previous tip, so the diff includes everything
merged from `main`. Draft PRs build too. The sitemap is prerendered at build time and reads the
database, so a busy database fails the build.

The same rule skipped an empty retry commit as "no changes". Vercel marks a skipped build
"Ignored" and GitHub shows the Vercel check as passing, so PR #1779's failed preview looked green
after a retry (Oct 20).

**Fix:** `ignoreCommand` runs `scripts/vercel-ignore-build.mjs`. Production always builds. A
preview is skipped only when the PR's own change against its merge-base with `origin/main` ships
nothing (docs, tests, agent code, scripts, tooling), or when nothing that ships changed since
`VERCEL_GIT_PREVIOUS_SHA`, the branch's last successful deployment. A failed build is not a
successful deployment, so an empty retry after it still sees the failed commit's change and builds.
Vercel clones one branch shallowly: the script fetches `main` and deepens until it finds the
merge-base, and builds when it cannot (no remote access, no repository, any error). A merge-main
push into a PR that changes pages still builds, since the preview has to show main's new code.
Draft PRs still build: Vercel's ignore step has no draft flag and no GitHub token; that stays on
#1048. The sitemap was moved to on-request rendering in #2480.

**Lesson:** Merge `main` into a branch only when CLAUDE.md says to (a conflict, a dependency, a
new migration); each merge push into a PR that ships code costs a full preview build.

**Guard:** `scripts/vercel-ignore-build.test.ts:181` (a merge-main push into a docs-only PR skips;
`:189` an empty retry after a failed page build builds; `:214` production always builds)
