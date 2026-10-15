# Hamilton preview implementation receipt

Date: October 11, 2026. Canonical issue #1010, draft PR #1011, branch `fix/1010-hamilton-unified-workspace`.

This redesign is preview only. James explicitly requires visual review before any merge into main or production promotion. Standing routine-fix merge permission does not apply to this redesign.

## Implemented

- One shared navy/teal workspace with dedicated Ask Hamilton and Research navigation, responsive mobile menu and separate server-derived account/research identities.
- A simple Ask entry: one composer, three starters, recent saved work. Geographic research opens this composer without putting a dashboard above it. Validated state/national scope, institution type and fee categories survive the provider request and saved answer. Navigation never automatically sends a geographic provider request.
- National/state fee comparisons and financial, economic, complaint and regulatory Research views using existing governed readers. Original institution briefing and local-market views remain reachable. Each exhibit exposes sources, reporting periods, geography, coverage and method.
- A saved answer can become an editable board brief. Edit title and a separately labeled team note, optionally include the original evidence, save/reopen and export through the existing PDF endpoint. Findings, sources, institution identity and record-bound evidence remain frozen; conversion makes no new AI request.
- H06 evidence branch #995 integrated alongside inherited H01/H02/landing work. Existing parent branches and historical reports preserved. No schema migration, public-site redesign, production-data mutation, provider activation or security-setting change.

## Verification of implementation tree ac322a97db86529a6ee27b2599c4786caff8959a

Runtime implementation head on GitHub: `0a74884eb62761dbbaea4ab27a71cb56fc57bfbd`. This receipt-only commit does not change runtime code.

| Check | Result |
| --- | --- |
| Full Vitest suite, UTC, maxWorkers=4 | 647 files passed, 3 skipped; 5,920 tests passed, 12 skipped |
| Agentic suite | 65 files passed, 1 skipped; 1,153 tests passed, 3 skipped |
| TypeScript | Passed |
| ESLint | Passed; 0 errors, 39 warnings |
| Legacy/contract guards | Passed |
| Next.js production build and admin route postbuild | Passed; 12 canonical admin routes verified |
| Isolated synthetic Vite fixture build | Passed; bundle-size advisory only |
| Actual PDF renderer | Board title, home/subject names, original values/source date and team note verified through extracted PDF text |
| Repository intake at implementation head | Passed |
| Browser design QA | Blocked by this session's browser-access policy; no visual acceptance claimed |
| Authenticated live save/reopen/PDF | Outstanding; unit fixtures do not establish live acceptance |

UTC was used because existing regulatory date-parser tests depend on process timezone. The first full run exposed the redesigned navigation assertions and older report layout; both were corrected. The PDF test specifically caught omitted evidence in the older renderer layout and now verifies the answer-first layout with the appendix and source notes.

The local build has no established live database connection; public static readers reported unavailable-data warnings while compiling successfully. This is not evidence of populated or fresh production coverage.

## Review limits

State financial aggregation and comparable geographic complaint trends remain unavailable; those views explain the gap and link to institution research. National financial totals combine banks and credit unions and explicitly disclose independence from the fee-landscape charter selector. Regulatory cards retain publisher scope and do not claim selected-state filtering or legal applicability. Maps and deeper drilldown continue through existing local/institution views; a new national geographic map and a same-period multi-series economic chart are follow-up presentation work.

The board editor currently edits presentation title/team commentary and inclusion of its single evidence appendix; multi-finding selection, reordering, and citation-aware factual editing remain follow-up work. Named peer-list history remains dependent on #988 acceptance. No live provider, bank dataset or authenticated account acceptance was exercised.

## Preview deployment

The first automated Vercel deployment was intentionally ignored by the repository's existing build policy. A receipt commit containing `[preview]` uses that policy's supported opt-in for a non-production branch. Do not change production aliases, environment values, preview protection, cron configuration or the production branch.

See project-root `design-qa.md` for the blocked visual gate and the original six references in `references/`. Keep PR #1011 draft until visual and authenticated checks pass; production still requires James's explicit approval.
