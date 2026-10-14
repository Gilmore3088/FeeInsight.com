# Two PRs merged the same migration number

**Found:** 2026-10-09, Agentic OS PRD thread (Deming, PR 875).

PR 857 (`20270110000036_email_send_log.sql`) merged at 08:41 UTC. Two minutes later PR 875 merged
`20270110000036_deming_eval_cases.sql`. Each branch was green on its own: when 875's CI ran,
main's highest number was 035. After both merged, main had two 036 files. `migration-version-kill`
failed on main, and prod's history recorded only `email_send_log` at 036, so `eval_cases` was never
created.

**Fix:** rename the Deming file to `20270110000037_deming_eval_cases.sql`. Its SQL is
`CREATE TABLE IF NOT EXISTS`, so applying it under the new number changes no data.

**Rule:** before merging a PR that adds a migration, merge `origin/main` into it and re-run
`bash scripts/ci-guards.sh migration-version-kill`. A green PR built on an older main can still
take a number that has since been used.
