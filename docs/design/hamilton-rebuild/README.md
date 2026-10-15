# Hamilton unified workspace: design and engineering handoff

Date: 2026-10-11, Hong Kong. Product owner: James. Preparation: Codex in this design conversation.
Inspected main: `483f445aa9d4eae766ecd60e1c85103a094759a6`.
Status: agreed product direction and source inventory; implementation, browser acceptance and live-data coverage are not complete.

## Start here

Hamilton is Fee Insight's paid intelligence workspace for bank and credit union teams. It connects published fees, institution filings, economic conditions, consumer complaints and regulatory context.

Ask Hamilton is an on-demand consultant and entryway into a research assignment. A user asks a question; Hamilton selects relevant data, produces an evidence-backed research brief, supports deeper exploration and refinement, and turns selected findings into an editable designed report.

Read `SCREEN-SPECS.md` for interaction details and `ENGINEERING-MAP.md` before coding. Mockups are visual references, not live-data evidence or editable component specifications. Written decisions govern when image text conflicts with this brief.

## Decisions James made in this conversation

| Decision | Final direction |
|---|---|
| Rebuild scope | Hamilton end to end: customer interface and supporting services where required. Preserve working services and persisted records; do not erase the repository or start a parallel data platform. |
| Signed-in landing | Intelligence Overview, beginning nationally with an easy state switch. |
| Ask Hamilton | Dedicated left navigation item; simple consultant entry and question-led research brief. |
| Data navigation | One Research section: Fee landscape, Financials, Economy, Complaints, Regulation. Maps, demographics and peers supply context across these lenses. |
| Initial report release | One editable board brief, saved/reopenable, with PDF export. Other templates are later work. |
| Visual style | Calm, simple, generous spacing, strong relevant exhibits, readable tables, concise interpretation. Latest entry mockup uses one sans-serif font for main content. |
| Identity | Signed-in institution remains separate from research subject, geography and selected peers. |
| Ask outputs | Appropriate to the request: peer-list questions return peers; rich research assignments return briefs. Do not force every task into a report. |
| Core journey | Ask → brief → explore/refine → create board brief → edit → save/reopen/export. |

These decisions supersede older navigation and presentation decisions for the Hamilton redesign only. They do not authorize production data changes, privilege changes or abandoning other owners' work.

## Navigation responsibilities

| Item | User purpose |
|---|---|
| Overview | National/state intelligence, three relevant findings and supporting exhibits; a route into research or Ask. |
| Ask Hamilton | Start a question, receive and refine an answer, inspect evidence, create a report. |
| Research | Browse/filter/compare underlying intelligence and build peer sets. |
| Try a price | Compare supplied price scenarios using explicit item volumes and waivers; keep volume constant and disclose assumptions. |
| Reports | Build, edit, save, reopen and export board briefs. |
| Monitor | Watched institutions and relevant changes; no hidden provider activation. |
| Saved analyses | Reopen prior questions and findings with their original context. |

Settings/account access remains available from the account menu. Administration is permission-gated and is not required to complete customer acceptance.

## Visual reference register

Images in `references/` use synthetic example data. They are not proof of implemented features, dataset completeness, source availability or truthful generated advice.

| File | Disposition | What it establishes |
|---|---|---|
| ask-entry.png | Approved direction: James said “that's good” | One question field, three task starters, known institution, recent work. |
| ask-brief.png | Preferred direction: James said “Better” | Question-led brief, concise findings, relevant inline exhibit, explore and create-report actions. Use the newer entry screen's typography. |
| national-overview.png | Supporting concept; detail approval pending | National overview with five intelligence lenses. |
| florida-overview.png | Supporting concept; detail approval pending | State/national comparison with geographic and economic context. |
| financial-evidence.png | Supporting concept; detail approval pending | Evidence drawer and explicit researched-institution label. |
| board-builder.png | Supporting concept; simplify for first board-brief release | Reuse selected findings/exhibits in a saved report. |

Superseded: Ask dashboard with four unrelated data panels; consultation screen dominated by wire-item/waiver inputs; earlier alternative brand palettes and redundant composer variants. Do not implement them as approved Ask designs.

Image limitations to correct in implementation: exact identity cannot be inferred from a dropdown label; metadata and coverage must come from real source records; illustrative chart quantities, prose and citations are not fixtures for production; generated source names are not authoritative; report image's total source count is not verified. Do not transcribe these as live values.

## External intelligence requirements

| Dataset | Contribution | Treatment / important boundary |
|---|---|---|
| Bank Call Reports / NCUA filings | Assets, financial performance, fee/noninterest income, comparable peers | Quarterly trends; explicit field definition, unit and period; do not infer wire-specific revenue from total noninterest income. |
| CFPB complaints | Consumer issues by institution/product/geography | Trends, issue breakdowns and records; raw counts are not unsupported quality rankings; note consumer-location scope and reporting coverage. |
| State economic data | Employment, unemployment and growth | State vs U.S. charts with comparable periods and methods. |
| National economic data | Employment, inflation, bank-service price inflation and rates | Historical trends, source definitions and actual release periods. |
| Federal Reserve publications | District commentary, policy and research | Dated commentary retains its district scope; do not label district commentary as state-only. |
| Census | Population and household income | County/state comparisons and maps; show vintage and estimation method. |
| FDIC Summary of Deposits | Bank branches, deposits and concentration | Bank-market maps/share; explicitly separate credit union branch coverage. |
| Federal/state regulation | Rules, guidance, enforcement and developments | Source, date, status and applicability; do not present unverified state law as operational advice. |

Every exhibit provides source, reporting period, geography, coverage and comparison method. Observed facts, derived comparisons and Hamilton interpretation are distinct. Missing data is not zero; $0 is a known value when supported. Currency amounts and percentage-based fees cannot be pooled. Per-exhibit dates replace a misleading single “fresh” stamp.

## Preview release boundary

James clarified on October 11: this redesign stays on its separate branch for visual review. Do not merge it to main or promote/deploy it to production without his explicit approval of this redesign. Standing approval for routine fixes does not override this restriction.

## Delivery sequence

1. Reconcile active identity, peers, evidence, landing and PDF work before overlapping runtime edits; record one canonical implementation owner/issue/PR.
2. Implement the shared shell and landing/navigation; preserve canonical routes/bookmarks and auth/subscription return context.
3. Deliver Ask entry → rich brief → follow-up → save/reopen, with explicit authorized institution identity and one composer.
4. Deliver explore-in-place and evidence handling using existing result/provenance contracts.
5. Deliver one board-brief template populated from selected answer findings/exhibits; edit, save, reopen and PDF parity.
6. Expand Overview/Research to real populated external-data lenses; represent unavailable coverage honestly.
7. Reconcile Try a price and Monitor with the same context and appearance.

Delivery status is separate from release: code reviewed, checks passed, preview accepted, merged, deployed and production verified must each have evidence.

## Acceptance contract

- AC01: Premium non-admin customer lands on Intelligence Overview; national/state selection requires no district choice.
- AC02: Ask entry has exactly one enabled question composer; task starters populate or start the same flow.
- AC03: Space Coast account researching Addition still shows Space Coast as home and Addition as subject, across navigation, reload, answer, report and PDF.
- AC04: “Find three Florida peers” returns named institutions with dated assets and inclusion criteria; selected rows save as a peer set without changing account institution.
- AC05: A broad research question produces relevant findings and exhibits from available datasets; unavailable sources produce an honest qualification, not fabricated content.
- AC06: “Those peers” and “us” resolve from persisted conversation/context; new question resets deliberately; stale response cannot overwrite a newer assignment.
- AC07: Explore returns to the same brief without losing follow-up draft or scope; source metadata remains inspectable.
- AC08: Creating a board brief reuses selected findings and exhibits; no silent new research or provider call. Any regeneration is explicit and respects provider controls.
- AC09: Edited report saves and reopens for its owner; exported PDF matches subject, values, periods, sources and limitations.
- AC10: Another user cannot read/write a private analysis/report by ID; view-only membership cannot edit shared institution data/peer sets.
- AC11: Keyboard, 320/390/768/1440px and 200% zoom retain readable charts/tables, sources and operable controls without page-wide overflow.
- AC12: Failed/paused/limited requests preserve question draft and provide an accurate retry/diligence path; no hidden paid requests.

## Remaining decisions to resolve through concrete examples

- Exact Intelligence Overview content priority and default peer baseline; do not assume all five lenses deserve equal weight.
- One sample ideal answer and one sample ideal board PDF to approve depth, tone and report layout.
- When evidence permits advice, how decisive Hamilton should be; preserve current evidence/readiness limits until this policy is agreed.
- Which external sources are populated, current, licensed/available and compatible; code presence does not prove coverage.
- Optional user uploads: composer attachment icon is conceptual until accepted file formats, storage and authorization are verified.

These are refinements, not reasons to repeat the confirmed scope/navigation questions.
