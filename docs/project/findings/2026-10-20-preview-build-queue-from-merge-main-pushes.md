# 2026-10-20: "merge main" pushes queued full preview builds

Whether a preview builds should depend on the PR's own change against its merge-base, not on the last commit.

**What happened:** `vercel.json`'s `ignoreCommand` diffs only `HEAD^..HEAD`. On a "merge main"
push that diff holds all of `main`'s new work, so every such push builds a full preview. On Oct 20
about 20 deployments in an hour (`vercel ls feeschedule-hub`, 06:53 UTC) queued a 4-minute build for about 7 minutes (that list: created 11 minutes earlier, build duration 4 minutes). One preview failed
prerendering `/sitemap.xml` on a database timeout.

**Cause:** `HEAD^` of a merge commit is the branch's previous tip, so the diff includes everything
merged from `main`. Draft PRs build too. The sitemap is prerendered at build time and reads the
database, so a busy database fails the build.

**Fix:** Not yet; follow-ups are on #1048.

**Lesson:** Merge `main` into a branch only when CLAUDE.md says to (a conflict, a dependency, a
new migration); each merge push costs a full preview build.

**Guard:** Foundation tracker #1048 checklist lines "ignoreCommand diffs against the PR
merge-base and skips drafts" and "sitemap rendered on request with caching".
