# H01 live preview acceptance and remaining blockers (#976)

Owner: ChatGPT; reviewed preview SHA 0a3e2b0ceb34640845b1c9a21543663b09ee9e8b,
Vercel dpl_2bWXbFpSR8LpCUWGTA7mmYJEk19a, READY on 2026-10-10 UTC.
Normal branch access and secure sign-in succeeded. No bypass link was used.

## Context flow matrix

| Boundary | Account reference | Research subject | Saved/peer identity | Private access |
| --- | --- | --- | --- | --- |
| Analyze page/shell | Current canonical memberships | Explicit URL; reopened saved A wins conflicting B | Frozen answer snapshot; legacy remains unknown | Saved lookup authenticated user |
| Structured Ask | Fresh authenticated memberships | Explicit canonical subject wins | Original peer ID/label/source and fallback | Memory/decision user plus subject |
| Local market route | Fresh memberships after authentication | Strict local handoff or canonical explicit ID | Named original market basis/label | Premium route; no ownership from ID |
| Written answer | Fresh memberships and separate public home evidence role | Parsed explicit subject; sole linked default only if absent | Server metadata and saved response snapshot; unknown unnamed cohort | Auth/quota/provider gates preserved |
| Saved memo | Original snapshot; current membership grants no old access | Frozen saved subject and evidence | Original storyline; no current peer reload | Preflight and atomic user plus subject predicates |
| Saved report basket | Reload original server record | Saved A validated against selected report subject | Original snapshot and original finding text | Saved analysis user scope |
| Report/answer PDF | Original artifact account metadata | Original subject/name | Original cohort/evidence; explicit legacy unknown | Authenticated user-scoped saved lookup |

## Live execution and correction

The available signed-in account has no canonical institution membership. Opening
instId=8109 displayed Researching: Space Coast Federal Credit Union, Account
institution: not linked. Asking how its overdraft fee compares with us produced
that named subject, named peer baseline and an explicit withheld-home comparison.

The public income exhibit nevertheless showed YOUR OWN FIGURES on two NCUA filing
cards. This was reproduced in the rendered UI and focused component assertions.
The before screenshot is ../acceptance/h01-2026-10-10/ac2-before.jpg. The narrow
correction changes direct public-source/chart/report captions to the frozen
research name or a neutral research institution label. Actual private user input
retains its proper label; third-party institution names and old prose stay intact.

The final dependency integration also reproduced saved-view reset failures twice:
New question cleared the frozen identity but retained the immutable saved storyline,
memo and export button, and left a false legacy-context notice. Reopened artifact
display is now limited to the original conversation; starting over removes that
artifact and notice. Two reset regressions cover the original named snapshot and
the subsequent absence of old content, memo and export. Receipts are in #976.

A related delayed fallback-save race was also reproduced twice. The installed
AI SDK does not await the async completion callback; an old successful save could
replace a newer answer's PDF ID, or its failure could add an incorrect save error.
Accepted asks and resets now advance a generation; post-save callbacks must still
match it. Both actual PDF-request-ID and stale-error regressions pass with the
reset and controlled delayed-request tests: 20 tests, scoped lint zero errors.

Final integration includes current main 483f445aa9d4eae766ecd60e1c85103a094759a6,
merged cleanly after reviewing its 20 new commits. Crew execution/receipts and
the audited Pinnacle duplicate fix are retained. Main's preview queue policy is
also retained; the final reviewed commits use its documented [preview] opt-in.

The requested PDF download then failed before interaction because retained native
credential state was restricted. Existing-tab recovery and explicit navigation to
the retained origin repeated: Browser observation is unavailable because native
credential state cannot be safely resumed. Exact receipt is GitHub #1005. No new
runtime/tab, secret extraction or alternate authentication path was attempted.

## Gate state

| Case | Completed proof | Remaining live gate |
| --- | --- | --- |
| H01-AC1 | Synthetic canonical home/subject comparison and no-write assertions | Existing authorized synthetic Space Coast home account plus three other subjects |
| H01-AC2 | Live named unlinked subject and comparison withholding; direct public-caption regression fix | Recheck corrected final head, including actual written answer |
| H01-AC3 | Actual rendered PDFs and saved A/B/A/report-basket regression tests | Live saved reopen and downloaded answer/report PDFs after browser recovery |
| H01-AC4 | Two-user private boundary and controlled delayed subject/retry/memo tests | Second authorized test identity and live delayed navigation/account switch |

Local clean normal build passed compilation, application TypeScript,74staticpages,
optimization and12normaladmin-route checks. Full exact first-head Actions run
38086083058 passed, including isolated database pipeline and fee-audience SQL.
Caption corrections require new exact-head CI and preview checks. Their final
receipts live in #976/#985; dependent #988 retains separate CI and actual eight
peer SQL cases. No full live acceptance, merge or release is claimed. H01 stays
open until every gate and H07 deployed-SHA/post-release evidence pass.
