# H01 institution identity reconciliation (#976 / #985)

Owner: ChatGPT under James's explicit H01 completion assignment, 2026-10-10.
Reconciled parents: H01 563e23f29392b20470615a41bbad19db4169e7d4 and
landing #993 19bc0f777ef0fb20b3ffe67406394a72ab0e36f4. Dependent #988 is
preserved separately; no duplicate implementation PR or production data changes.

## Contract and persistence

Account identity comes from current authenticated canonical memberships on each
request. Explicit research subjects win; browsing and ordinary GET navigation
never save a research preference or grant membership. Missing, ambiguous and
unavailable account identity remain explicit. Settings retains the existing
explicit server action for preference selection.

Structured builders name the subject directly in their templates. Written
answers receive separate research and account evidence roles. An explicit
comparison with us reads canonical public home data or displays a limitation;
private memory remains user plus research-subject scoped. No generic traversal
rewrites old prose or generated output.

Versioned identityContext records subject/account IDs and names, selection source,
and original peer ID/label/source/fallback when available. Saved memo, report UI
and PDF use frozen artifact evidence, rather than today's peers or institution
selection. Legacy missing context is disclosed and never backfilled from current
settings. Client metadata is reference information, not an access grant; report
basket saved IDs are reloaded through authenticated user-scoped storage.

## Reproductions and regression evidence

Four controlled delayed-response cases originally failed: subject switch, retry,
unmount, and old memo callback. Conversation keys and request lifetime guards now
prevent these writes into the replacement view. Nine synthetic two-user boundary
cases execute actual saved/report/PDF/memory/upload handlers and verify denial.
Actual React PDF rendering and text extraction retain original A, home, and cohort
labels; page images were inspected. These checks are not live account acceptance.

The local-market empty-result test fixture initially omitted its market metadata;
focused and full runs reproduced the failure. Adding the actual named-market
shape preserves the empty-fee assertion; all 27 route scope cases then passed.
A cold dynamic PDF test import exceeded the default timeout twice; moving imports
to test setup fixed it without extending the timeout. Receipts are logged in #976.
Repeated build issues are logged in #1003 (remote Google fonts) and #1004
(external dependency symlink). Their narrow corrections preserve font design,
licenses, dependencies, and build configuration.

## Acceptance and release boundary

| Case | Automated execution | Live release requirement |
| --- | --- | --- |
| H01-AC1 | Named research/home comparison, canonical home evidence, no preference writes | Authorized Space Coast CU account visits three subjects and compares with us |
| H01-AC2 | Unlinked/ambiguous identity; explicit subject; neutral templates | Account without canonical home visits explicit subject and checks actual answer |
| H01-AC3 | Frozen saved answer/memo/report/PDF subject and peers; legacy disclosure | Save A, switch to B, reopen A and download both exports |
| H01-AC4 | Cross-user storage/route/memory/upload denials; delayed request isolation | Two authorized test identities complete account-switch and private-artifact checks |

Exact-head CI, normal preview build, authenticated desktop/mobile and actual
model-output acceptance are release gates. Synthetic assertions do not substitute
for those checks. GitHub #976 and PR #985 hold the final head/run receipts and exact
remaining blockers. Do not close H01 or merge until every gate passes; H07 records
deployed SHA and post-release results.
