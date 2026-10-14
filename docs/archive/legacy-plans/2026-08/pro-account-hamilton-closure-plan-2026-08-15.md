# Pro And Account Hamilton Closure Plan - 2026-08-15

## Objective

Make Pro feel like one self-serve consulting workspace instead of a mix of account pages, legacy dashboards, generic research, and partially connected Hamilton screens.

The intended journey is:

1. A user finds or selects an institution.
2. That canonical institution ID persists through Analyze, Benchmark, Scenario, Report, Watchlist, and Account.
3. Hamilton states what is known, what is provisional, what is verified, and what diligence is still needed.
4. Thin evidence creates a validation/source path instead of a generic consulting brief.
5. Reports and scenarios become board-ready artifacts only when evidence supports them.

## Current Implementation Snapshot

### What Hamilton Can Do Now

- `/pro/research` preserves old links but redirects into canonical Hamilton screens.
- `/pro/analyze?instId=...` validates the institution server-side and passes selected institution context into the Analyze workspace.
- `/api/research/hamilton` accepts `institutionId`, `intent`, and `evidencePolicy`, then injects selected institution identity, fee status, verified/provisional fees, financials, revenue trend, peer ranking, and source-quality context.
- `/api/research/hamilton` and `/api/hamilton/chat` now share the same Hamilton request contract: `institutionId`, `intent`, `evidencePolicy`, `audience`, and optional workspace context.
- Selected-institution briefing now comes from one shared Hamilton library path, so public/Pro research and admin chat receive the same identity, evidence tier, financial, peer, and source-quality context.
- Analyze can save user-owned responses in `hamilton_saved_analyses`.
- `/pro/reports?instId=...&intent=competitive-brief` preselects the competitive-report path and sends institution context to report generation.
- Report generation refuses to create a generic provider-written brief for fully empty selected institutions and returns a diligence/readiness report instead.
- Report generation now builds deterministic selected-institution fee deltas against a verified peer baseline before model synthesis, passes those deltas into the report payload, and returns a readiness brief when no selected-institution deltas can be computed.
- Report generation now builds the provider-facing selected-institution payload through a tested synthesis helper, so provisional rows, pipeline rows, financial context, peer baseline metadata, and verified-benchmark eligibility flags are checked before provider synthesis.
- Report generation now has mocked-provider server-action coverage for both the empty/thin selected-institution readiness path and the provisional-only selected-institution provider path.
- Report generation now validates the assembled report artifact after provider synthesis and before persistence, rejecting generic consulting language, unlabeled selected-institution snapshots, and provisional-only output that presents itself as a verified benchmark conclusion.
- Report generation resolves peer baselines in this order: valid saved peer set, selected-institution default peer filters, then verified national fallback with an explicit fallback reason.
- Report Builder now shows a pre-generation Evidence Preview using the same peer baseline and selected-institution delta logic as generation: readiness label, peer baseline, usable peer categories, selected-institution delta count, verified/provisional counts, fallback reason, and focus-category coverage.
- Scenario modeling can use approved institution fee rows when available, resolves the same saved/default/national peer baseline path, labels the active peer scope, and can save scenario drafts with `peer_set_id`.
- Saved scenario deep links now restore via `/pro/simulate?scenario_id=...`.
- Hamilton navigation now carries canonical numeric `instId` across Pro routes when the user starts from a selected institution.
- Hamilton Home now scopes its fresh signal, alert, and monitor-preview data to the selected institution when one is active, and its scenario/settings/monitor CTAs preserve that same `instId`.
- Hamilton Home positioning evidence now links users into the actual Simulate distribution workflow with fee category and selected institution context instead of a dead `#` link.
- Watchlist reads now match the JSON-array `hamilton_watchlists.institution_ids` schema and resolve numeric IDs to real institution names/status when possible.
- `/pro/monitor?instId=...` now uses the selected institution as part of the signal scope, shows that scope in the page header, and passes the selected institution into the watchlist panel.
- Monitor signals, priority alerts, and status counts now scope to canonical selected/watchlisted institution IDs when available, instead of always reading the global feed.
- Monitor watchlist mutations now authenticate on the server, validate canonical institution IDs, and write the selected workspace context as `watchlist`.
- Monitor watchlist rows and signal CTAs now hand users into `/pro/analyze` with a canonical `instId` when one is available.
- Monitor watchlist add now uses institution search instead of arbitrary free-text names.
- Monitor priority-alert and empty-feed actions now preserve the alert or selected institution ID instead of sending users to generic Analyze/Settings.
- Analyze secondary actions now route to real Hamilton workflows: peer distribution opens Reports & Briefs with peer-brief intent, and risk drivers open the selected institution's Monitor.
- Data Trust source decisions now create institution-scoped Hamilton Monitor signals without resuming provider automation.
- Data Trust claim decisions now create institution-scoped Hamilton Monitor signals, and claim decisions create claimant priority alerts.
- Monitor signal CTAs now route by workflow intent: accepted sources to Reports, other source lifecycle signals to source intake, claim lifecycle signals to Settings, scenarios to Simulate, and other signals to Analyze.
- Knox extraction now creates aggregate institution-scoped Monitor signals when source-grounded observations are inserted, and when normalized source text needs manual fee review because no usable candidates were found.
- Darwin verification now creates aggregate institution-scoped Monitor signals when raw rows become verified observations, and review signals when deterministic verification skips rows for canonical, amount, or lineage reasons.
- Hamilton publication now creates aggregate institution-scoped Monitor refresh signals when verified rows become published fee records.
- Hamilton publication now compares newly published live rows against prior live rows for the same institution/category and emits Monitor fee-movement signals when amounts change.
- Monitor routes extraction, verification, and verification-review lifecycle signals to Analyze, extraction-review signals to source intake, published-row lifecycle signals to Reports refresh, and fee-movement signals to competitive-brief refresh.
- Hamilton lifecycle signals now enqueue durable `hamilton_refresh_jobs` rows for Reports, Simulate, and Watchlist review; Monitor shows the queued work and Reports/Simulate complete matching jobs when users rerun those workflows.
- Hamilton Monitor signal writes now normalize evidence-policy metadata, force `provider_call_queued: false`, reject signal writes that would silently queue provider automation, and require explicit evidence policy for provider-originated competitor/movement signals.
- Hamilton Monitor queued refresh work now surfaces evidence policy, manual rerun/provider-queued posture, and no-provider-queued state from the originating signal metadata.
- Monitor and Hamilton Home signal cards now surface signal evidence-policy labels from `source_json`.
- Hamilton Pro persistence now has migration-backed base tables before follow-on schema changes, instead of relying only on runtime layout bootstrapping.
- Hamilton Pro/account persistence remains keyed to numeric `users.id`; the older schema-drift migration no longer widens web-owned Hamilton tables to text user IDs.
- Internal Hamilton chat memory now has migration-backed conversation/message tables and message rows copy authenticated user lineage from their parent conversation.
- Fresh local Supabase schema replay now completes through all migrations when started database-only, with semantic source/fee/workspace tables present and retired `ops_jobs` absent at the end.
- Saved Hamilton report and scenario artifacts now persist evidence policy, peer baseline source/label, peer-set ID, fallback reason, and selected-institution evidence counts as first-class metadata instead of burying policy only in narrative JSON.
- Report Builder previews, published report cards, and Report PDF exports now display artifact evidence policy, peer baseline, fallback reason, and selected-institution evidence counts; Scenario CSV exports now include the verified-only evidence policy.
- Account quick actions, Account state insights, Hamilton Context metadata, the legacy Pro dashboard benchmark modules, and the Pro marketing/index modules now distinguish verified-only benchmark/export data from provisional-first Hamilton analysis.
- Analyze, Reports, and Simulate artifact writes now normalize institution scope to canonical positive numeric institution IDs or empty/unscoped; profile-name slugs no longer get persisted as institution identity, and Simulate no longer fuzzy-matches fees by profile-name slug.
- Direct/bookmarked saved artifact URLs now recover canonical saved context: `/pro/analyze?analysis=...`, `/pro/simulate?scenario_id=...`, and `/pro/reports?scenario_id=...` hydrate the saved artifact's numeric institution when the URL has no `instId`.
- The shared Hamilton shell now uses the same direct saved-artifact fallback, so the context bar, left rail, and route body agree; saved-artifact fallback is labeled as a transient "Saved artifact" source and does not overwrite the user's stored workspace context.
- `/pro/reports` now surfaces user-generated Hamilton reports as a reusable "Your Reports" library, supports `/pro/reports?report_id=...` direct reopen, restores that report's canonical institution context in the route and shell, and keeps transient saved-artifact source labels out of persisted report/scenario metadata.
- Hamilton left-rail primary actions now route to their named workflow instead of always sending users to Peer Compare: My Bank and Peer Compare actions open Scenarios, Scenarios opens Reports, Reports opens Reports & Briefs, and Watchlist opens Peer Compare, with selected `instId` preserved.
- Subscriber entry at `/pro` now redirects to `/pro/hamilton`, shared Pro navigation uses the Hamilton workflow labels from `HAMILTON_NAV`, and the old `ProDashboard` implementation is reduced to a compatibility redirect so the visible entry path is the Hamilton workspace.
- Hamilton Home actions now route to Reports and Watchlist with selected `instId` context where available, and Hamilton View card actions preserve the selected institution into Analyze, Reports, and Simulate.
- Legacy peer brief routes now hand off to Hamilton Reports: `/pro/reports/new` redirects to the peer-benchmarking report workflow, `/pro/brief` and `/pro/brief/preview` redirect instead of serving standalone fixture/generic HTML, and `/pro/peers` opens Hamilton Reports with a visible legacy-filter caveat.
- New legacy `peer_brief` jobs are now blocked at `/api/reports/generate`, `triggerReportJob`, admin retry, dormant Pro controls, and the internal Hamilton chat tool. National/state/monthly report jobs remain admin publication jobs; institution, peer, competitive, consulting, and board briefs must use Hamilton Reports with selected institution and evidence policy.
- Secondary Pro data routes now stay as reference layers instead of competing workspaces: `/pro/categories`, `/pro/data`, `/pro/districts`, `/pro/market`, `/pro/news`, and `/pro/peers` show a Hamilton reference banner with selected-institution status and direct Analyze, Brief, Scenario, Watch, and Settings handoffs.
- Pro reference and Hamilton fallback auth/upgrade paths now preserve return context: filtered Data/News/Peers URLs keep query state through login/subscribe, non-Pro upgrades from reference routes return to the originating route, and Monitor/Settings fallback redirects keep selected `instId`.
- Public/signup/pricing upgrade copy now names Hamilton workflows instead of presenting generic "AI research" as a separate product surface.
- `hamilton_workspace_contexts` now stores one canonical selected institution per user.
- Hamilton layout and core Pro routes now resolve institution context in this order: URL `instId`, saved artifact context, stored workspace context, then user profile text fallback.
- `/pro/settings` now has a searchable selected-institution picker, validated ID submission, source labeling, source-submission CTA, authenticated claim-review submission, and context-preserving links back into Analyze, Reports, and Monitor.
- Accepted institution claims now create active `institution_workspace_memberships` owner records, set the claimant's Hamilton workspace context to the claimed institution, and remain separate from fee publication.
- `/pro/settings` now shows a verified workspace-authority badge for active memberships and disables duplicate claim requests for already-authorized institutions.
- `/pro/settings` now replaces the dead Proxy Access placeholder with workspace access management: institution owners/admins can grant existing active Pro users admin, analyst, or viewer roles, queue pending invitations for non-users or not-yet-Pro users, and revoke delegated access or pending invitations without deleting audit history.
- `/workspace-invite` now gives invite recipients a clear landing path: sign in or register with the invited email, activate Pro, and let Hamilton attach delegated workspace authority automatically.
- Registration, login, Subscribe, Account, and Welcome now preserve or surface workspace-invite context so pending delegated access does not disappear into generic account screens.
- Account and Welcome fallback Stripe activation now accepts pending workspace invitations if the webhook missed the checkout/subscription event.
- Hamilton Settings now gives owners/admins a mail-ready invitation action and a visible `/workspace-invite` recipient path for queued invitations.
- Hamilton Settings now attempts automated workspace-invite email delivery through a Resend-compatible server-side REST call when `RESEND_API_KEY` and an invite sender address are configured; missing or failed delivery remains nonblocking and falls back to the visible `/workspace-invite`/mailto path.
- Non-Pro users entering Pro from an institution-specific CTA now carry the selected Hamilton destination through Subscribe, Stripe checkout success/cancel URLs, and Account Welcome so a paid user resumes the requested Analyze/Reports/Simulate workflow instead of landing in a generic account page.
- `/account` now surfaces the stored Hamilton institution context/source and routes Pro quick actions into Hamilton with the selected `instId` when one is stored.
- `/account` now exposes the direct self-serve consulting action set for a selected institution: Analyze, generate a competitive/readiness brief, run a scenario, watch competitors, submit source evidence, update peer sets, benchmark fees, and export verified data.
- `/account` now surfaces active institution authority and recent claim history for Pro users.
- `/admin/quality` now includes an institution claim queue with pending/accepted/needs-info/rejected tabs and audited accept/info/reject actions.
- `/admin/hamilton/chat?instId=...` resolves the selected institution server-side and sends the same institution-aware contract to internal Hamilton chat.
- Local signed-in Pro/account browser verification now covers 20 routes at desktop and 390px mobile: Account, Welcome return, `/pro`, legacy brief/report/research redirects, Hamilton Home, Analyze, Reports, Simulate, Monitor, Settings, and secondary Pro reference routes. The current pass has 40 checked states, zero open issues, zero login redirects, zero page-level overflow, zero console/page errors, and zero missing headings. Evidence is saved in `/tmp/feeinsight-pro-account-local-audit-2026-08-15T20-43-05-713Z`.

### What Hamilton Cannot Reliably Do Yet

- It cannot yet be called production-complete across Pro/account UX because the signed-in production browser audit is still outstanding after deploy. The equivalent local signed-in audit is clean across Account, Analyze, Reports, Simulate, Monitor, Settings, compatibility redirects, and secondary reference routes.
- It cannot provide autonomous competitor surveillance yet. Monitor receives lifecycle signals and refresh-job prompts, but scheduled recrawl/detection cadence and autonomous rerun processing still need product design, cost guards, and production verification.
- It cannot guarantee rich peer deltas for every selected institution/category. Peer baselines now resolve deterministically, but thin verified peer coverage can still force a labeled national fallback or a diligence/readiness report.
- It cannot rely on automated invitation email delivery until production sender domain, `RESEND_API_KEY`, sender env, and delivery telemetry are configured.
- It cannot safely resume provider-driven automation until automation posture, provider-cost guards, and billing failure handling are reviewed separately.
- It cannot guarantee future Pro modules will preserve evidence-policy labels unless new work uses the shared Hamilton contracts and AGENTS guidance instead of bypassing them.

## Issues Fixed In This Pass

- Public city fee pages no longer crash when Postgres numeric fee values arrive as strings.
- Public city/state/research tables now have mobile overflow containment.
- Public institution/report filters now have accessible labels.
- Legacy `/check` now has a compatibility redirect into `/institutions`, and the sitemap includes `/institutions` as the current lookup surface.
- Breadcrumb JSON-LD no longer double-prefixes absolute Fee Insight URLs.
- Visible Pro/account navigation now points users to Hamilton Analyze instead of the legacy `/pro/research` hub.
- Hamilton left rail links preserve selected institution context for canonical institution IDs.
- Saved analysis and recent scenario links carry their saved institution IDs where available.
- Recent scenario links now use `scenario_id` and can restore the saved scenario.
- Simulate export now downloads a real CSV instead of showing an inert button.
- Inert Simulate sidebar controls were converted to non-interactive labels or real links.
- Watchlist query semantics now match the app-created `hamilton_watchlists` schema.
- Canonical per-user Hamilton workspace context was added through `hamilton_workspace_contexts`.
- Analyze, Reports, Simulate, Monitor, and the Hamilton layout use URL-selected context first and stored context second.
- Settings now lets a Pro user set a validated selected institution by ID and keeps quick-action links tied to that context.
- Settings now lets a Pro user find that institution through search instead of memorizing the numeric ID.
- Account now shows the stored Hamilton institution context and routes Analyze, Reports, Simulate, Monitor, source intake, peer-set management, benchmarks, and export quick actions through the selected institution when available.
- Hamilton ContextBar, Settings, and Account now label the selected institution source as URL selected, Manual, Profile, or Watchlist where applicable.
- Public "Claim or validate" routes through login into Hamilton Settings with the selected `instId`.
- Public institution CTAs now use a tested route helper for source intake, claim review, Analyze, Competitive Brief, and Scenario so institution-specific public-to-Pro handoffs are pinned by unit coverage.
- Pro claim requests now write to `institution_claims`, and `/admin/quality` can accept, reject, or request more information with immutable claim events.
- Accepted Pro claims now grant active user-level owner membership, refresh the claimant's selected Hamilton institution, and show account/settings authority badges and claim history.
- Settings workspace access now lists active institution members and pending invitations, lets institution owners/admins grant or queue delegated roles, and lets them revoke active delegated roles or pending invitations.
- Pending workspace invitations now persist in `institution_workspace_invitations`; Stripe Pro activation accepts matching pending invites into delegated memberships automatically.
- Queued workspace invitations now attempt automated invite email delivery after the durable invitation write succeeds, with deterministic idempotency and a manual delivery fallback if the email provider is missing or rejects the send.
- Subscribe and Stripe checkout now preserve sanitized internal `from` paths for institution-specific Pro workflows, and Account Welcome resumes the selected Hamilton destination after a successful Pro activation.
- Source evidence still routes through structured source intake with institution context, submitter role, and reviewer notes instead of a generic contact page.
- The inert Settings support button is now a real support contact link.
- Public/Pro Hamilton research and internal Hamilton chat now share request parsing, audience/evidence policy prompt rules, and selected-institution briefing.
- Report generation now uses deterministic selected-institution fee deltas, provisional labels, and a thin-evidence readiness path before provider synthesis.
- Thin/empty-evidence report readiness output now has pure-library unit coverage, so the source-diligence brief path is guarded against drifting back into generic provider-written competitive claims.
- Selected-institution report synthesis now has pure-library unit coverage for provider-payload rules, provisional row labeling, pipeline evidence rows, financial context, peer baseline metadata, and verified benchmark eligibility flags.
- The `generateReport` server action now has mocked-provider tests proving empty/thin evidence skips `generateSection`, saves source-diligence metadata, and provisional-only evidence sends every provider section selected-institution context with benchmark caveats.
- Report artifacts now pass a post-generation quality gate with pure-library and server-action tests proving generic provider language, unlabeled selected-institution snapshots, and unsupported verified-benchmark claims are rejected before persistence.
- Reports and Simulate now resolve verified peer baselines from a saved peer set, selected-institution peer filters, or verified national fallback, and generated artifacts expose the selected baseline/fallback reason.
- Scenario drafts now persist `peer_set_id` when a saved peer set is in use, and saved scenario report links preserve that peer context.
- Reports and Simulate now show a Benchmark Baseline selector using the same saved peer sets managed in Hamilton Settings.
- Report Builder now previews peer/evidence coverage before generation, including verified-ready, directional-only, diligence, source-needed, and peer-index-only states.
- The older `/pro/peers` save/delete actions now use the same `user.id` owner key as Hamilton Settings, Reports, Simulate, and the peer resolver.
- Monitor now validates watchlist adds through institution search, uses server-authenticated add/remove actions, scopes signals/alerts/status counts to selected/watchlisted IDs, and turns signal/watchlist CTAs into institution-aware Analyze handoffs.
- Data Trust source accept/reject/needs-info actions now write institution-scoped Hamilton signals with source status, validation mode, and explicit `provider_call_queued: false` metadata.
- Data Trust claim accept/reject/needs-info actions now write institution-scoped Hamilton signals, create claimant priority alerts, and preserve the underlying signal type so Monitor routes claim lifecycle alerts back to Settings instead of generic analysis.
- Monitor signal actions now route source refreshes to Reports, source repair signals to source intake, claim authority updates to Settings, scenario signals to Simulate, and other watch signals to Analyze with canonical `instId` when available.
- Knox extraction now writes one aggregate `knox_extraction_completed` Monitor signal per institution/run for actual inserted observations, and one `knox_extraction_needs_review` signal when normalized source text produces no source-grounded candidates.
- Darwin verification now writes one aggregate `darwin_verification_completed` Monitor signal per institution/run for actual verified rows, with raw/verified row lineage and no provider call.
- Darwin verification now writes one aggregate `darwin_verification_needs_review` Monitor signal per institution/run when deterministic verification skips rows, with raw-row lineage and reason counts.
- Hamilton publication now writes one aggregate `hamilton_publication_completed` Monitor signal per institution/run for actual published rows, with batch/published/verified row lineage and report/scenario/watchlist refresh metadata.
- Hamilton publication now writes `hamilton_fee_movement_detected` Monitor signals when a new live published amount differs from the prior live published amount for the same institution/category.
- Hamilton Monitor now persists queued report/scenario/watchlist refresh jobs from lifecycle signal recommendations, shows them in the Monitor side panel, and marks report/scenario jobs complete when those workflows regenerate against the selected institution.
- Hamilton Monitor signal writes now add evidence-policy/source metadata and reject unsafe provider automation metadata before any signal, priority alert, or refresh job is created.
- Hamilton Monitor queued refresh work now reads evidence/provider posture from `hamilton_refresh_jobs.source_json` and labels queued jobs as manual reruns unless a legacy row explicitly says provider work was queued.
- Hamilton Monitor side panel no longer shows prototype brand copy or a false row-click affordance; it now shows canonical ID, manual rerun, and provider-queued posture metrics.
- Added a base Hamilton Pro table migration so clean production schema replay creates saved analyses, scenarios, reports, watchlists, signals, and priority alerts before later migrations alter or reference them.
- Narrowed the legacy schema-drift `user_id` reconciliation so current Hamilton web tables keep numeric user scoping aligned with authenticated Pro/account queries.
- Added a Hamilton chat-memory migration and updated `appendMessage` so internal chat turns retain `user_id` lineage for audit/policy scoping.
- Added a replay compatibility baseline and normalized duplicate timestamped migration versions so a fresh local Supabase database can apply the historical migration chain deterministically.
- Hardened transitional semantic views and archive/drift migrations so missing clean-schema historical backup tables or retired pre-agentic table names no longer stop local replay.
- Verified the fresh database has `source_documents`, `verified_fee_observations`, `institution_workspace_memberships`, and `institution_workspace_invitations`, and no active `ops_jobs`; invitation/member tables have RLS and no anon/authenticated grants.
- Added Hamilton report/scenario artifact metadata columns and runtime guards for evidence policy, peer baseline source/label, fallback reason, peer-set ID, and selected-institution evidence counts.
- Added artifact metadata to Report preview, published report cards, Report PDF export payloads, and Scenario CSV exports.
- Saved reports, scenarios, and watchlist rows now persist selected-institution source/source-label metadata, and report previews, report cards, PDFs, scenario CSV exports, and the scenario archive surface the saved context source.
- The selected-source migration is ordered after the existing `20261231` reconciliation migration as `20270101000000_hamilton_selected_source_labels.sql`, so the new change applies with normal local migration ordering instead of requiring an out-of-order `--include-all` path.
- Added explicit verified-only/provisional-first policy labels to Account quick actions, Account state insights, Hamilton Context metadata, the old Pro dashboard benchmark cards, and the public Pro marketing/index modules.
- Consolidated shared Pro navigation around Hamilton workflow labels (`My Bank`, `Peer Compare`, `Scenarios`, `Reports & Briefs`, `Watchlist`) and changed `/pro` subscriber entry from Monitor-first to Hamilton My Bank.
- Replaced inert Hamilton Home "Export PDF" and "Full Dashboard" buttons with context-aware links into Reports and Watchlist.
- Replaced the unused old `ProDashboard` implementation with a compatibility redirect and removed visible product copy that framed generic "AI research" as a standalone Pro workflow.
- Routed legacy peer-brief/report-new paths into Hamilton Reports and added a legacy peer-filter warning so old URL filters do not silently produce a generic standalone HTML brief.
- Blocked new legacy `peer_brief` report jobs outside Hamilton Reports and converted dormant Pro report controls so they hand off to `/pro/reports?intent=peer-brief` instead of calling `/api/reports/generate`.
- Added a shared Hamilton reference banner to the six secondary Pro data/reference routes so those pages surface selected-institution context and return users to Analyze, Reports, Simulate, Monitor, or Settings instead of becoming standalone dead ends.
- Fixed `/pro/news` unauthenticated and non-Pro redirects so login/subscribe preserve the original Pro return path.
- Fixed Pro reference and Hamilton fallback auth/upgrade redirects so selected institutions and filtered route state survive login, subscription, and Hamilton upgrade gating instead of dropping users into generic Pro entry points.
- Fixed Hamilton Home, Analyze, Reports, Monitor, and shell fallback CTAs so selected `instId` context is preserved through fresh signal scoping, scenario handoffs, Settings defaults, and priority-alert actions.
- Replaced remaining dead/inert Hamilton analysis actions: Home "View full distribution" now deep-links to Simulate with the fee category, and Analyze secondary CTAs now deep-link to Reports or Monitor with `instId`.
- Replaced Settings visual-only Feature Access switches with explicit Hamilton capability/status links that preserve selected institution context, and replaced the disabled CERT "coming soon" placeholder with a canonical institution identity explanation tied to the selected Hamilton institution.
- Replaced Account and Welcome API "coming soon" placeholders with current-state API/docs/export affordances and a clear disclosure that managed account API keys are not exposed until key storage, revocation, and usage ownership are aligned.
- Converted Account Welcome tool cards from static, non-clickable descriptions into real workflow links, with Pro-gated cards routing free users to Subscribe instead of dead-ending.
- Aligned the API key contract with current capability limits: `/api/v1/index` now rejects shared-validator API key errors before rate limiting, OpenAPI declares unauthenticated JSON access as valid, and public API docs state that API keys are manually issued rather than self-serve account controls.
- Removed inconsistent self-serve key generation/revocation server actions and replaced the unused Account API-key manager with a read-only API/export status panel so latent account code no longer contradicts the manual-key product posture.
- Aligned verified CSV export access across API routes: `/api/v1/index?format=csv` now requires a signed-in Seat License before reading benchmark data, matching `/api/v1/fees?format=csv`, Account copy, public API docs, and OpenAPI metadata.
- Aligned residual Pro/API access copy and the shared `canAccessApiKey` helper with the manual-key policy: Premium still grants app data, signed-in exports, and Hamilton workflows, while self-serve API-key controls remain disabled pending manual workspace setup.
- Browser-tested public institution profiles now avoid duplicate quarterly revenue rows, cap institution financial history reads for public/Hamilton contexts, and allow the Vercel Analytics script/connect domains in CSP so route audits are not polluted by avoidable console errors.
- Pro no-session routes now redirect at the proxy layer with the full `from` path, so institution-specific Analyze, Reports, Simulate, and legacy `/pro/research` handoffs no longer depend on streamed meta redirects or a transient Pro gate render before Sign in.
- Pro/admin proxy guards now match exact route branches (`/pro` or `/pro/...`, `/admin` or `/admin/...`) so public lookalike paths such as `/products` or `/administer` are not accidentally converted into auth redirects.
- Simulate's fixed action bar no longer exposes a disabled Collaborate control; it now links to Hamilton Settings' Workspace Access section with selected `instId` context preserved, and the shared Hamilton context-link helper now keeps hash anchors valid when appending `instId`.
- Simulate no longer advertises a fake live sync/provider-driven mode; it now labels scenario modeling as manual, verified-only, and explicit that provisional rows are excluded from benchmark scoring.
- Hamilton context links now also preserve selected `instId` for root Pro URLs with query strings such as `/pro?source=account`, so root Pro handoffs do not drop institution context just because the URL is not under a `/pro/...` child route.
- Hamilton artifact scoping now uses a shared canonical institution ID normalizer: Analyze autosave, Report save, and Scenario save reject profile-name slugs, and Simulate fee lookup only reads approved fees by numeric institution ID.
- Saved artifact reopen now uses shared context fallback helpers, so direct analysis/scenario/report URLs restore canonical saved institution context in both the route body and Hamilton shell without overwriting the user's workspace context unless `instId` was explicit in the URL.
- Saved generated reports are now visible as user-owned reusable artifacts in Reports & Briefs; `report_id` deep links restore the saved report and selected institution context without requiring users to regenerate the brief.
- Hamilton left-rail primary CTAs are no longer text-only promises: "Generate Brief" stays in Reports, "Simulate Change" opens Scenarios, and all primary action links preserve selected institution context.
- Public benchmark and research-article CTAs no longer point to the removed home-page `#request-access` anchor; they now hand users into institution discovery.
- The `/for-institutions` hero no longer sends "See a Demo" users into gated `/pro`, and its Hamilton value copy now labels verified vs. provisional evidence instead of implying every answer is verified.
- The Hamilton Reports empty state now promises an evidence-labeled board-ready brief with caveats and diligence questions instead of a style-first generic executive summary.
- Public research, guide, and privacy copy now describe Hamilton analysis workflows and evidence-labeled outputs instead of reviving generic "AI research" product language.
- The `/api/research/hamilton` compatibility endpoint now returns Hamilton analysis language in provider/cost-limit errors instead of the old generic AI-research product label.
- Hamilton's generation voice is now brand-neutral consulting language (`HAMILTON_VERSION` 3.1.1) instead of naming a specific consulting firm in prompts, tests, scenario advice, or PDF comments.
- Admin Hamilton research and query-limit copy now uses Hamilton-specific wording rather than the old generic AI-research label.
- The old `/admin/research` implementation copy now contains redirect pages plus thin compatibility re-exports; canonical Hamilton research chat/articles links point directly to `/admin/hamilton/research`.
- Added `src/app/admin/AGENTS.md` so Atlas, Magellan, Rosetta, Knox, Darwin, and Hamilton operator screens have local admin-surface rules tied back to each runtime guide.
- Added `src/app/pro/AGENTS.md` so Pro routes keep Hamilton as the canonical consulting workspace, preserve selected institution context, and label verified-only versus provisional-first evidence.
- Added `src/app/account/AGENTS.md` so Account, Welcome, Subscribe, and login handoffs preserve Hamilton return paths, workspace authority boundaries, and manual API-key posture.
- `/fees` no longer creates page-level horizontal overflow at 390px; fee-family tables now scroll inside their card like the city/state fee tables.
- `/institutions` now labels the institution autocomplete input and footer newsletter email input; local 390px Playwright verification for `/institutions?state=PA` shows no unlabeled visible inputs, no console messages, and no page-level overflow.
- All 12 audited `/institutions` variants now pass local 390px Playwright checks for labels, console messages, page errors, visible error text, and page-level overflow.
- Legacy `/check` now redirects to `/institutions`; local browser verification shows final URL `/institutions`, no mobile overflow, no visible error, no unlabeled controls, and no hard console error.
- Public utility routes `/consumer` and `/reports` now verify locally at 390px with no visible error, no unlabeled controls, no page-level overflow, and no hard console error.
- Public state, district, city, and institution routes now read the cached national fee index instead of recomputing the live national index during profile/report renders.
- National index, fee-family, state, district, and city tables now contain their wide table layouts inside local horizontal scroll wrappers, so the page itself does not overflow at 390px.
- `/reports` now renders through a bounded catalog read, so a delayed public report query shows a temporary catalog-unavailable message instead of blocking consumer navigation for 20 seconds or falsely saying no reports exist.
- Public institution metadata now uses a lightweight identity lookup, the profile body skips catalog fee queries for zero-catalog profiles, source submission/automation reads are gated to validation-needed states, and public institution evidence reads use one cached aggregate query instead of page-level timeout races that leave database work running.
- Public institution provisional row counts now include staged pipeline evidence when the profile renders pipeline preview rows, so the report-card header and key-facts panel do not claim zero provisional rows while showing source-backed provisional evidence.
- Empty source-needed institution profiles now skip pipeline evidence reads when the lightweight institution row has no source, extracted-fee, or fee-schedule hint, so profiles like `2945` can render the source-submission workflow without scanning raw/verified pipeline tables.
- Public institution metadata and page-body rendering now share the same request-cached public institution read, so the page does not run a separate metadata-only lookup for every profile render.
- Focused local 390px Playwright verification now passes for `/check`, `/consumer`, `/reports`, `/fees`, `/fees/monthly_maintenance`, `/research/national-fee-index`, `/research/state/AL`, `/research/state/PR`, `/research/district/1`, `/research/district/12`, `/fees/city/tx`, `/fees/city/al/dothan`, `/institution/2144`, `/institution/7326`, `/institution/2945`, and `/institution/4388`: no page-level overflow, no unlabeled visible controls, no visible error state, no page errors, and no hard console errors.
- Broad local 390px Playwright verification now covers 861 non-institution public sitemap URLs: home, institutions, fees index, all 65 fee categories, 51 state city directories, 660 city fee detail pages, research index, national index, 51 state research pages, 12 district pages, fee-revenue research, reports, guides, and static utility pages. The first concurrent pass produced 58 transient dev/HMR or warmup opens; a sequential rerun of those 58 routes produced zero confirmed open issues, zero page-level overflow, zero visible error states, zero page errors, zero hard console errors, and zero HTTP errors.
- Focused desktop/mobile Playwright verification now passes for institution IDs `8`, `20`, `33`, `40`, `7326`, `2945`, `4388`, and `8109`: 16 renders, zero open issues, no horizontal overflow, no visible error/loading state, no page/console errors, no fee-preview fallback, and max browser load under 2 seconds.
- Broad local server-rendered HTML verification now covers all 1,183 public `/institution/[id]` sitemap URLs at crawl-safe concurrency on the current no-abandoned-query code path: zero open issues, zero HTTP failures, zero visible error states, zero loading stalls, zero fee-preview fallback states, zero missing H1s, zero pages over 10 seconds, max 1.600 seconds, p95 602ms. Evidence saved in `/tmp/feeinsight-institution-html-crawl-2026-08-15T19-57-59-231Z`.
- The page-map visualization now reflects the full local public sitemap crawl and signed-in Pro/account audit: non-institution public buckets, all public institution-profile buckets, and the local Pro/account route set are cleared locally. The remaining caveat is production re-audit after deploy with a signed-in production session.
- Removed unused Pro/account lint bindings from Subscribe, Billing, Hamilton home, Simulate, Pro Categories, Pro Brief Preview, and Hamilton conversation API files without changing rendered behavior.
- Added `src/lib/agents/AGENTS.md` so Atlas, Magellan, Rosetta, Knox, Darwin, and Hamilton have runtime-local operating guidance in addition to the repo root guide.
- Legacy `/pro/brief` and `/pro/brief/preview` now use relative compatibility redirects into Hamilton Reports, preserving the caller host and selected `instId`/`peerSetId` so signed-in sessions do not fall through to login.
- Hamilton's mobile shell and Home/Reports modules now wrap or collapse desktop layouts at 390px: top navigation wraps instead of creating document scroll width, Home evidence/header actions wrap, and the Reports builder grid only becomes 12-column on large screens.
- Hamilton Settings no longer nests the institution claim form inside the context-selection form, eliminating the React hydration/DOM warning while keeping both server actions available.

## P0 Closure Work

These are release-blocking for a credible Pro/account experience.

1. Finish selected institution management UX.
   - Storage now exists in `hamilton_workspace_contexts`.
   - Searchable Settings picker, ID validation, Account context surfacing, and source labels now exist.
   - Authenticated claim-review workflow now exists through `institution_claims` and `/admin/quality`.
   - Accepted claims now grant user-level workspace owner membership, account/settings badges, claimant workspace context, and Account claim history.
   - Existing-user delegated permission management now exists for active Pro users.
   - Pending invitation queue, Settings visibility/revocation, and Stripe activation acceptance now exist for users who do not yet have active Pro accounts.
   - Recipient invite landing/copy, registration redirect preservation, Subscribe/Account/Welcome pending-invite prompts, manual mailto delivery, and webhook-miss fallback acceptance now exist.
   - Automated outbound email delivery now exists behind Resend-compatible env configuration, and remains nonblocking when missing or failed.
   - Source labels now extend into watchlist, saved scenario, and saved report rows where selected context can change implicitly.
   - Remaining work is production email-provider setup: verified sender domain, `RESEND_API_KEY`, sender env, and optional webhook/delivery telemetry.

2. Consolidate Hamilton request contracts.
   - Shared parser and prompt policy now exist in `src/lib/hamilton/request-contract.ts`.
   - Public/Pro research and internal chat now share selected-institution briefing from `src/lib/hamilton/institution-briefing.ts`.
   - Reports and scenario modeling now use institution/peer context.
   - Monitor/watchlist reads and actions now use canonical selected/watchlisted IDs.
   - Data Trust source/claim events, Knox/Darwin extraction/verification events, Hamilton published/movement events, and future provider-originated competitor/movement events now pass through Monitor signal evidence-policy metadata guards.
   - Remaining work is any future dashboard/account module added without explicit evidence-policy metadata.

3. Make selected-institution context persistent in every Pro route.
   - Analyze, Reports, Simulate, Monitor, Settings, Account quick actions, saved analyses, saved scenarios, saved reports, and watchlist links.
   - Subscribe, checkout success/cancel URLs, and Account Welcome now preserve sanitized Pro return paths for selected-institution CTAs.
   - Public institution CTA route coverage now pins institution -> source intake, claim review, Analyze, Competitive Brief, and Scenario links.
   - Pro reference routes and Hamilton fallback upgrade gates now preserve route/query context when a user must sign in or subscribe before continuing.
   - Hamilton Home and Monitor action links now keep selected/alert institution context for signal scoping, scenario handoffs, Settings defaults, and priority-alert analysis.
   - Hamilton Home and Analyze no longer expose dead `#` or no-op secondary actions for distribution and risk-driver exploration.
   - Analyze, Reports, and Simulate now persist canonical numeric institution IDs only; no selected institution is stored as empty/unscoped rather than a profile-name slug.
   - Direct saved analysis/scenario/report URLs now restore selected institution context from saved artifact metadata when `instId` is missing.
   - Remaining test work is production browser validation for `search -> institution -> Pro analyze -> reports -> simulate` after this local work is deployed and a signed-in production session is available.

4. Harden evidence gating.
   - Empty evidence returns source/diligence workflow.
   - Provisional evidence returns directional conclusions only.
   - Verified benchmark statements require approved rows.
   - Thin evidence should never trigger a generic model-generated competitive brief.
   - New legacy `peer_brief` generation is rejected before automation starts; Hamilton Reports is the only path for peer/institution/competitive briefs.
   - Provider-generated report artifacts now pass through a server-side quality gate before persistence, so prompt compliance is not the only protection against generic or overconfident report output.

5. Make reports deterministic before model synthesis.
   - Selected-institution evidence payload now exists.
   - Deterministic deltas now exist against the verified national index.
   - Saved-peer-set/default-peer deltas now exist for Reports, with verified national fallback when coverage is too thin.
   - Reports and Simulate now expose visible baseline selection.
   - Saved Reports and Simulate artifacts now persist the evidence policy, peer baseline, fallback reason, peer-set ID, and selected-institution evidence counts as queryable metadata.
   - Report previews/cards/PDF exports and Scenario CSV exports now show the artifact evidence policy and baseline metadata.
   - Report Builder now shows a deterministic pre-generation Evidence Preview for peer coverage and selected-institution delta readiness.
   - Remaining work is broader browser-level saved peer set coverage/fallback validation after a signed-in Pro session is available.

## Completion Audit - 2026-08-15

| Requirement | Current status | Evidence | Remaining gap |
| --- | --- | --- | --- |
| Review Hamilton and agentic changes with a defect-first pass | Locally complete for the current Hamilton Monitor/source-label, public-institution, and signed-in Pro/account slices | Review-agent instructions re-read; root, runtime, and Hamilton `AGENTS.md` guides re-read; review found and fixed the public institution provisional-count mismatch introduced by the lightweight public read model, then local signed-in Pro/account audit found and fixed legacy brief redirects, mobile Hamilton overflow, Reports mobile grid overflow, and Settings nested-form hydration | Production UX still needs signed-in browser review after deploy |
| Create agent operating guides | Complete | `AGENTS.md`, `src/lib/agents/AGENTS.md`, `src/app/admin/AGENTS.md`, `src/app/pro/AGENTS.md`, `src/app/account/AGENTS.md`, and per-agent guides for Atlas, Magellan, Rosetta, Knox, Darwin, and Hamilton | Keep guides updated as new agents/surfaces are added |
| Preserve Hamilton institution context across Pro/account artifacts | Locally complete for current routes | Reports, scenarios, watchlists, PDFs, CSV exports, report cards, and scenario archive now carry selected source/source-label metadata; Analyze, Reports, and Simulate artifact writes now persist only canonical numeric institution IDs or empty/unscoped; direct saved artifact URLs restore canonical artifact institution context in both the route body and shared Hamilton shell without overwriting stored workspace context; saved generated reports are visible and directly reopenable through `/pro/reports?report_id=...` | Future Pro modules must use the shared metadata contract |
| Keep Hamilton public/Pro/internal boundaries explicit | Locally complete in docs and request contracts | Hamilton guides and this plan document public-safe, Pro-grade, internal/admin-gated behavior, Monitor signal evidence-policy guards, Settings capability statuses, Account API-key limitation disclosure, API docs/OpenAPI optional-auth alignment, removed self-serve key behavior, Seat License CSV export gating, and residual Pro/API copy plus access-helper alignment with manual-key policy | Scheduled/autonomous competitor surveillance still needs production design and cost controls |
| Update `page-map-flow.html` | Complete for current evidence | Visualization records selected-source fixes plus `resolved_report_peer_coverage_preview`, `resolved_report_readiness_quality_test`, `resolved_report_synthesis_payload_guard`, `resolved_report_action_mocked_provider_guard`, `resolved_report_artifact_quality_guard`, `resolved_report_empty_state_policy_copy`, `resolved_public_hamilton_product_copy`, `resolved_hamilton_compat_error_copy`, `resolved_hamilton_voice_brand_neutrality`, `resolved_admin_hamilton_research_copy`, `resolved_admin_research_redirect_canonicalization`, `resolved_admin_agent_surface_guide`, `resolved_pro_surface_guide`, `resolved_account_surface_guide`, `resolved_fees_index_mobile_overflow`, `resolved_institutions_unlabeled_inputs`, `resolved_institutions_console_errors`, `resolved_institutions_visible_error`, `resolved_utility_legacy_check_redirect`, `resolved_consumer_redirect_console_error`, `resolved_reports_filter_labels`, `resolved_canonical_artifact_institution_scope`, `resolved_saved_artifact_context_reopen`, `resolved_saved_artifact_shell_context`, `resolved_saved_report_library_reopen`, `resolved_left_rail_primary_action_routing`, `resolved_public_benchmark_cta_handoff`, `resolved_for_institutions_handoff_policy_copy`, `resolved_monitor_signal_policy_guard`, `resolved_monitor_refresh_job_policy_labels`, `resolved_monitor_posture_sidebar`, `resolved_simulate_evidence_posture`, `resolved_account_context_action_set`, `resolved_pro_hamilton_home_consolidation`, `resolved_legacy_report_generation_guard`, `resolved_secondary_pro_reference_handoff`, `resolved_pro_route_return_context`, `resolved_hamilton_home_monitor_context_scope`, `resolved_hamilton_dead_action_links`, `resolved_settings_capability_status`, `resolved_account_api_status_disclosure`, `resolved_welcome_tool_links`, `resolved_api_key_contract_alignment`, `resolved_account_api_self_serve_removed`, `resolved_csv_export_access_gate`, `resolved_manual_api_access_copy`, `resolved_public_browser_console_stability`, `resolved_pro_proxy_login_redirect`, `resolved_proxy_branch_matching`, `resolved_simulate_collaboration_handoff`, `resolved_context_link_root_query`, `resolved_public_institution_pipeline_count`, `resolved_source_needed_empty_profile_fast_path`, `resolved_institution_metadata_read_dedupe`, `resolved_legacy_brief_relative_redirect`, `resolved_settings_nested_form_hydration`, `resolved_hamilton_mobile_shell_overflow`, `resolved_hamilton_home_mobile_header_overflow`, `resolved_reports_mobile_builder_grid_overflow`, `verified_local_signed_in_pro_account_audit`, and current resolved count of 2,136 | Production screenshots remain pending until deployment and signed-in production session capture |
| Verify local schema for new Hamilton metadata | Complete | Database-only Supabase start succeeded; `supabase migration up` applied `20270101000000`; `psql` confirmed `selected_source`/`selected_source_label` columns and check constraints on reports, scenarios, and watchlists | Production remote migration history still must follow the runbook before push |
| Verify application gates | Complete for local code | `git diff --check`, focused proxy redirect and branch-matching tests, focused Hamilton context-link query/hash tests, focused canonical artifact institution-scope tests, focused saved artifact context-reopen tests, focused Account action contract tests, focused report-synthesis payload tests, focused report-artifact quality tests, focused report server-action mocked-provider tests, focused access/API/settings tests, focused public financial/revenue trend tests, focused Hamilton voice tests, sampled Playwright checks for `/institution/2945`, `/institution/8109`, login redirects, and Pro `instId` handoffs at desktop/mobile widths, focused redirect/context tests for safe redirects, admin redirect paths, Hamilton context links, workspace context, request contract, Home signal scoping, Analyze/Home/Monitor/Reports context CTAs, Hamilton dead-action link tests, focused Hamilton/report tests for report evidence, report-readiness output quality, report-job policy, Monitor signal/data policy, refresh-job policy labels, WatchlistPanel posture rendering, SimulateWorkspace evidence-posture rendering, public/pro/admin copy scans for stale generic AI-research labels and dead `#request-access` CTAs, admin research canonical-link and compatibility re-export scans, `/fees` 390px Playwright overflow check, all 12 audited `/institutions` 390px Playwright label/console/page-error/visible-error/overflow checks, local `/check` browser redirect verification, local `/consumer` and `/reports` 390px utility-route checks, full local public institution HTML crawl, broad local signed-in Pro/account Playwright audit with 40 desktop/mobile states and zero open issues, `npx eslint` for touched Pro/account files, `npx tsc --noEmit --pretty false`, `npm run lint`, `npm run guard:legacy`, `npm run test:agentic`, and `npm run build` passed after the latest Hamilton changes | Browser-level production Pro/account visual audit remains pending after deploy |

## P1 Closure Work

1. Turn Monitor into a real watchlist.
   - Watch selected institution and explicit competitors through canonical institution search.
   - Scope signals, alerts, and status counts to selected/watchlisted institutions.
   - Source/claim Data Trust changes now create Monitor signals and priority alerts.
   - Extraction success and no-candidate review states now create Monitor signals with source-document lineage.
   - Verified-row, verification-review, and published-row changes now create aggregate Monitor signals with lineage.
   - Published amount movement now creates Monitor signals and routes to competitive-brief refresh.
   - Provider-originated competitor/movement signals are now blocked unless they carry explicit evidence policy and do not queue provider automation through Monitor.
   - Refresh recommendations now create durable job prompts, label evidence/provider posture, and link users back to Reports, Simulate, or Monitor.
   - The Monitor side panel now uses operational posture metrics instead of prototype brand copy and avoids implying that watchlist rows are directly clickable.
   - Let users rerun a brief or scenario from future scheduled competitor-detection events and any future refresh-job types beyond the current report/scenario/watchlist review queue.

2. Replace old Pro dashboards with Hamilton workspace modules.
   - Shared Pro navigation, `/pro` subscriber entry, Hamilton Home actions, and visible product copy now route primary decisions through Hamilton.
   - The old `ProDashboard` implementation is now a compatibility redirect.
   - Legacy peer brief/report-new routes now redirect into Hamilton Reports instead of standalone HTML generation.
   - Secondary market/category/district/data/news/peer routes now stay as reference tools with explicit Hamilton context/handoff banners.
   - Local signed-in browser validation now passes for those secondary reference routes at desktop and 390px mobile; remaining work is production validation after deploy.

3. Finish peer-set quality UX for scenario modeling.
   - Backend peer baseline resolution now exists for saved peer set, same state + charter + asset tier + district fallback, and national fallback.
   - Scenario UI now labels the active peer baseline, preserves `peer_set_id`, and lets users change the saved peer set deliberately.
   - Scenario UI now labels the active distribution as verified-only, states that provisional rows are excluded from scoring, and replaces fake live-sync/provider posture with manual scenario mode.

4. Build account context management.
   - Let bank/CU users claim or select their institution.
   - Show current data trust state for the claimed institution.
   - Active user-level claim authority and claim history now show in Account.
   - Existing active Pro users can now be granted delegated workspace roles from Settings.
   - Direct Account actions now cover source intake, competitor monitoring, competitive/readiness reports, scenario modeling, peer-set management, benchmarks, and verified export with selected `instId` preserved where applicable.

5. Add Pro output quality tests.
   - Empty/thin selected-institution readiness output now has pure unit coverage proving Hamilton returns a source-diligence brief, says no provider generation was used, preserves financial context, and avoids generic consulting language.
   - Selected-institution provider payload now has pure unit coverage for grounding rules, provisional labels, verified-benchmark eligibility, pipeline rows, financial context, and peer baseline metadata.
   - Full `generateReport` server-action coverage now mocks provider sections and verifies empty evidence skips generation while provisional-only evidence carries benchmark caveats through every provider call.
   - Assert no unsupported claims for provisional evidence.
   - Assert reports include executive summary, evidence table, peer deltas, financial implications, caveats, and diligence questions.

## P2 Closure Work

- Unify public and Pro design language around compact report cards, evidence ribbons, and workflow modules.
- Add board-ready PDF export styling after deterministic report content is strong.
- Add saved workspace home: recent analyses, active institution, watched competitors, open diligence tasks, and latest report refreshes.
- Add the rest of the event-based lifecycle: source accepted, extraction, verification review, verified rows, published rows, deterministic published-fee movement, and report/scenario/watchlist refresh queues now feed Monitor; remaining lifecycle work is scheduled competitor-detection cadence and autonomous rerun processing.

## Recommended Test Matrix

- Unit:
  - Institution status/readiness classification.
  - Hamilton context URL helper.
  - Financial and fee formatting.
  - Evidence-policy gating.

- Integration:
  - `/institution/[id]` CTAs preserve `instId`.
  - `/pro/research` redirects preserve `prompt` and `instId`.
  - `/pro/analyze`, `/pro/reports`, `/pro/simulate`, `/pro/monitor` validate and preserve selected institution context.
  - Report generation blocks generic output for empty evidence.
  - Watchlist add/remove reads and writes `institution_ids` consistently.

- E2E:
  - Public search -> institution -> submit source.
  - Public institution -> Analyze.
  - Public institution -> Competitive Brief.
- Pro Analyze -> save analysis -> reopen with institution context.
- Pro Analyze -> save analysis -> reopen without `instId` and confirm the Hamilton shell context bar uses the saved artifact institution instead of stale workspace context.
- Pro Simulate -> save scenario -> reopen from left rail -> generate report.
- Pro Reports -> generate brief -> reopen `/pro/reports?report_id=...` and confirm the report preview, library card, context bar, and export metadata use the saved report artifact.
- Pro left rail -> primary CTA from My Bank/Peer Compare/Scenarios/Reports/Watchlist and confirm each lands in the named workflow with `instId` preserved.
- Watchlist event -> rerun brief.

- Visual:
  - Desktop and 390px mobile for Account, Hamilton Analyze, Reports, Simulate, Monitor, and login redirect. Local signed-in coverage passes; repeat on production after deploy.
  - No horizontal overflow, clipped fixed bars, or inert visible controls.

## Operating Decision

Hamilton should remain the canonical Pro shell. `/pro/research` should stay only as a compatibility redirect until traffic and bookmarks are migrated. Public Hamilton should be evidence-safe and consumer-readable; internal Hamilton should be admin/analyst-gated and can expose data operations. The shared contract is the selected institution, evidence policy, and intent, not free-text institution names.

## Production Migration Caveat

The local replay fix renamed historical duplicate-version migration files and edits older replay migrations so a clean database can be rebuilt. Before applying this branch to production, compare Supabase's remote migration history and decide whether to repair remote history mappings or squash these replay fixes into a production-safe forward migration path. Do not blindly deploy the renamed historical migration set without confirming how the production project records those versions.

The deployment decision and verification gates are now captured in `docs/plans/production-migration-history-runbook-2026-08-15.md`. Treat that runbook as release-blocking for production database work: production is not safe to push until staging proves either a history-repair mapping, a forward-only migration path, or a controlled rebuild/cutover.

Full local Supabase service startup still hits a host Docker socket mount error on this machine after SQL replay. Database-only startup passes with:

```bash
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

The selected-source metadata migration was verified locally after renaming it to `20270101000000_hamilton_selected_source_labels.sql`, which places it after `20261231_reconcile_schema_drift.sql`. Normal `supabase migration up` applies it without `--include-all`; the resulting local database has:

- `hamilton_reports.selected_source` / `selected_source_label`
- `hamilton_scenarios.selected_source` / `selected_source_label`
- `hamilton_watchlists.selected_source` / `selected_source_label`
- check constraints restricting `selected_source` to `url`, `manual`, `profile`, or `watchlist`
