# 2026-10-10: Local comparisons silently discarded the requested fee scope

Status: implemented on an isolated draft branch; not integrated, released or accepted end to end.
Coordination: #984/#987. Hamilton tracker: #975. Acceptance work item: #982 (partial H07-T02/T03/T07).
Implementer: ChatGPT, the approved landing-page/Hamilton continuation. Existing owners retain their work.
Base: `1b5de13cd5b2e61ff6ca64047222b6c90888d39b`.
Branch: `fix/hamilton-landing-scope`.

## Reproduced boundary

The existing local-market route read only institutionId and accepted malformed/extra fields by
ignoring them. The service's own-fee query, peer read and returned category list all used the
same fixed overdraft/NSF-led list. A caller could request paper statements and receive a
successful answer about unrelated categories. An explicit unresolved subject could also be
replaced by a resolver default without this route checking that it was the requested subject.

The approved homepage is broad market research. Its featured categories are cashier's checks,
paper statements, money orders and stop payments with equal prominence. Overdraft/NSF are not
featured. This is not an instruction to delete those categories or remove them from other
existing product workflows. Keep the approved pricing/UX design and headline:
"Your next fee review doesn't need to take weeks."

## This bounded implementation

- Add a canonical-category parser and homepage local-request adapter; keep legacy defaults only
  for callers that omit category selection. Validate against the existing FEE_FAMILIES, not a
  parallel taxonomy. Preserve order and deduplicate; reject invalid, empty, sparse or oversized lists.
- Wire the parser into the existing authenticated, policy-wrapped local-market API. Reject
  malformed JSON, invalid explicit institution IDs and unsupported scope. Authentication and
  premium checks remain; no provider work, extra endpoint, new screen, schema or billing change.
- Require an explicitly requested institution to equal the resolved subject before analysis.
  Keep persistUrlSelection:false. This check does not replace H01's account/subject contract.
- Pass the selected categories through the service, own-fee SQL, peer reader and response.
  Filter out unexpected categories from both sides. Preserve real zero values and missing keys.
- Preserve map, branch, geographic-boundary, coverage and source behavior. The API is still a
  local branch-market query, NOT a national/state query or a new independently verified dataset.
- Add parser, actual-handler and actual-service tests with synthetic dependencies. Existing
  test files and CI gates remain untouched.

## Verification boundary

Local isolated Node checks: 111 passed, 0 failed, executing the actual transpiled modules with
synthetic auth, database, geometry and response boundaries. The same checks with the original
route/service: 98 passed, 13 failed. The two original files were hash-verified against GitHub
before editing. The local checker is not repository Vitest or an authenticated browser.

Repository tests added:

```
npx vitest run src/lib/hamilton/local-market-request.test.ts \
  src/lib/hamilton/local-market-answer.scope.test.ts \
  src/app/api/hamilton/ask/market/route.scope.test.ts
```

Full current-head CI, typecheck, lint, architecture guards and existing database pipeline tests
must pass. CI results belong to their exact commit; attach the final receipt to the PR and
#982. Do not infer a live fee-quality or user-workflow pass from synthetic tests.

## Integration and ownership gates: still open

| Journey | Implemented here | Missing before advertising the live journey |
|---|---|---|
| Local competitors | Explicit category contract, API and service propagation; explicit-subject mismatch guard | Existing Ask frontend must pass the restored scope; actual map/list/evidence consistency and bank/CU browser acceptance |
| National/state explorer | Local endpoint refuses unsupported geography rather than misrepresenting it | Governed national/state reader, all 50 states + DC/type/category context through login, refreshed snapshot disclosure and real Hamilton output |
| Board report | No report-generation changes | Carry research scope to existing report action; authorized, idempotent saved artifact; reopen/download/source parity |

The homepageLocalMarketRequest adapter is not wired into the current frontend in this slice.
Do not claim homepage clicks now work. Generic legacy calls still use the old defaults; the
homepage caller must explicitly opt into the new selection. Unsupported state/charter/snapshot
fields produce a 400 here; they must be routed to the proper research workflow, not dropped.

Do not edit or take over active #985 account/context/Analyze paths, H02's peer-list and
StructuredAsk work in #977, #986 shared data readers, #939 design or #810 PDF output. Coordinate
frontend integration on the existing Ask path; do not introduce a second chat, theme or report
engine. Recheck branch heads/diffs immediately before integrating.

Specific evidence dependency: this patch does not fix the existing ownFees raw percentile
query's audience/frequency/source eligibility or its generic source labels. Reconcile that
reader with the governed statistics/source contracts under #986/H06 before calling the demo
source-verified. Do not confuse registry branch/asset data with evidence for fee amounts.

## Required acceptance evidence

- Exact homepage request -> authenticated restored selection -> handler and governed data query
  -> rendered result, with matching institution/category/geography/type/snapshot context.
- No default institution replacement; no OD/NSF substitution for a homepage category selection.
- Invalid scope, missing evidence and failed dependencies produce honest, actionable states.
- Login, subscription gate, refresh/back, expired sessions and retry preserve the request without
  duplicate paid execution. This read-only API patch does not establish that protection elsewhere.
- A board-report request yields a real saved/reopenable/downloadable draft, not generic prose.
- Actual desktop/mobile/keyboard and export checks on an authorized preview at the reviewed SHA.

All twelve landing acceptance cases in the approved delivery checklist remain required. None
is marked fully accepted by this partial implementation. No production database/provider calls,
fee changes, merge, release, permission changes or deployment were performed.

## Rollback

Revert this isolated change. There are no migrations, new durable records, paid calls or schema
changes. Preserve the tests and incident evidence when reconciling with later implementations.
