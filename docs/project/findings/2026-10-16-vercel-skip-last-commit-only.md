# 2026-10-16: the preview skip looks only at the last commit
**What happened:** PR #1678 changes Pro pages, but Vercel marked its preview "Ignored" at 10:55 UTC on
Oct 16. The head commit, c8e2d578, changed one test file, and that was the only commit in the push
the skip rule saw.
**Cause:** `vercel.json`'s `ignoreCommand` compares `HEAD^` with `HEAD`. A push whose newest commit
touches only tests or docs skips the preview, even when earlier commits in the same push change
pages. For a merge commit, `HEAD^` is the first parent, so only the merge's own diff counts.
**Fix:** none in config at first; #1678 got its preview from a following commit that changed page
code. Since 2026-10-20, `scripts/vercel-ignore-build.mjs` compares with the branch's last
successful deployment (`VERCEL_GIT_PREVIOUS_SHA`), so every commit in a push counts, and fetches
the history it needs from the shallow clone
(`findings/2026-10-20-preview-build-queue-from-merge-main-pushes.md`).
**Lesson:** on a page PR, make sure the last commit of each push touches non-test, non-doc code,
or check the Vercel comment says "Ready" and not "Ignored" before sending preview links.
**Guard:** `scripts/vercel-ignore-build.test.ts:75` (a push whose last commit changes only docs or tests, after a page commit, still builds because the diff runs from the last successful deployment)
