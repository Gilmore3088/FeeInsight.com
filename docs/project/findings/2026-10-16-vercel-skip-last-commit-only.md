# 2026-10-16: the preview skip looks only at the last commit
**What happened:** PR #1678 changes Pro pages, but Vercel marked its preview "Ignored" at 10:55 UTC on
Oct 16. The head commit, c8e2d578, changed one test file, and that was the only commit in the push
the skip rule saw.
**Cause:** `vercel.json`'s `ignoreCommand` compares `HEAD^` with `HEAD`. A push whose newest commit
touches only tests or docs skips the preview, even when earlier commits in the same push change
pages. For a merge commit, `HEAD^` is the first parent, so only the merge's own diff counts.
**Fix:** none in config yet. The command is 246 of Vercel's 256 characters, and comparing against
the branch's merge base needs history that Vercel's shallow clone may not have. #1678 got its
preview from a following commit that changed page code.
**Lesson:** on a page PR, make sure the last commit of each push touches non-test, non-doc code,
or check the Vercel comment says "Ready" and not "Ignored" before sending preview links.
