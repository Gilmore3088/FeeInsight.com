# 2026-10-17: Hamilton release, failure and rollback runbook (H07-T07)

**What happened:** #982 (H07) had no written way to rehearse a Hamilton release, contain a bad one or roll it back, and no browser journey a person could run before saying "it works". On 2026-10-17 a local signed-in journey (below) ran for the first time, on synthetic fixtures. In its first hour it found two defects that unit tests had missed:
- A Pro account linked to its institution was told "No institution is linked to your account". postgres.js returns `users.id` (bigint) as a string, and `accountContextFromMemberships` compared it with a number.
- "Save this peer research" on a first-turn peer list always returned 409.

Both are fixed on `acct2/hamilton-trust-batch` (06054bd56). The journey now checks them as passing tests.

**Cause:** user journeys were checked only by unit tests with mocked rows and by James's occasional live run. No test drove a real build, a real database and a real browser together.

**Fix:** branch `acct2/hamilton-h07-release` (#982 H07-T01 to T04, T07). Fixtures: `tests/e2e/hamilton/fixtures.ts`. Journeys: `tests/e2e/hamilton/research-journey.pw.ts` and `admin-correction.pw.ts`. Command: `npm run test:hamilton-journeys`. The CI job (T05) is a separate PR.

**Lesson:** run the journey before calling any Hamilton change done. A synthetic pass is evidence for a case, never its live pass (the matrix, `docs/plans/hamilton-h07-acceptance-matrix.md`, records both).

## Run the journeys locally

Nothing here touches production. The fixtures refuse any database that is not on this machine. The server has every provider, Stripe, email and mailing-list key blanked, and the fixtures switch the provider stop on.

1. Start Postgres and load the schema into a throwaway database:
   ```
   service postgresql start
   PGPASSWORD=postgres dropdb -h localhost -U postgres --if-exists e2e_hamilton
   PGPASSWORD=postgres createdb -h localhost -U postgres e2e_hamilton
   PGPASSWORD=postgres psql -h localhost -U postgres -d e2e_hamilton -q -v ON_ERROR_STOP=1 -f tests/e2e/production-schema.sql
   ```
2. Run the suite:
   ```
   E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5432/e2e_hamilton npm run test:hamilton-journeys
   ```
   - The first run builds the app (`next build`, about 5 minutes). Set `HAMILTON_E2E_BUILD=1` to rebuild after a code change; a stale `.next` is otherwise reused.
   - `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (or `HAMILTON_E2E_CHROMIUM=<path to chrome>`) uses an installed Chromium. Never run `playwright install` in a cloud session.
   - In a git worktree whose `node_modules` is a symlink, Turbopack refuses to build. Use a real or hard-linked `node_modules` (`cp -al`). `next build --webpack` fails type-checking on `src/app/admin/verify/page.tsx` (it exports `GoldStandardView`), and `next dev --webpack` cannot hydrate under the site's Content-Security-Policy (no `'unsafe-eval'`).
3. Read the results. Screenshots, the downloaded PDF and failure traces are in `test-results/hamilton-journeys/`. The HTML report is in `test-results/hamilton-journeys-report/`.
   - Set `HAMILTON_E2E_KEEP=1` to keep the fixtures afterwards. You can then sign in by hand as `pro.e2e@fixture.test`, `pro2.e2e@fixture.test`, `admin.e2e@fixture.test` or `viewer.e2e@fixture.test` (password in `fixtures.ts`) on `http://localhost:3197`.
4. Fixture checks without a browser: `E2E_DATABASE_URL=... npx vitest run tests/e2e/hamilton/fixtures.db.test.ts`.

On 2026-10-17 (local production build, Turbopack, fixture database `e2e_d`), the run gave these results:
- `research-journey.pw.ts`: 8 passed, plus 1 known defect marked `test.fail`. The criteria line shows "nationwide" again after a fee follow-up; the coordinator is fixing it in the combined pass.
- `admin-correction.pw.ts`: 4 passed.
- `fixtures.db.test.ts`: 7 passed.

## What the journeys cover

| Step | Checked | Cases |
|---|---|---|
| Sign in through the real login form; one Ask box in every state | form and textarea counts | H04-AC1 |
| "List ten similarly sized credit unions" | 10 of 12 rows; each with assets and "Jun 2026"; size band stated; unknown-asset CU, bank and tiny CU left out; table above the save control | H02-AC1, H05-AC1 |
| "Only Florida" | 7 rows, all FL; no new peers | H02-AC3 |
| "Compare their NSF fees" | $0 shown as $0; stale source says "Source over a year old"; missing fee says "No published consumer ... fee on file"; never "free" | H02-AC4, H06-AC3 |
| "Compare their foreign transaction fees" | a rate fee shown as "1% of the transaction", never in dollars | H06-AC3 |
| Save, then reopen the saved research | same rows and subject; no page-level sideways scroll at 390px | H01-AC3, H05-AC3 |
| Fee answer, PDF download, reopen with another institution selected | file starts `%PDF-`; reopened answer still names the home and $27 | H01-AC3, H05-AC4 |
| Account with no linked institution asks "compare with us" | "No institution is linked to your account"; no "(your institution)" | H01-AC2 |
| Linked account asks "compare with us" | the home appears as "(your institution)" | H01-AC1 |
| Second account opens the first's saved research and answer; no subscription; signed out | "Page not found"; 401 from `/api/hamilton/ask` | H01-AC4 |
| Saved answer with no recorded institution | reopens read-only and unscoped | H06-AC4 |
| Written-answer route with no provider key | 503 before any model call; nothing saved; no `ai_api_usage_events` row | T07 |
| Admin: hold, release, correct, reverse, stale second tab; Pro user refused | catalog drops and restores the fee; `pipeline_feedback` admin_hold/admin_release; correction version with run `manual_repair` and events `fee.correct`, `index.refresh`; Hamilton answers $30 after the correction; stale tab refused; reversal is a new version; unrelated fixture fees byte-identical | H03-AC1, AC2, AC4, H07-AC3 |

Not covered, still manual (each has a named check, `MC-...`, in the matrix): live data and assets, a second linked login on production, 200% zoom, keyboard-only use, clarifications, old-source replay through the UI (covered in `fee-corrections.db.test.ts`), and James's visual acceptance.

## Failure containment

| Failure | What a user sees | Contain it | Then |
|---|---|---|---|
| Provider down, out of credit or over budget | Written answers say Hamilton is paused; engine answers (peer lists, fee lookups, storylines) keep working | Turn the `global` provider stop on in `/admin` (automation control). It blocks provider steps only; deterministic Hamilton reads go on. | Lift the stop after billing or provider health is fixed. Check that `ai_api_usage_events` writes again on one question. |
| A bad Hamilton deploy (wrong answers, errors on `/pro/analyze`) | Errors or wrong labels | Roll back in Vercel: Deployments, the last good production deployment, "Promote to Production". This is code only: it changes no data. | Revert the PR on `main` (a new revert PR, never a force-push). Re-run the journey on the revert's preview. Record both SHAs in #982. |
| A wrong published fee | Wrong amount on public pages and in Hamilton | Admin: Hold on the fee's row (`/admin/institution/<id>`). It leaves every customer read at once and logs `admin_hold`. Nothing is deleted. | Correct it from the stored schedule (a new version), or Release. Every step stays in `/admin/corrections`. |
| A wrong correction | Corrected value is wrong | Reverse it on the same screen: the earlier value is published again as a new version, and both stay in the history | Never edit `published_fee_records` or `published_fee_corrections` by hand. |
| Index refresh failed after a hold or correction | Medians lag the change | The admin row shows "saved, refresh failed". Use its Retry. | If the retry fails again, file it under the Hamilton tracker (#975) with the run id. |
| Database unreachable | Hamilton pages show their error state; `/api/hamilton/ask` returns 500 "Hamilton could not answer that just now" | Nothing to roll back in the app. Check Supabase status and the connection pool (`DATABASE_POOL_MAX`). | Not exercised by this suite: it needs a fault-injection hook the app does not have. Left open under H07-T07. |
| A migration that fails or must be undone | Deploy succeeds; reads fail on a missing column | Migrations are never rolled back by deleting history. Write a forward-fix migration with the next number, in its own PR, with James's yes. | See CLAUDE.md "Migrations". Code rollback alone does not undo SQL. |
| Duplicate submission | One answer, one saved row | Built in: the double-submit guards and the correction idempotency key | Covered by unit tests and the stale-tab step above. |

**Audit history is kept in every path above.** Holds, releases, corrections and reversals each write a row, and none is deleted. A code rollback leaves saved answers and corrections in place. A saved answer made before a fee change shows its change notice (H03-T09).

## Still open under H07-T07

- No failure injection for a database outage or a failed cache refresh in the local harness. Building one needs an app-side fault hook, so it was left out of this change.
- `HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS` (`src/lib/hamilton/release-acceptance.ts`) lists seven cases. This suite gives synthetic evidence for three of them, with no live rehearsal: `provider_stop` (the no-key path), `duplicate_submit` (the stale tab) and `failed_request` (the 401s and the 409 path).
