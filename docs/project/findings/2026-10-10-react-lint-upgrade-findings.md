# React lint-policy upgrade findings remain open

Observed while testing R01 / issue #983, base commit 1b5de13. The optional upgrade
from eslint-config-next 16.1.6 to 16.4.0 reports 27 errors and 38 existing warnings.
Evidence: GitHub Actions run 37994232245, job 114036020593, lint step. The security
patch retains the existing lint configuration; no rule is switched off.

Review these before a separate linter-policy upgrade:

- `src/app/admin/atlas-live-status.tsx:224`: refresh initiated within an effect.
- `src/app/admin/coverage/components/magellan-console.tsx:139`: terminal-job refresh within an effect.
- `src/components/hamilton/InstitutionPicker.tsx:68,76`: prop/state reset and empty-search state resets.
- `src/components/hamilton/analyze/AnalyzeWorkspace.tsx`: compiler diagnostics for request-time ref closure, a render-time ref assignment/read, and manual callback dependency inference.
- `src/components/hamilton/monitor/WatchlistPanel.tsx:267`: empty-query state reset.
- `src/components/hamilton/reports/ReportWorkspace.tsx:186`: missing-template state reset.
- `src/components/public/search-modal.tsx:103`: open-modal state reset.

A linter diagnostic is not proof of a production incident. Distinguish actual
render-time ref reads from deferred callbacks and preserve UI behavior with tests.
Do not hide these findings with blanket rule suppression or change payment,
publication, or agent behavior as a side effect of this cleanup.
