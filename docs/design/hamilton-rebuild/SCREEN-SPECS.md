# Screen and interaction specifications

## Shared shell

Navy desktop sidebar, light main surface and restrained teal accents, using existing project typography/components where compatible. Show authorized home institution separately from a researched subject; home identity is server-derived and never set by a research selection. Sidebar labels follow README. Mobile navigation offers the same destinations. Keep Settings and administration out of ordinary customer tasks.

One active Ask composer per view. Ask navigation is a destination, not another docked input. On data/report views a contextual Ask action may hand off to the same conversation, carrying selected evidence and scope. If an inline question field is chosen for a view, it is the sole active composer.

No redundant site header plus second workspace navigation. Scope controls appear where research needs them, not as mandatory pre-question setup. State selection never requires Fed district. Evidence/source controls remain accessible and necessary qualifications visible.

## Intelligence Overview: default landing

National first; one easy state switch. Three concise question-worthy findings and a small set of supporting exhibits. A user can open a research lens, inspect evidence, ask about a finding or save it for a report. Avoid turning the page into a grid advertising every dataset.

States: loading, populated, partly covered, no coverage, failed source. A unavailable dataset has an explicit explanation and appropriate next action. No invented findings or national estimates from incomplete local samples.

## Ask Hamilton entry

Approved screenshot: references/ask-entry.png.

Heading “What are you working on?”; one composer; three starters Review our fees / Research competitors / Prepare a board briefing; server-known institution quietly indicated; recent saved work secondary. Start with a typed question or starter; resolve question scope using existing context and ask a narrow clarification only when necessary. Attachment support is not yet verified.

States: new assignment, unsent draft, clarification, submitting, provider paused/limited, failed request with draft retained. No automatic provider execution solely from navigation or landing research selection.

## Research brief / task-appropriate answer

Preferred screenshot: references/ask-brief.png; adopt entry-screen sans-serif typography and reduce headings.

Show original question, direct answer, relevant findings and optional inline exhibit(s). A broad assignment may produce a rich brief; a fact lookup or peer request leads with its requested result. Findings contain stable IDs and evidence references so exploration and report selection can reuse them.

Explore opens detail while keeping assignment state. Follow-up continues the same conversation and selected peers/scope. “New question” clearly begins a distinct assignment. Create report opens the initial board template using the current findings. Source/assumption detail can expand, but qualifications affecting meaning remain visible.

States: partial answer, thin evidence, canceled request, failed generation, late response, saved historic answer, edited scope. Preserve provenance and avoid relabeling historic results using today's selected institution or dates.

## Explore a finding and inspect evidence

Desktop: a side detail region or panel alongside the brief; mobile: full-width detail with Back to brief. Show the selected comparison, peers or source evidence, not a new unrelated dashboard. Return preserves scroll/focus, draft and assignment. Peer selection changes comparison baseline explicitly and saves separately from account affiliation.

Source metadata: source identity/link, observed value/unit/category, period, geography, comparison criteria, covered/eligible sample counts, computation and caveats. Financial/complaint/regulatory semantics differ; do not force them into a fee-only schema without reviewing existing provenance contracts.

## Research

One destination with five lenses: fees, financials, economy, complaints and regulation. Reuse one geography/institution/peer context and carry it into Ask/Reports. Institution research labels a subject separately from home institution. Named peers include assets, dates, inclusion criteria and independent fee coverage. Maps disclose footprint versus table scope and bank-only deposit coverage.

## Board brief

Initial release has one template. Current answer's findings/exhibits enter a preview; user can include/exclude, order and edit narrative. Facts and evidence remain bound to source values; changing factual content must not leave old citations attached. Cosmetic template changes do not trigger new research. Save/reopen/export are the success path, not a dead-end preview.

Use existing report persistence, run ledger and PDF endpoint after reviewing contracts. Persist the home/subject/scope/baseline/evidence context needed to reopen and audit the artifact. No parallel report store or silent rewrite of old saved artifacts.

States: empty selection, draft, saving, saved, stale save response, failed save, unavailable exhibit, PDF generation failure, unauthorized access. Keep editing recoverable. Save/version semantics must be confirmed from current code before implementation.

## Design-system deliverable

Provide concrete spacing/type/color tokens, sidebar/header, composer, task starter, finding, exhibit, evidence drawer, peer table and report-editor components. Use one main-content font; preserve existing heading-wrap and accessibility rules. Include loading/error/empty/coverage variants and mobile focus/scroll behavior. Do not treat image pixels as a complete spec.
