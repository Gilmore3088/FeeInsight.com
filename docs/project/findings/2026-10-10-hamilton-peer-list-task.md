# Peer lists are a separate task, not an implicit fee report

Related: #975, #977 (H02). Base: `a276969d2bd8b458b09b17c232f1dc1d60ba5d3d`.
Branch: `fix/hamilton-peer-lists`, stacked on draft #985's
`fix/hamilton-institution-context`. No merge or production release is authorized.

## Reproduced gap

The existing segment path asks about one fee; a segment without a named fee can
be defaulted to overdraft. The separate local-market response contains branches,
deposits and fees, but no dated total-asset field. Neither is a reliable contract
for 'List ten similarly sized credit unions'. Registry/segment sizes use thousands;
`institution_financial_records.total_assets` is already whole dollars. Multiplying
that field again would be wrong. The new path consistently uses dated dollar assets.

## Delivered scope

- Classify supported institution-list requests separately, ahead of the existing
  fee Ask service and client prose fallback, using the same authenticated Ask API.
  No new endpoint, provider, question field or fee data source is introduced.
- Keep explicit fee/report questions on the existing path. Preserve the existing
  plain local-competitor view (including 'Who are my local competitors and where
  are they?'). Combined branch-market/asset constraints remain unsupported by this
  addition; they return guidance, not an invented geographic selection.
- A finite list grammar supports counts, institution type, full US state names and
  codes, multiple states, same state, asset bounds/ranges and largest/similar-size
  selection. Strict versus inclusive bounds remain distinct. Unknown/negated
  filters and named-bank resolution requests are not silently ignored.
- Generic peers use the authorized active saved set when available. Explicit
  criteria override defaults; an explicitly requested saved group retains all
  its filters. Empty/conflicting/unavailable saved sets never become nationwide
  fallback groups. Existing user-scoped saved-group reads are reused.
- With no saved set or explicit asset band, asset-size peers use a clearly disclosed
  half-to-double band around the research subject's dated assets and matching type;
  rank by proportional distance, then name/ID. This is a proposed default selection
  rule, not a claim of industry-standard peer methodology; James still reviews it.
- Plain lists of banks/institutions do not acquire an unstated similarity restriction.
  Generic lists use the research subject. Explicit 'my/our peers' uses H01's active
  account identity; ambiguous/unlinked/unavailable accounts are not guessed.
- Retrieve the latest nonfuture financial record for the institution's actual
  source type (FDIC for banks, NCUA for credit unions), then apply asset filters.
  Do not fill a missing latest asset amount from an older filing or from deposits.
  One statement supplies the eligible count and page from the same SQL snapshot.
- Peer eligibility is independent of published fee coverage. Both dollar and rate
  catalog presence count as coverage; neither contributes fee amounts or excludes
  an otherwise eligible institution. Subject exclusion, unique rows and stable order
  are explicit. The page is capped at 50 with actual totals and truncation notices.
- Each row preserves canonical institution ID/type/location, whole-dollar assets,
  filing date, regulator, financial record ID, recorded official source link when
  usable, and inclusion/coverage labels. A missing link is explicitly unavailable,
  never synthesized. Latest stored does not mean live-verified or synchronized.
- Render the institution table first with concise criteria, sources, null/zero
  distinctions, sortable displayed rows and keyboard-scrollable mobile overflow.
  A recognized list error stays an error/guidance state with retry; no paid report
  or memo fallback is invoked. Stale requests are aborted/ignored on context changes.
- Record an existing Pro activity receipt with scope/counts and provider_called=false.
  This receipt is not a saved analysis or mutation of the user's peer group.

## Verification and boundaries

Local pre-push checks execute the actual TypeScript test files through a portable
Node assertion/mock adapter: 59 pure parser/selection tests, 14 store/mapping tests,
16 service tests and 9 API-boundary tests, **98/98 passed**. These are not Vitest,
React browser rendering, production database execution or a live model test.
Strict standalone checking of the pure module passes with a declared external
ActivePeerSet interface. TS/TSX syntax transpilation is not an application typecheck.

Ten real Vitest/jsdom component tests are added for the list, source/date/null
presentation, sorting, no fallback, retries, cancellation, legacy delegation and
keyboard region. Eight real PostgreSQL tests exercise the actual subject/list SQL,
strict bounds, count/limit, latest-correct-source selection, missing assets, independent
fee coverage and empty results. They use temporary tables on a separate loopback-only
connection. The existing CI database step now runs them beside the pipeline tests;
they skip during the ordinary suite when E2E_DATABASE_URL is absent. No production
connection is permitted, and skipped SQL tests must not be reported as passed.

Those React/PostgreSQL suites cannot run in the current local environment. Actual
repository CI, query behavior and their exact pass/fail/skip outcomes must be
recorded on the pushed commit. Modified baseline files were verified by Git blob
hash before patching. The local reproduction/evidence bundle retains inputs, tests
and failed harness diagnostics where applicable. No production read/query timing,
authenticated browser layout check or PDF-content inspection has been performed.

## Not complete / next work

H02-T08 is not implemented: no durable saved peer-list snapshot, exact-list pronoun
refinements, report/export round-trip or pagination beyond the first 50. The UI says
so rather than presenting unsupported buttons. Restating explicit criteria starts
a new list. Combined list-plus-fee questions still follow the existing fee-analysis
path; they are not claimed as fixed. Extended local/radius/branch-market lists need
separate, evidence-backed integration; the existing plain local view is preserved.

Named institution resolution, synchronized-quarter selection, source-link reachability,
live query performance and authenticated mobile/desktop acceptance remain outstanding.
A table's explicit account subject does not certify that every surrounding parent
header/follow-up path has completed H01 integration. Structured prose/memo account
identity work remains in #976. Proposed default methodology and presentation require
review; no entire H02 task/initiative release checkbox is accepted from code alone.

No migrations, fee edits, private-data grants, new schedules or paid provider calls.
The only workflow change adds isolated SQL verification to the existing test step.
Keep the PR draft and do not merge its parent branch or deploy automatically.
