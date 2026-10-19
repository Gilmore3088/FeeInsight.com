# Hamilton complaint-to-evidence matrix (H07-T01)

- **Version:** 2026-10-19.1
- **Code copy:** `src/lib/hamilton/release-acceptance.ts` version 2 holds the stable complaint, task and case ids and, for each case, its automated tests and named manual check (section "Acceptance case checks"). Its test fails if a case loses both, if a listed test file is missing, or if this file stops listing a case or a manual check id. Status, owners and PRs live only here.
- **What it is:** the H07-T01 matrix for #982 (closed 2026-10-19; the open H06/H07 items are now checklist lines on #975). It maps each original complaint to its H01-H06 tasks, acceptance cases, implementing PRs and release checks, and names what blocks a release.
- **How to update it:** change a row only with a link to the evidence (PR, CI run, issue comment, screenshot). Add a dated line to the change log at the bottom for every change. Never delete a row or a case; a dropped case goes under "Scope changes" with its date, reason and James's acceptance.
- **What it is not:** this matrix records evidence. It claims no acceptance. Nothing here is accepted until an issue comment records James's acceptance, and no such comment exists for any task or case today.

**Sources read on 2026-10-17:** `/mnt/project-files/acct2/hamilton-open-tasks-2026-10-17.md` (read-only audit of #975 to #982, roadmap Phase 4, `origin/main` at `d1a3c1378` and open PR #1705); the public GitHub API for `main` protection; the local journey run below. **Sources read on 2026-10-16:** issues #975, #976, #977, #978, #979, #980, #981, #982, #7, #629, #1005, #1006 (body and comments); PR searches for 976-982 and "Hamilton"; PR #1524's body; `git log origin/main` at `1b6b6a3a`; `src/lib/hamilton/release-acceptance.ts` on main; `/mnt/project-files/hamilton-redesign/`.

**Earlier versions:** v0.1 was posted as a comment on 2026-10-10 ([#982 comment](https://github.com/Gilmore3088/FeeInsight.com/issues/982#issuecomment-6096490765)). A code copy is in `src/lib/hamilton/release-acceptance.ts` (`HAMILTON_RELEASE_MATRIX_VERSION = 1`, snapshot 2026-10-10T09:30Z, from PR #996). Version 1 went stale within days (B11). Version 2 (2026-10-17, #982 H07-T01) drops the owners, PRs and statuses from code and keeps them here only.

## Original complaints

**About #7.** GitHub #7 is not the complaint. It is a closed PR from March 2026, "feat(ops): coverage ops pipeline with triage, manual entry, and safe re-crawl", closed in a branch cleanup on 2026-10-03. When #976-#982 say "Original complaint: #2" or "#7", they mean the numbered list of James's seven reported problems in #975, not GitHub issue numbers. #975 is the only written list of the original complaints. No issue quotes James's own words; the wording below is #975's.

| Id | Complaint (#975 wording) | Tasks | Acceptance cases |
|---|---|---|---|
| C01 | Multiple Ask/follow-up inputs | H04-T01 to T10; H05-T03, H05-T04 | H04-AC1 to AC4; H05-AC1; H07-AC2 |
| C02 | Viewed institutions called "your institution" | H01-T01 to T10; H06-T04 | H01-AC1 to AC4; H06-AC1; H07-AC2 |
| C03 | Peer request gives a report instead of a list | H02-T01, T02, T07, T08, T09; H04-T05; H05-T04 | H02-AC1 to AC3; H04-AC2; H05-AC1; H07-AC2 |
| C04 | Peer asset size missing | H02-T03 to T06; H06-T03, H06-T04 | H02-AC1, AC2, AC4; H06-AC3 |
| C05 | Word-heavy output and inconsistent fonts | H05-T01 to T08 | H05-AC1 to AC4 |
| C06 | Ordinary corrections require a coding assistant | H03-T01 to T12; H07-T04 | H03-AC1 to AC4; H07-AC3 |
| C07 | Hamilton is not ready for consulting | H06-T01 to T10; H07-T01 to T10 | H06-AC1 to AC4; H07-AC1 to AC4 |

C07 note: #975 and #982 keep autonomous consulting out of this release. C07 maps to a research-only readiness decision (H07-T10), not to consulting readiness.

### Unmapped (needs a task)
None. All seven complaints map to at least one task and one acceptance case.

## Tasks

Status key: **Not started**; **In progress** (work or evidence exists, nothing merged that covers the task); **Merged, not accepted** (code for the task is on main; no James acceptance); **Accepted** (an issue comment records James's acceptance). No task is Accepted.

"Owner" follows what the issue names. Several issue bodies say "Unassigned" while a 2026-10-10 comment says a ChatGPT lane took ownership; both are shown. Later work was done by Claude sessions.

PR states were checked on 2026-10-16. #985 merged 2026-10-11 and carries H01, H02 (#988 was stacked on it and merged into it), and the landing work from #993/#989 (both closed as superseded, not merged on their own).

### H01 #976: account institution vs research subject
Owner: ChatGPT (named in #976 body). James is approver.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H01-T01 | Map context flow | ChatGPT | Merged, not accepted | #985 (merged) | #976 body "Task proof map" | None for code; needs review |
| H01-T02 | One context contract | ChatGPT | Merged, not accepted | #985 (merged) | #976 body; [H01/H06 contract check](https://github.com/Gilmore3088/FeeInsight.com/issues/981#issuecomment-6102485009) | None for code; needs review |
| H01-T03 | Server resolution never writes a home | ChatGPT | Merged, not accepted | #985 (merged) | #976 body | None for code; needs review |
| H01-T04 | Context end to end (Ask, memo, reports) | ChatGPT | Merged, not accepted | #985 (merged) | #976 body | None for code; needs review |
| H01-T05 | Labels and pronouns | ChatGPT | Merged, not accepted | #985, #1469, #1569 (merged; #1569 is the no-linked-institution wording, #1536) | [#976 checklist, Oct 15](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6196762843): "Your published fee" fixed by #1469 | Final live screenshots not taken |
| H01-T06 | Saved/exported answers keep their subject | ChatGPT | Merged, not accepted | #985 (merged) | #976 body (synthetic PDF render and text check) | Live save/reopen/PDF not run |
| H01-T07 | Private workspace boundaries | ChatGPT | Merged, not accepted | #985 (merged) | #976 body (two-user synthetic tests) | Needs a second linked login for the live check |
| H01-T08 | No stale/in-flight relabel | ChatGPT | Merged, not accepted | #985 (merged) | #976 comments of 2026-10-10 (delayed-save and new-question repros) | Live delayed/back-forward check not run |
| H01-T09 | Regression tests and gates | ChatGPT | Merged, not accepted | #985 (merged) | CI run 38095740849 on pre-merge head `e176a798`; box is ticked in #976 but no James acceptance | CI on the final merged head not re-checked here |
| H01-T10 | Authenticated preview acceptance | ChatGPT | In progress | none | [#976 checklist, Oct 15](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6196762843); AC2 fix merged in #1569, re-run not recorded. Local journey 2026-10-17: a linked Pro account was shown "Not linked" (bigint user id compared with a number); fixed on `acct2/hamilton-trust-batch` (06054bd56), not yet merged | Two halves need a second, linked login; none available to the thread |

### H02 #977: peer lists with assets, dates, criteria
Owner: ChatGPT (named in #977 body); Claude session picked up the handoff on 2026-10-11. James is approver.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H02-T01 | Peer-request test matrix | ChatGPT | Not started | #988, #985 (merged) | none linked as a matrix | No fixture table of the Oct 16 failing wordings |
| H02-T02 | Peer-list intent before fee default | ChatGPT | Merged, not accepted | #988, #985, #1604 (merged) | #977 body; parser fix `f4ad309e` for the "talki ... florida over 5b" phrase | None for code |
| H02-T03 | Selection and ranking rules | ChatGPT | Merged, not accepted | #988, #985, #1604, #1623 (merged) | #977 body | Proposed half-to-double asset default awaits James's review |
| H02-T04 | Typed peer-result contract | ChatGPT | Merged, not accepted | #988, #985 (merged) | #977 body | None for code |
| H02-T05 | Deterministic retrieval, units once | ChatGPT | Merged, not accepted | #988, #985 (merged) | #977 body (thousand-dollar correction) | No query-plan/timing record found |
| H02-T06 | Eligibility separate from fee coverage | ChatGPT | Merged, not accepted | #988, #985, #1623 (merged) | #977 body | None for code |
| H02-T07 | Table first | ChatGPT | Merged, not accepted | #988, #985 (merged); #1705 (open) | #977 body; local journey 2026-10-17 screenshots (ten rows, refined, 390px) on synthetic fixtures | Long-name and incomplete-data renders not recorded |
| H02-T08 | List kept across follow-ups and saves | ChatGPT / Claude | In progress | #988, #985, #1636, #1678 (merged; partial) | [#977 handoff](https://github.com/Gilmore3088/FeeInsight.com/issues/977#issuecomment-6108580026) | Export/PDF parity and paging past 50 not built. Local journey 2026-10-17: saving a first-turn list returned 409; fixed on `acct2/hamilton-trust-batch` (06054bd56), not yet merged |
| H02-T09 | Routing, cost, regressions | ChatGPT | Merged, not accepted | #988, #985 (merged) | #977 handoff (no paid fallback for pure lists) | Provider-call evidence in a real browser not recorded |
| H02-T10 | Authenticated preview acceptance | ChatGPT | In progress | none (fixes for the Oct 16 failures: #1604, #1636, #1678) | [#977 checklist, Oct 15](https://github.com/Gilmore3088/FeeInsight.com/issues/977#issuecomment-6196764340) (steps written, not run) | Local copy has no asset data (0 matches); must run on the live site |

### H03 #978: admin hold, correct, publish
Owner: Unassigned (#978 body); a ChatGPT lane claimed it on 2026-10-10; Claude sessions built T02 to T11 (#1649, #1678). James is approver.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H03-T01 | Trace one correction end to end | Claude | Merged, not accepted | #1649 (spec `docs/plans/hamilton-h03-corrections.md`) | [T01 trace, Oct 15](https://github.com/Gilmore3088/FeeInsight.com/issues/978#issuecomment-6197270932) | Not reviewed |
| H03-T02 | Lifecycle and authority | Claude | Merged, not accepted | #1649 | James's Oct 16 answers (scope changes below) | None |
| H03-T03 | Versioned, auditable storage | Claude | Merged, not accepted | #1649 (migration 053, applied on prod Oct 16) | #1649 comment | None |
| H03-T04 | Hold and correct commands | Claude | Merged, not accepted | #1024 (hold), #1649 (correct) | `fee-corrections.db.test.ts`; local admin journey 2026-10-17 | None for code |
| H03-T05 | Controls at the point of error | Claude | Merged, not accepted | #1649 | Local admin journey screenshots 2026-10-17 (synthetic) | James's design review; no phone/desktop preview recorded |
| H03-T06 | Publish approved changes safely | Claude | Merged, not accepted | #1649 | `fee-corrections.db.test.ts` | Known limits: conditions read from the original lineage; dollar fees only; audience and variant not editable |
| H03-T07 | Protect corrections during reprocessing | Claude | Merged, not accepted | #1649, #1022 | `fee-corrections.db.test.ts` (old-source replay); B10 cleared Oct 16 | None for code |
| H03-T08 | Refresh affected surfaces | Claude | Merged, not accepted | #1649, #1678; #1705 (open) adds "saved, refresh failed" | Local admin journey: Hamilton answers $30 after the correction | None for code |
| H03-T09 | History and affected saved outputs | Claude | In progress | #1678 (institution-level notice) | `page.test.tsx` (H03-T09) | Saved outputs keep no fee ids; needs a migration (own gated PR, James's yes) |
| H03-T10 | Audit history and reversal | Claude | Merged, not accepted | #1649, #1678 (`/admin/corrections`) | Local admin journey: reversal is a new version, history keeps every row | None for code |
| H03-T11 | Adversarial integration and CI | Claude | In progress | #1705 (open) | `fee-corrections.adversarial.test.ts`, `actions.corrections.test.ts` | #1705 not merged |
| H03-T12 | Operator walkthrough in preview | Unassigned | Not started | none | Synthetic walk only (local admin journey) | James or a named reviewer with an admin login; any prod write needs his exact-scope yes |

P0 defect recorded in #978 (distinct same-priced fees flagged by rules re-check): fixed in code by #1022 (merged 2026-10-12). Whether the wrong `takedown_pending` flag on publication #121441 cleared in production is **unknown**: the 2026-10-15 triage could not read the database.

### H04 #979: one composer, coherent conversation
Owner: Unassigned (#979 body); a ChatGPT lane claimed it on 2026-10-10; Lane B (Claude) did T05 and T07 work. James is approver.

**#979 was closed as "completed" on 2026-10-14 by #1272 and reopened on 2026-10-16 (B4).** The rows below treat the work as open.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H04-T01 | Inventory all entry points | Unassigned | Not started | none | none | none |
| H04-T02 | Canonical conversation state | Unassigned | Not started | none | none | none |
| H04-T03 | One active composer | Unassigned | Not started | none | [#979 comment, Oct 14](https://github.com/Gilmore3088/FeeInsight.com/issues/979#issuecomment-6164042762): clarification `QuestionForm` is still a second input | none recorded |
| H04-T04 | Clarifications in the same flow | Unassigned | Not started | none | same comment | none recorded |
| H04-T05 | Multi-turn context | Lane B | Merged, not accepted (written path; peer follow-ups) | #1272, #1636, #1678 (merged) | same comment; local journey 2026-10-17 (list, Florida, two fee follow-ups) | Structured route carrying subject and earlier answers not built |
| H04-T06 | Reload, navigation, reset | Unassigned | Not started | none | same comment | none recorded |
| H04-T07 | No duplicate or stale requests | Lane B | Merged, not accepted (double-submit only) | #1274 (merged); related H01 fixes in #985 | [#979 comment, Oct 14](https://github.com/Gilmore3088/FeeInsight.com/issues/979#issuecomment-6164521667) | Slow-response, cancel and rapid-subject-switch parts open |
| H04-T08 | Recoverable failures, keyboard safety | Unassigned | Not started | none | none | none |
| H04-T09 | Conversation authorization and CI | Unassigned | Not started | none | none | none |
| H04-T10 | Authenticated preview acceptance | Unassigned | Not started | none | none | Waits on T03/T04/T06 |

### H05 #980: typography and answer-first output
Owner: Unassigned (#980 body); a ChatGPT lane claimed it on 2026-10-10. The 2026-10-15 triage routes the design work to #1284 and #1368. James is approver.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H05-T01 | Visual baseline | Unassigned | In progress | none | [Baseline, Oct 15](https://github.com/Gilmore3088/FeeInsight.com/issues/980#issuecomment-6197192136); `/mnt/project-files/hamilton-redesign/h05-baseline/` (9 states, 1440px and 390px, local build of `1a57b070`) | No loading or written-answer state captured; not reviewed |
| H05-T02 | One presentation contract | Unassigned | Not started | none | none | James's design review; to come from #1284/#1368 |
| H05-T03 | Shared answer primitives | Unassigned | Not started | none | none | Waits on T02 |
| H05-T04 | Requested result first | Claude | In progress | #1705 (open) | `answer-order.test.tsx`, `AnalyzeWorkspace.answer-order.test.tsx` | #1705 not merged |
| H05-T05 | Data, source, failure states | Claude | In progress | #1705 (open) | "Jun 2026" dates, $0, "Amount not stated", `source-age.ts` | #1705 not merged |
| H05-T06 | Responsive and accessible | Unassigned | Not started | none | Local journey 2026-10-17: no page-level sideways scroll at 390px on reopened research (synthetic) | 320/768px, 200% zoom and keyboard pass not done |
| H05-T07 | Saved/export parity | Unassigned | In progress | #1636 (merged; Evidence Record in the analysis PDF) | Local journey downloads a real PDF (starts `%PDF-`) | Side-by-side screen/export fixtures not built |
| H05-T08 | Visual acceptance | Unassigned | Not started | none | none | Waits on T02-T07 |

Unknown: how far #1368 ("Hamilton redesign 1", merged 2026-10-15) covers any H05 task. No H05 task id appears in that PR's title, and its body was not read.

### H06 #981: evidence-bound facts, honest verification
Owner: Unassigned for remaining tasks (#981 body); a ChatGPT lane claimed it on 2026-10-10. James is approver.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H06-T01 | Numerical-confidence containment | Unassigned | Merged, not accepted | #995 (merged; carries #974, which closed unmerged) | [#981 comment, Oct 10](https://github.com/Gilmore3088/FeeInsight.com/issues/981#issuecomment-6096169372) | Inspected new-output examples not recorded |
| H06-T02 | Shared evidence/fact contract | Unassigned | Merged, not accepted | #995 (merged) | same comment; commit `1d7d450e` | Needs review with H01-T02 |
| H06-T03 | Evidence through data reads | Unassigned | Merged, not accepted | #995, #1705 (merged; #1705 adds rate fees in peer lists) | commit `1d7d450e` (H06-T02/T03) | none recorded |
| H06-T04 | Bind displayed facts to records | Claude | Merged, not accepted | #1678 (regression set); #1705 (merged 2026-10-17, `9c207e44`: `written-answer-binding.ts` binds written-answer sentences to fee records) | `written-answer-binding.test.ts` | Live check MC-H06-AC1 (#1726) |
| H06-T05 | Explicit derived comparisons | Unassigned | Merged, not accepted | #995, #1524 (merged) | #1524 body: signed readings with both inputs and dates | Rendered on no screen yet |
| H06-T06 | Bound narrative and failures | Claude | Merged, not accepted | #1240, #1430, #1435, #1705 (merged; #1705 adds `narrative-bound.ts`) | [Hold live, Oct 15](https://github.com/Gilmore3088/FeeInsight.com/issues/981#issuecomment-6191928539) with James's chosen line; `narrative-bound.test.ts` | Live check MC-H06-AC1 (#1726) |
| H06-T07 | Confidence language, old outputs | Claude | Merged, not accepted | #995, #1705 (merged; legacy High shows as Medium, saved records never rewritten) | [#981 comment, Oct 10](https://github.com/Gilmore3088/FeeInsight.com/issues/981#issuecomment-6096514869); `confidence-legacy.test.tsx` | Live check MC-H06-AC4 (#1726) |
| H06-T08 | Saved/export evidence parity | Claude | Merged, not accepted | #995, #1636, #1678 (merged) | `evidence-export.test.ts`, `actions.h06-reopen.test.ts` | Export inspection is section 2 of #1726 |
| H06-T09 | Regression set | Unassigned | Merged, not accepted | #1524 (merged 2026-10-15) | #1524 body: 25 invented cases, version `2026-10-15.2`; `HUMAN_REVIEW` says no person has reviewed the expected outcomes | No per-case human review: James ruled on 2026-10-19 that he does no manual fee or answer-key checks (#629 closed); the weekly live check replaces it (DECISIONS) |
| H06-T10 | Trust acceptance | James | Not started | none | none | James's live checks in #1726 |

### H07 #982: acceptance, release safety, readiness
Owner: Unassigned (#982 body); a ChatGPT lane claimed it on 2026-10-10. James is approver.

| Task id | What | Owner | Status | PRs | Evidence | Blocker |
|---|---|---|---|---|---|---|
| H07-T01 | Complaint-to-evidence matrix | Claude | Merged, not accepted | #996 (code v1); #1705 (merged; code v2, matrix 2026-10-17.1) | This file; `release-acceptance.test.ts` | James's acceptance |
| H07-T02 | Isolated reusable fixtures | Claude | Merged, not accepted | #996; #1705 (merged; `tests/e2e/hamilton/fixtures.ts`) | `fixtures.db.test.ts`: seed, re-seed, teardown of only fixture rows, loopback-only guard | Fixture schema lacks decision tables (#2170) |
| H07-T03 | Automated signed-in journey | Claude | Merged, not accepted | #1705, #2005, #2169 (merged; `research-journey.pw.ts`, `billing-access.pw.ts`, `answer-workflow.pw.ts`) | Local run 2026-10-17: see "Local journey run" below | Runs locally only (T05); synthetic data; #2170 |
| H07-T04 | Automated admin correction journey | Claude | Merged, not accepted | #1705 (merged; `admin-correction.pw.ts`) | Local run 2026-10-17: 4 of 4 passed | Old-source replay through the UI not driven (covered in `fee-corrections.db.test.ts`) |
| H07-T05 | Trustworthy CI evidence | Unassigned | Not started | none | none | Its own PR once #2170 makes the suite stable; costs Actions minutes. Tracked on #975 |
| H07-T06 | Release protections and overlap | James | Done | #1641 (merged; `app-tests` reports on every PR); #1642 (closed) | Read, 2026-10-19 (REST): `rules/branches/main` returns `deletion`, `non_fast_forward`, `required_status_checks` | None |
| H07-T07 | Failure recovery and rollback | Claude | In progress | #1705 (merged) | Runbook `docs/project/findings/2026-10-17-hamilton-release-runbook.md`; journey: no-key refusal, stale tab, 401s | Database-outage and cache-refresh fault injection not built. Tracked on #975 |
| H07-T08 | Release-candidate packet | Unassigned | In progress | #996 (validator only) | `assessHamiltonReleaseCandidate` requires all 28 cases passed on one SHA; the Oct 18 go-live release matrix (`/mnt/project-files/hamilton-redesign/release-matrix-oct18.md`) | No case has passed; launch gates #1921, #1925, #1926 open |
| H07-T09 | Release approval and deployed check | Unassigned | Not started | none | none | Waits on T08 |
| H07-T10 | Readiness decision | Unassigned | Not started | none | none | Waits on T09 and James |

### Local journey run, Oct 17
Local production build of `acct2/hamilton-trust-batch` plus `acct2/hamilton-h07-release`, fixture database from `tests/e2e/production-schema.sql`, pre-installed Chromium, every provider key blank. `research-journey.pw.ts`: 10 passed. `admin-correction.pw.ts`: 4 passed. The first runs found three defects, all fixed on `acct2/hamilton-trust-batch` and now checked as passing tests: a linked Pro account shown "Not linked" (bigint user id compared with a number), a 409 when saving a first-turn peer list, and the criteria line showing "nationwide" after a fee follow-up to "Only Florida". A local synthetic run is evidence, not a case pass.

## Acceptance cases

Status key: **Not run**; **Run, failing**; **Run, passing on preview**; **Accepted**. No case is Accepted or passing. A local-build or synthetic test run is recorded as evidence but does not count as a run.

| AC id | Required check (short) | Status | Evidence |
|---|---|---|---|
| H01-AC1 | Linked Space Coast home: browse 3 others, "compare with us"; home unchanged | Not run | Unlinked half walked on a local build with #1469 on Oct 15 ([checklist](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6196762843)); linked half needs a second, linked login |
| H01-AC2 | No home: subject never called "your" | Run, failing | James's live run, Oct 16 (after #1469 merged): asking about "us" with no linked institution (A2, A3) does not say that no institution is linked ([#976 results](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6205206816), #1536). Earlier: [live run on older head `0a3e2b0`, Oct 10](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6102185823) found "YOUR OWN FIGURES". Mapping of run steps to this case is this file's reading |
| H01-AC3 | Save A, switch to B, reopen/export: still A | Not run | Synthetic PDF render/text check only (#976 body) |
| H01-AC4 | Cross-account denied; delayed answer not relabeled | Not run | Synthetic two-user and delayed-response tests (#976 body); cross-account half needs a second login |
| H02-AC1 | "List ten similarly sized credit unions": 10 rows, assets, dates, no report | Run, failing | James's live run, Oct 16: "similarly sized" gives no clear asset range (B8, B10b; #1537) ([#977 results](https://github.com/Gilmore3088/FeeInsight.com/issues/977#issuecomment-6205207651)). Mapping of run steps to this case is this file's reading |
| H02-AC2 | Only 3 match: shortage explained; unknown assets not counted | Not run | same |
| H02-AC3 | "Only Florida", then "Compare their NSF fees": same list and subject | Run, failing | James's live run, Oct 16: follow-ups lose the list (B9, B9b, B10; #1538) ([#977 results](https://github.com/Gilmore3088/FeeInsight.com/issues/977#issuecomment-6205207651)). Mapping of run steps to this case is this file's reading |
| H02-AC4 | Units/periods right, missing never $0, links open, zero model calls | Not run | same |
| H03-AC1 | Hold a wrong fee: gone from comparisons, auditable, never $0/"Free" | Not run | Hold exists (#1024); no walkthrough |
| H03-AC2 | Correct, publish, institution page and Hamilton agree | Not run | Correct command not built |
| H03-AC3 | Old-source replay never brings the old value back; newer source goes to review | Not run | none |
| H03-AC4 | Stale and unauthorized writes fail; reversal keeps history | Not run | none |
| H04-AC1 | One free-text field in every state, from a non-Analyze page | Not run | Second input still present per Oct 14 comment |
| H04-AC2 | Peers, Florida, NSF, "with us": coherent across turns | Not run | none |
| H04-AC3 | Clarification in the same composer; new conversation inherits nothing | Not run | none |
| H04-AC4 | Failure, double submit, late response; phone and keyboard | Not run | #1274 unit tests for double submit only |
| H05-AC1 | Peer request: criteria and table first, no auto report | Not run | none |
| H05-AC2 | Same typography and formats across answer types | Not run | H05-T01 baseline shows three heading treatments and two table fonts |
| H05-AC3 | Long names, missing assets, wide table usable at phone width and 200% zoom | Not run | Baseline: no sideways overflow at 390px |
| H05-AC4 | Export matches saved screen; James accepts the visual change | Not run | none |
| H06-AC1 | $10 vs $35: false "charges $35/$25" not verified; $25 difference keeps inputs | Not run | Regression set cases in #1524 (synthetic, not human-reviewed) |
| H06-AC2 | -10% never "increase"; 2024 value never shown as 2026 | Not run | Regression set and contract tests (#995, #1524) |
| H06-AC3 | Missing/stale/provisional/user values distinct; $0 vs unknown; rate vs dollar | Not run | Regression set cases (#1524) |
| H06-AC4 | Reopen/export old "high" and new answer: limits shown, nothing rewritten | Not run | #995 display-normalization tests only |
| H07-AC1 | Any complaint traces to task, PR, test run, output and release SHA | Not run | This matrix covers complaint to task to PR only; no test-run, output or release-SHA links yet |
| H07-AC2 | Full signed-in research journey passes | Not run | none |
| H07-AC3 | Full admin correction journey passes in isolation | Not run | H03 workflow not built |
| H07-AC4 | Deployed SHA matches reviewed SHA; post-release checks; James's go/no-go | Not run | none |

## Acceptance case checks

Every case maps to the automated tests that exercise it on synthetic data and to one named manual check (`MC-<case>`) that a person runs on the live site or a preview. The full paths are in `HAMILTON_ACCEPTANCE_CHECKS` (`src/lib/hamilton/release-acceptance.ts`), and its test fails if this table and the code disagree on a case or a manual check id. A green automated test never marks a case passed: only its manual check, recorded with the #975 evidence template on the candidate SHA, does. The two browser journeys run locally with `npm run test:hamilton-journeys` (see `docs/project/findings/2026-10-17-hamilton-release-runbook.md`).

| AC id | Automated tests (synthetic) | Manual check |
|---|---|---|
| H01-AC1 | `research-journey.pw.ts`, `account-context.test.ts`, `workspace-context.test.ts`, `route.account-context.test.ts` | MC-H01-AC1: Signed in with a second, linked login on the live site: browse three other institutions, ask "compare with us", confirm the home is unchanged |
| H01-AC2 | `research-journey.pw.ts`, `identity-display.test.ts`, `ask-service.test.ts` | MC-H01-AC2: Live login with no linked institution: ask about "us" and confirm the answer says no institution is linked |
| H01-AC3 | `research-journey.pw.ts`, `page.test.tsx`, `analysis-identity.test.ts` | MC-H01-AC3: Live: save an answer about A, switch to B, reopen the saved answer and download its PDF; both name A |
| H01-AC4 | `research-journey.pw.ts`, `private-workspace.h01-acceptance.test.ts`, `StructuredAsk.h01-acceptance.test.tsx` | MC-H01-AC4: Live with two logins: the second cannot open the first's saved research link; switch subject while an answer loads |
| H02-AC1 | `research-journey.pw.ts`, `peer-list.test.ts`, `hamilton-peer-list.db.test.ts` | MC-H02-AC1: Live: ask for ten similarly sized credit unions; ten rows, each with total assets and a reporting date, and the size range stated |
| H02-AC2 | `research-journey.pw.ts`, `peer-list-service.test.ts`, `hamilton-peer-list.db.test.ts` | MC-H02-AC2: Live: a narrow request (one state, tight size band) says how many matched and why there are fewer than asked |
| H02-AC3 | `research-journey.pw.ts`, `PeerAwareStructuredAsk.test.tsx`, `peer-list-service.test.ts` | MC-H02-AC3: Live: list, then "Only Florida", then "Compare their NSF fees"; the fee table covers exactly the Florida rows |
| H02-AC4 | `research-journey.pw.ts`, `hamilton-peer-fees.db.test.ts`, `hamilton-peer-fees.test.ts`, `route.peer-list.test.ts` | MC-H02-AC4: Live: open each filing and fee schedule link from a peer table; no AI usage row is written for the turn |
| H03-AC1 | `admin-correction.pw.ts`, `fee-hold.test.ts` | MC-H03-AC1: Production admin, approved scope only: hold one wrong fee and confirm the institution page and Hamilton drop it |
| H03-AC2 | `admin-correction.pw.ts`, `fee-corrections.db.test.ts` | MC-H03-AC2: Preview or approved production scope: correct one fee and compare the institution page with a Hamilton answer |
| H03-AC3 | `fee-corrections.db.test.ts`, `fee-corrections.adversarial.test.ts` | MC-H03-AC3: After a correction, a re-read of the same document leaves the corrected value; a newer schedule appears under conflicts |
| H03-AC4 | `admin-correction.pw.ts`, `fee-corrections.db.test.ts`, `actions.corrections.test.ts` | MC-H03-AC4: Two admin tabs on one fee: the second save is refused; a reversal adds a history row and removes none |
| H04-AC1 | `research-journey.pw.ts`, `AnalyzeWorkspace.test.tsx` | MC-H04-AC1: Live: from Monitor and Reports, start a question and count the text inputs through clarification, answer and follow-up |
| H04-AC2 | `research-journey.pw.ts`, `AnalyzeWorkspace.conversation.test.tsx`, `conversation-context.test.ts` | MC-H04-AC2: Live: the four-turn sequence keeps one subject and one peer list |
| H04-AC3 | `AnalyzeWorkspace.conversation.test.tsx`, `StructuredAsk.test.tsx` | MC-H04-AC3: Live: a question that needs a clarification is answered in the same box; New question starts with no earlier turns |
| H04-AC4 | `AnalyzeWorkspace.double-submit.test.tsx`, `StructuredAsk.double-submit.test.tsx` | MC-H04-AC4: Phone and keyboard only: double Enter, offline retry and a slow answer leave one answer and the question kept |
| H05-AC1 | `research-journey.pw.ts`, `answer-order.test.tsx`, `PeerAwareStructuredAsk.test.tsx` | MC-H05-AC1: Live: a peer request shows criteria and the table before any prose, and starts no report |
| H05-AC2 | `css-tokens.test.ts` | MC-H05-AC2: James's visual review of a lookup, a comparison, a peer list and a written answer side by side |
| H05-AC3 | `research-journey.pw.ts` | MC-H05-AC3: Live at 390px and at 200% browser zoom: the peer and fee tables scroll inside their frame, the page does not |
| H05-AC4 | `research-journey.pw.ts`, `evidence-export.test.ts`, `board-brief.pdf.test.tsx` | MC-H05-AC4: James compares a saved answer's screen with its downloaded PDF and records his acceptance |
| H06-AC1 | `evidence-regression-set.test.ts`, `written-answer-binding.test.ts`, `narrative-bound.test.ts` | MC-H06-AC1: A person reviews the 25 regression cases' expected outcomes (#629) and one live written answer |
| H06-AC2 | `evidence-contract.test.ts`, `evidence-regression-set.test.ts` | MC-H06-AC2: Live: a fee that fell shows as a decrease with both dated inputs |
| H06-AC3 | `research-journey.pw.ts`, `evidence-regression-set.test.ts`, `hamilton-peer-fees.db.test.ts` | MC-H06-AC3: Live: a peer fee table with a $0 fee, a rate fee and an old source shows each as itself |
| H06-AC4 | `research-journey.pw.ts`, `actions.h06-reopen.test.ts`, `confidence-legacy.test.tsx` | MC-H06-AC4: Live: reopen a saved answer from before Oct 10 and download its PDF; its limits show and its text is unchanged |
| H07-AC1 | `release-acceptance.test.ts` | MC-H07-AC1: A reviewer follows one complaint in the matrix document to its PR, CI run, inspected output and deployed SHA |
| H07-AC2 | `research-journey.pw.ts` | MC-H07-AC2: James's live computer-use run of the research journey on production, with the deployed SHA recorded |
| H07-AC3 | `admin-correction.pw.ts`, `fee-corrections.db.test.ts` | MC-H07-AC3: An operator completes hold, correct and reverse on a preview database without SQL or code |
| H07-AC4 | none | MC-H07-AC4: Record the deployed SHA, run each initiative's read checks, and record James's research-only go/no-go |

### James's live run, Oct 16
James ran the #976 (A1 to A7b) and #977 (B8 to B12b) steps on production. Failed: A2, A3a, A3b, B8, B9, B9b, B10, B10b, B11c; B11b partial. The failures are filed as four issues: A2/A3 as #1536, B8/B10b as #1537, B9/B9b/B10 as #1538, and B11b/B11c as #1539. Other findings from the run are #1540 to #1546, including the peer group changing within one answer (#1544). The run also showed React error #418 about 20 times (#1541) and all network requests returning 200. Results: [#976](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6205206816), [#977](https://github.com/Gilmore3088/FeeInsight.com/issues/977#issuecomment-6205207651).

### Release protections, Oct 16
Read-only, from the public GitHub API and `.github/workflows/test.yml` on `main`:
- `main` reports `"protected": false`; `rules/branches/main` returns `[]`. No check is required to merge.
- `test.yml` ignores `**/*.md` and `docs/**`, so a docs-only PR runs no `app-tests`. If `app-tests` is ever made required, docs-only PRs would wait on a check that never runs.
- `app-tests` needs `checks`, `unit`, `knox-gates` and `e2e`; `fee-audience-sql` is not among them, so it can fail while `app-tests` is green.
- No signed-in Hamilton browser journey runs in CI (H07-T03, T05).
No setting was changed. Making `app-tests` required is a permissions change and waits on James.

## Release blockers

| # | What stops a release today | What would clear it |
|---|---|---|
| B1 | No acceptance case of the 28 has passed on a preview or live build. | Run each case on one candidate SHA and record results with the #975 evidence template. |
| B2 | Live H01 cases need a second, linked login (AC1 linked half, AC4 cross-account half). The Oct 15 checklist says none is available to the thread. A synthetic Space Coast Viewer membership was granted to test user 25 on 2026-10-10 (#976 comments), but no credentials reach the thread. | James runs those halves with the second login, or names a tester who has it. |
| B3 | H03 correction workflow is not built. James answered the four T01 questions on Oct 16 (see scope changes). | Build T02-T12 (in progress, branch `acct2/978-fee-corrections`); its migration waits for James's yes; run H03-AC1 to AC4. |
| B4 | H04 one-composer work (T03, T04, T06) is not done. #979 was reopened on Oct 16. | Build T03, T04 and T06, then run H04-AC1 to AC4. |
| B5 | H05 has no presentation contract; it needs James's design review via #1284/#1368. | James approves a contract; build T03-T07; run H05-AC1 to AC4. |
| B6 | H06-T10 has not run: no live acceptance of bound answers, old-answer display or export parity. | James's live checks in #1726 (sections 1 and 2). |
| B7 | H02-T08 export parity and paging past 50 are not built; the proposed half-to-double asset default awaits James's review. | Build or formally defer them (dated, James-accepted); James decides the default. |
| B8 | Cleared. Read 2026-10-19 (REST): `main` has a ruleset blocking deletion and force-push and requiring status checks (#1642 closed). | None. |
| B9 | Most H01, H02, H04 and H06 code is already merged to main, and merged PRs deploy. James decided on Oct 16 that the production version is the release candidate (see scope changes). | Run the read checks per initiative against production, recording the deployed main SHA with each result; James's live computer-use check covers the signed-in cases. |
| B10 | Cleared. Read-only production check, Oct 16: the `hamilton.rules_recheck` flag on #121441 was cleared (`takedown_cleared` and `flag_cleared`, 2026-10-11 04:26 UTC), and #121441 is live in `published_fee_catalog`. The repeat #121442 was retired as a `same_line_duplicate` on 2026-10-11 01:08 UTC. NSF #121439 and #121440 are both live. | None. |
| B11 | Cleared on `acct2/hamilton-h07-release`: `src/lib/hamilton/release-acceptance.ts` version 2 keeps only stable ids and case checks; this file is the one matrix for status. | None. |
| B12 | No James research-only go/no-go decision exists. | H07-T10 after B1-B11. |

## Scope changes

No formal scope change accepted by James under #975 protocol step 7 is recorded. These dated changes to how work or acceptance runs are recorded:

| Date | Change | Source | James-accepted? |
|---|---|---|---|
| 2026-10-10 | #989 superseded by #993, then #993 superseded by #985; landing parity folded into H01 PR #985. No case dropped. | PR titles #989, #993 | Not recorded |
| 2026-10-11 | #974 containment carried into #995; #974 closed unmerged. No case dropped. | [#981 comment](https://github.com/Gilmore3088/FeeInsight.com/issues/981#issuecomment-6096486443) | Not recorded |
| 2026-10-11 | Tester clarification: James is the human tester and not a Space Coast employee. A synthetic Space Coast affiliation is used only for the home-vs-research case. No case dropped. | [#976](https://github.com/Gilmore3088/FeeInsight.com/issues/976#issuecomment-6108676603), [#977](https://github.com/Gilmore3088/FeeInsight.com/issues/977#issuecomment-6108676999) | Yes (recorded as James's clarification) |
| 2026-10-14 | #979 (H04) closed as "completed" by #1272 with most tasks open. Not a recorded scope change; treated here as open. | #979 state | No |
| 2026-10-15 | H05 design work routed to #1284 and the Pro beta (#1368); H03 to be scheduled with #1115 and #1122. Ownership and order only. | [#980 triage](https://github.com/Gilmore3088/FeeInsight.com/issues/980#issuecomment-6190406423), [#978 triage](https://github.com/Gilmore3088/FeeInsight.com/issues/978#issuecomment-6190405822) | Not recorded |
| 2026-10-15 | Blockers #1005 (browser credential state) and #1006 (intake WIP cap) closed, both as "not planned". The underlying need for live acceptance stays (B1, B2). | #1005, #1006 state | Not recorded |
| 2026-10-16 | James accepted the defaults for H03-T02: a correction is a new version and the old one is kept as superseded (a new table, so a migration that waits for his yes); only admins correct, analysts can still hold; a correction needs a source excerpt and its location, not a reason alone; a hold rebuilds Hamilton's national index straight away. | Decision card in the Hamilton lane thread, Oct 16 05:00 UTC | Yes |
| 2026-10-16 | Release checks: #979 reopened (B4); main protection plan approved (B8); H07-T08/T09 treat the production version as the release candidate and run read checks per initiative (B9). No case dropped. | Same card | Yes |
| 2026-10-19 | #981 (H06) and #982 (H07) closed at James's request. No task or case dropped: the open items (H06-T10, H07-T05, T07 fault injection, T08 to T10, gates #1921, #1925, #1926) are checklist lines on #975, and this file stays the status record. H06-T09's human review is replaced by the weekly live check (James, 2026-10-19: no manual fee or answer-key checks). | [#981](https://github.com/Gilmore3088/FeeInsight.com/issues/981), [#982](https://github.com/Gilmore3088/FeeInsight.com/issues/982) | Yes (James asked to resolve both, Oct 19) |

## Change log

- 2026-10-16: first version.
- 2026-10-16 (.2): added James's live run of the #976/#977 steps (H01-AC2, H02-AC1, H02-AC3 now "Run, failing"), and the Oct 16 release-protection read (H07-T06, B8). H02-T01 moved to "In progress" (no matrix document found).
- 2026-10-16 (.3): James's Oct 16 decisions on H03-T02, B4, B8 and B9 recorded as scope changes; B3, B4, B8 and B9 updated; B10 cleared by a production read.
- 2026-10-17 (.1): B11 cleared: `release-acceptance.ts` version 2 holds ids and case checks only. Added "Acceptance case checks" (each case's automated tests and its named manual check). Statuses refreshed from the 2026-10-17 audit (#1569, #1604, #1623, #1636, #1649, #1678, #1705). H03 rows rewritten after #1649. H07-T01 to T04 and T07 now in progress, with the local journey run of Oct 17. The protection read was repeated on Oct 17.
- 2026-10-19 (.1): #1705 merged on 2026-10-17, so H06-T03/T04/T06/T07/T08 and H07-T01 to T04 move to "Merged, not accepted". H07-T06 done and B8 cleared (ruleset on `main`). B6 narrowed to H06-T10. #981 and #982 closed; open items carried to #975.
