# Vercel's preview skip check ran without a git repository and failed every preview

**Found:** 2026-10-16, merging PR #1550 and #1637.

#1634 (merged 04:18 UTC) changed `vercel.json` `ignoreCommand` to skip a preview when the commit
changes no page: `git diff --quiet HEAD^ HEAD -- . ":!docs" ...`. `.vercelignore` listed `.git`,
so Vercel deleted the repository's `.git` files after cloning ("Removed 27 ignored files defined
in .vercelignore: /.git/config, /.git/HEAD, ...") and before running the skip check. `git diff`
then printed "Not a git repository" with its usage text and exited 129. Vercel builds on exit 1
and skips on exit 0; any other exit fails the deployment.

Every preview of a branch carrying #1634 failed this way, at about 05:27 UTC on 2026-10-16
(#1550 at 364ba952, #1637 at 27af846f). #1598's branch predated #1634, so its preview built.
Production was not affected: the command's first test, `[ "$VERCEL_ENV" != production ]`,
exits 1 there and the build runs.

**Fix:**
- `.vercelignore` no longer lists `.git`, so the skip check runs inside the clone.
- `ignoreCommand` first checks that `HEAD^` exists (`git rev-parse -q --verify HEAD^`) and exits 1,
  meaning build, when it doesn't: no repository, or a clone too shallow to have a parent. A missing
  repository now costs one build instead of a failed check.

Checked locally with the exact command: a docs-only commit exits 0 (skip), a commit that changes
`src/` exits 1 (build), a directory with no repository exits 1 (build), and `VERCEL_ENV=production`
exits 1 (build).
