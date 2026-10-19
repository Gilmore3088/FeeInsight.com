# Findings

Problems we hit that were structural or infrastructural: what happened, why, the fix, and the
lesson for next time. Add one the moment you find it, in the same PR as the fix (or its own PR
if there is no fix yet).

Each finding is its own file in this folder, named `YYYY-MM-DD-short-slug.md` (lowercase
letters, digits and hyphens), so parallel PRs never edit the same lines. Newest first is the
reverse of the file names: `ls -r docs/project/findings`.

Entries up to 2026-10-09 stay in `../FINDINGS.md`. That file takes no new entries;
`scripts/ci-guards.sh findings-file-kill` fails on a FINDINGS.md heading dated after
2026-10-09 or on a misnamed file here.

Template:

```
# YYYY-MM-DD: short name
**What happened:** what someone saw, with real numbers and where they came from.
**Cause:** the root cause, or "not yet known".
**Fix:** PR or issue, and whether it is merged or applied.
**Lesson:** what any session should do differently.
**Guard:** the test, CI guard (`scripts/ci-guards.sh`), scorecard alarm or checklist line that
catches a repeat, or the issue that will add it.
```

A finding without a guard is a lesson nothing enforces, so the same thing happens again (#1108).
`findings-file-kill` fails a PR that adds a finding without a `**Guard:**` line. Its OK line
counts the older findings that name none.
