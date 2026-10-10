# Branch preview builds held up the Vercel build queue

**Found:** 2026-10-09, Vercel deploy queue thread. James saw about 30 deployments queued.

GitHub's deployment records for 2026-10-09 (00:00 to 13:31 UTC) show 400 Vercel builds: 147
production (every merge to `main`) and 253 previews (every push to every PR branch, including
each "merge origin/main" commit a thread pushes to keep its branch current).

Time from Vercel's "deploying" status to done, per commit:

| Build | Count | Median | 90th percentile | Longest |
|---|---|---|---|---|
| Production | 147 | 3 min | 4 min | 12 min |
| Preview | 253 | 41 min | 106 min | 139 min |

Production builds were not the slow ones; they went through in minutes. The queue James saw was
previews, which finished one at a time about every two minutes all day. A few previews were still
waiting when a newer push to the same branch made them pointless. Old preview deployments also
stay up, and each one can still reach the prod database with old code.

**Fix:** `vercel.json` `ignoreCommand` skips preview builds. Exit 1 builds and exit 0 skips:
- `VERCEL_ENV=production` always builds.
- A branch whose name contains `preview` builds, as does the branch for draft PR 939
  (`claude/project-thread-89wcvd`), which is waiting on a preview.
- A commit whose message contains `[preview]` builds, so a thread can opt one push in.

A branch keeps building previews until it carries this `vercel.json`, which it gets from its
next merge of `origin/main`.

Not visible from GitHub: Vercel's own queue, its concurrency setting, and whether "Prioritize
Production Builds" is on. Those live in the Vercel dashboard.
