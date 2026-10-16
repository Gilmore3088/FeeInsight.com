# Main has no branch protection, though CI calls `app-tests` the required check

**Date:** 2026-10-16
**Found by:** Hamilton builder session, reading release protections for #982 (H07-T06).

## What was found
- The public GitHub API reports `"protected": false` for `main`, and `rules/branches/main` returns `[]`.
- `.github/workflows/test.yml` says `app-tests` is "the one required check" that branch protection and the merge rule read. Nothing enforces that today; the merge flow relies on each session checking CI before merging.
- `test.yml` ignores `**/*.md` and `docs/**`. If `app-tests` is made required as-is, docs-only PRs would wait on a check that never runs.
- `fee-audience-sql` is not in `app-tests`' `needs`, so it can be red while `app-tests` is green.

## What it needs
A protection plan James approves (it is a permissions change): make `app-tests` required, give docs-only PRs a path that reports it, and decide whether `fee-audience-sql` joins `app-tests`. Tracked in #982 and `docs/plans/hamilton-h07-acceptance-matrix.md` (B8).
