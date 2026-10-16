# Vercel's preview skip check ran without a git repository and failed every preview

**Found:** 2026-10-16, merging PR #1550 and #1637.

#1634 (merged 04:18 UTC) changed `vercel.json` `ignoreCommand` to skip a preview when the commit
changes no page: `git diff --quiet HEAD^ HEAD -- . ":!docs" ...`. `.vercelignore` listed `.git`,
so Vercel deleted the repository's `.git` files after cloning ("Removed 27 ignored files defined
in .vercelignore: /.git/config, /.git/HEAD, ...") and before running the skip check. `git diff`
then printed "Not a git repository" with its usage text and exited 129. Vercel builds on exit 1
and skips on exit 0; any other exit fails the deployment.

Every preview of a branch carrying #1634 failed this way, starting with #1550 at 364ba952 and
#1637 at 27af846f at about 05:27 UTC on 2026-10-16. Vercel's deployment list also shows failed
previews on other branches in the same window (#1342, page-templates, hamilton-phase4,
1302-leftovers, 982, 1605, 1076, switch-on-1016b); their logs were not each opened. #1598's branch predated #1634, so its preview built.
Production was not affected: the command's first test, `[ "$VERCEL_ENV" != production ]`,
exits 1 there and the build runs.

**Fix:**
- `.vercelignore` no longer lists `.git`, so the skip check runs inside the clone.
- `ignoreCommand` first checks that `HEAD^` exists (`git cat-file -e HEAD^`) and exits 1, meaning
  build, when it doesn't: no repository, or a clone too shallow to have a parent. A missing
  repository now costs one build instead of a failed check.
- Vercel rejects an `ignoreCommand` longer than 256 characters before building, on every
  deployment including production. The first version of this fix used `git rev-parse -q --verify`,
  came to 260 characters and failed its own preview. The command is now 246.
  `src/lib/vercel-config.test.ts` checks the length, and that `.vercelignore` keeps `.git` while the
  command runs git.

Checked locally with the exact command: a docs-only commit exits 0 (skip); a commit that changes
`src/`, a directory with no repository, a `--depth 1` clone and `VERCEL_ENV=production` each exit 1
(build). The PR's Vercel preview is the check on Vercel itself.

Left as #1634 chose: `HEAD^` compares only a push's last commit, so a `src/` commit followed by a
docs commit gets no preview, and `:!src/lib/agents` skips previews for agent code that ships in API
routes.
