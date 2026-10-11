# Engineering baseline and reconciliation

Baseline main: 483f445aa9d4eae766ecd60e1c85103a094759a6. This is a source inspection, not a production acceptance audit.

## Existing entry points

| Area | Existing source | Finding / intended work |
|---|---|---|
| Landing | src/app/pro/page.tsx; src/app/pro/(hamilton)/hamilton/page.tsx | /pro currently redirects to /pro/hamilton. Retain compatible URL; evolve it to Intelligence Overview. |
| Shell | src/components/hamilton/layout/HamiltonShell.tsx; src/app/pro/(hamilton)/layout.tsx | Current shell uses ConsumerNav plus docked Ask, explicitly no sidebar. New design deliberately supersedes this presentation. |
| Navigation | src/lib/hamilton/navigation.ts | Old This month / My fees labels and dock assumptions differ from agreed sidebar. Centralize new labels; do not leave competing nav definitions. |
| Ask | src/app/pro/(hamilton)/analyze/page.tsx; src/components/hamilton/analyze/AnalyzeWorkspace.tsx; StructuredAsk.tsx | Existing hydration/reopen and task-specific paths; redesign entry/rendering and preserve contracts. |
| Request/context | src/lib/hamilton/request-contract.ts; workspace-context.ts; institution-context.ts; institution-briefing.ts | Shared audience/intent/evidence contract exists. Home/subject identity must integrate H01 current work, not be reinvented from main. |
| Provider boundary | src/app/api/research/hamilton/route.ts; src/lib/research/; src/lib/ai-provider.ts | Reuse governed execution/usage/stop controls; no parallel chat/provider client. |
| Research URLs | src/app/pro/(hamilton)/research/page.tsx; data/market/categories/districts/news | /pro/research remains a compatibility redirect. Visible Research navigation needs a real approved destination using/combining current routes, not breaking redirect rules casually. |
| Report reuse | src/lib/hamilton/report-basket.ts; src/components/hamilton/basket/AddToReportButton.tsx | Existing finding basket is a reuse candidate; inspect data/persistence semantics before extending it. |
| Reports/PDF | src/components/hamilton/reports/ReportWorkspace.tsx; ReportOutput.tsx; AnalysisPdfDocument.tsx; src/app/pro/(hamilton)/reports/actions.ts | Existing report creation includes addedFindings; PDF uses /api/pro/report-pdf with saved report ID. Existence is not end-to-end verification. |
| External sources | src/lib/regulatory/fdic.ts, ncua.ts, cfpb.ts, census-acs.ts, ncua-branches.ts; src/lib/hamilton/workspace/economy.ts | Source modules exist; audit population, freshness, period, units, coverage and call sites before promising exhibits. |

## Active work must be reconciled before runtime edits

Fresh GitHub PR metadata inspected in this session. These are open drafts; descriptions report evidence that needs independent review, not accepted production behavior.

| PR | Inspected head | Relevance |
|---|---|---|
| #985 | e176a79841ed2fd3b95b011272fb502755747d03 | Identity, artifacts, saved/reopened subject, navigation; includes inherited landing work. |
| #988 | 283962225f89939b2fb59eaf34a267ab269dd1b5 | Peer lists and selection saving, stacked on #985. |
| #993 | 19bc0f777ef0fb20b3ffe67406394a72ab0e36f4 | Landing-to-Analyze context, maps, governed comparisons and confirmed report drafts. |
| #995 | 4b40b14f06947740a5948304025a379cdb915568 | Record-bound evidence and confidence containment. Head differs from an older body SHA; refresh/check exact head. |
| #810 | 7f752798b3f6bb548f500d07bac3b034128c9211 | Saved Ask PDF chart rendering. |
| #939 | 23c469d88b4783546b51145dc98c3d063b4e6890 | Shared/public styling; open conflict and presentation overlap. Public-site changes are outside this redesign. |

Canonical coordination: #984. Reliability parent #975 and H01–H07 stay intact; this redesign expands beyond the bounded reliability work. Capture a separate scoped experience intake or explicitly amend scope, preserve existing owners/branches and accept or supersede overlapping work with receipts. Do not create another anonymous implementation or mark prior tasks complete from new mocks.

Main checkout is not assumed to contain these draft fixes. Work from pinned refs and compare actual diffs. No merge/rebase/overwrite of owned branches performed in this preparation.

## Proposed integration model (not implemented schema)

Assignment carries authorized home institution, independent research subject IDs, geography, charter/asset filters, peer set/snapshot, selected fee categories, per-dataset periods, conversation/turn identity, result references and evidence policy.

A finding carries a stable ID, direct answer, observed/derived evidence IDs, interpretation, applicable limitations and relevant exhibit references. Report selection references those same findings/exhibits and preserves the saved context. Reuse/extend established types and stores; do not create a parallel model simply to match these words.

## Implementation verification

Required repo checks: npm run guard:legacy; npm run test:agentic; npx tsc --noEmit; npm run lint; npx vitest run; relevant build/browser and actual database tests where needed. No tests were run in this preparation because no runtime code changed.

Acceptance uses a real premium non-admin test account, with separately verified institution access; admin view-as is not sufficient. Sources, real save/reopen/PDF and identity isolation must be checked on the exact candidate build at mobile and desktop widths. Fixture render success is separate from live data verification.

Existing source/agent contracts, authentication, billing, evidence policy, old saved records and run-ledger lineage must remain recoverable. Any schema migration, production data/security change or paid-provider activation needs its separately applicable authorization and evidence. Do not interpret an end-to-end rebuild request as an instruction to drop tables or reset production.

## Preparation receipt

- GitHub repo access verified (admin/push metadata); clone of main succeeded using public GitHub URL.
- Local planning branch: design/hamilton-unified-workspace-20261011.
- Read root AGENTS.md, CLAUDE.md, docs/project/BACKLOG.md, latest available checkpoint 2026-10-08, src/app/pro/AGENTS.md, #984/#975 and current PR metadata.
- No runtime changes, remote pushes, merges, deployments or production mutations in this preparation.
- Next engineering work: canonical scope/ownership reconciliation, then shared shell and first Ask-to-board-brief implementation.
