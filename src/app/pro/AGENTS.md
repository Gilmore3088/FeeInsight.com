# Pro Surface Guide

The Pro surface is Hamilton's self-serve consulting workspace. Keep Pro routes aligned around selected institution context, evidence policy, and workflow continuity instead of recreating standalone dashboards or generic chat experiences.

Before editing Hamilton-specific behavior, also read:

- `src/lib/agents/hamilton/AGENTS.md`
- `src/lib/hamilton/request-contract.ts`
- `src/lib/hamilton/institution-briefing.ts`
- `src/lib/hamilton/context-link.ts`
- `src/lib/hamilton/context-source.ts`

## Shared Rules

- Preserve canonical numeric `instId` across Analyze, Reports, Simulate, Monitor, Settings, Account, Subscribe, and login redirects whenever an institution is selected.
- Resolve institution context in the established order: URL `instId`, saved artifact context, stored workspace context, then profile fallback.
- `/pro/research` is the institution tab of Research, beside `/pro/intelligence` (Market) (#2044). New visible Pro entry points should use the five workspace areas in `src/lib/hamilton/navigation.ts`, `/pro/monitor` or `/pro/settings`.
- Label provisional-first Hamilton analysis separately from verified-only benchmark/export data. Provisional evidence must not be presented as verified benchmark scoring.
- Thin or empty evidence should produce diligence, source-submission, or readiness paths, not generic consulting briefs.
- Reference routes such as Data, Market, News, Districts, Categories, and Peers should hand users back into Hamilton workflows instead of acting like competing workspaces.
- Do not rely on free-text institution names as workspace identity. Persist canonical positive numeric institution IDs or leave the artifact unscoped.
- Do not add provider work that bypasses `src/lib/ai-provider.ts`, cost/circuit controls, or automation posture checks.

## Workflow Ownership

- Analyze asks institution-aware questions and may save selected-institution analyses.
- Reports creates evidence-labeled consulting/readiness artifacts and uses verified peer baselines with explicit fallback reasons.
- Simulate models fee changes against approved rows and selected peer baselines; exports must label verified-only benchmark evidence.
- Monitor watches selected/watchlisted institutions, lifecycle signals, priority alerts, and refresh jobs without silently queueing provider automation.
- Settings owns selected institution context, workspace claims, delegated access, pending invitations, saved peer sets, and source/claim handoffs.

