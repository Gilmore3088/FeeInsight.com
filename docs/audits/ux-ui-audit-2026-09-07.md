<!-- Produced by the ux-ui-auditor agent (.claude/agents/ux-ui-auditor.md) on 2026-09-07 from source. Consolidated summary: docs/audits/ux-buyer-journey-audit-2026-09-07.md -->

# Fee Insight UX/UI Audit — public and pro surfaces — 2026-09-07

Scope: every surface outside `/guides` (already audited and remediated 2026-08-15; see verification below),
read from source on the current branch. Severity: **P0** reader misled or blocked · **P1** material friction or dead end ·
**P2** polish, consistency, a11y detail. Every finding cites `file:line`.

---

## 1. Verdict

The data pages are strong: the warm editorial system is applied consistently on `/fees`, `/fees/[category]`,
the research reports and the guides, figures are set in tabular Newsreader, and every fee read goes through
`published_fee_catalog`. The single biggest problem is that the consumer's core journey — *what does my bank
charge, and is that high?* — is interrupted at almost every hop: the home page has no navigation and speaks in
pipeline jargon, the institution profile buries the fee list under four sections of extraction status, the fee page
half-gates and never links back to the institution lookup, and the phone version of the guide-to-institution
lookup silently drops the fee the reader came for. The theme is that internal vocabulary and pro-tier CTAs have
leaked onto consumer surfaces, while several pro-facing promises (free trial, demo, API access, three free AI
queries) resolve to pages that do not deliver them.

---

## 2. What works

- **Design system applied consistently** on the data surfaces: cream ground, terracotta accent, Newsreader for
  figures, `tabular-nums` everywhere a number appears — `src/app/(public)/fees/page.tsx:141-146`,
  `src/app/(public)/fees/[category]/page.tsx:191-196`, `src/app/(public)/research/national-fee-index/page.tsx:155-165`.
- **Named warm/terra tokens** exist so new surfaces need not hardcode hex — `src/app/globals.css:48-83`; `/pro`
  and `/for-institutions` already use them (`src/app/for-institutions/page.tsx:32-59`).
- **Fee-aware institution lookup** (E-6) is real on desktop: amount, distance from median, "Not published" instead
  of `$0`, stable `#fee-<category>` anchor — `src/app/(public)/institutions/page.tsx:307-328`,
  `src/app/(public)/institution/[id]/page.tsx:871-874`.
- **The fee page links back to its consumer guide**, ungated and labelled "Free to read" —
  `src/app/(public)/fees/[category]/page.tsx:217-239`.
- **Honest data-status vocabulary on the institution row level**: verified vs provisional badge, confidence label,
  source link or "Source pending" — `src/app/(public)/institution/[id]/page.tsx:855-918`.
- **Every page has a next step**: 404 offers four routes (`src/app/(public)/not-found.tsx:25-55`); error page
  offers retry + home (`src/app/(public)/error.tsx:88-101`).
- **Reduced-motion respected** for reveals, row transitions and the live pulse — `src/app/globals.css:264-272,314-321`.
- **Global visible focus ring** — `src/app/globals.css:295-299`.
- **Register/login forms are properly labelled** with `htmlFor`, `autoComplete`, and `minLength` hint —
  `src/app/(auth)/register/register-form.tsx:83-95`, `src/app/(auth)/login/login-form.tsx:199-223`.
- **Pro marketing tables reflow to cards on mobile** rather than hiding columns, with a comment explaining why —
  `src/app/pro/page.tsx:317-379, 594-647`.
- **Sticky mobile breadcrumb** carried over from the guides pattern to state/district reports —
  `src/app/(public)/research/state/[code]/page.tsx:117`.

### Guides remediation — verified landed

- `grep 'split(":")'` under `src/app/(public)/guides/` returns nothing (B-2).
- All three `<nav>` elements on the guide routes carry `aria-label` (B-9).
- The `#8A8073` small-text token is present in `guides/page.tsx`, `guides/[slug]/page.tsx`, `guides/pro/[slug]/page.tsx`
  and `saved-institutions-panel.tsx` (B-9) — but see F-06: it was not propagated to the shared footer or the rest of the site.
- `/fees/[category]` now links to its consumer guide (E-6 reverse link) — `fees/[category]/page.tsx:217-239`.
- E-5 ("no hardcoded category count") **did not fully land** — eight files outside the guides tree still print `49`
  (F-06 below).

---

## 3. Findings register

| ID | Sev | Surface | Finding | Evidence |
| --- | --- | --- | --- | --- |
| F-01 | **P0** | `/reports/[slug]` | Public report page ships placeholder copy as content: the "Executive Summary" is the literal string *"Hamilton's executive summary for this report will appear here."* and both charts are grey boxes reading *"Chart 1 — available in full report"*. | `src/app/(public)/reports/[slug]/page.tsx:194-196, 218-220` |
| F-02 | **P0** | `/for-institutions` → `/subscribe` | Two "Start Free Trial" buttons send the reader to a pricing page that offers no trial — only $499.99/mo or $5,000/yr, "Create account" for signed-out users. | `src/app/for-institutions/page.tsx:57-63, 348-354`; `src/app/subscribe/page.tsx:78-83, 103-108` (no trial copy anywhere in `src/app/subscribe`) |
| F-03 | **P0** | `/institutions?fee=` at 375px | The "Comparing {fee}" banner promises the institution's fee "appears alongside the national median", but the mobile card omits the amount entirely and its link drops `?fee=` and the `#fee-` anchor — so a phone reader arriving from a guide never sees the number and lands unhighlighted. | banner `src/app/(public)/institutions/page.tsx:110-136`; mobile card `:413-476` (no `focus_fee_amount`, `href` at `:420` lacks `fee`); desktop-only column `:307-328` |
| F-04 | **P1** | `/` (home) | The home page renders with **no header navigation, no search trigger and no sign-in link** — it is composed outside the `(public)` layout and mounts only hero, stats and footer. `/for-institutions` and `/submit-fees` have the same gap. | `src/app/page.tsx:27-33`; `src/app/layout.tsx:84-109` (no nav); `src/app/for-institutions/page.tsx:30-366`; `src/app/submit-fees/page.tsx:27` |
| F-05 | **P1** | `/` hero | Consumer-facing hero copy is pipeline jargon: eyebrow "Public Evidence Layer"; lede "fee evidence status, verified rows, provisional source signals, financial context, and the next validation step". The right half of the hero is a Pro "consulting workflow" card. No link to `/fees` or `/guides` above the fold. | `src/app/landing-hero.tsx:17-29, 47-92` |
| F-06 | **P1** | site-wide | E-5 regression: "49 fee categories" is still hardcoded in eight files while `/fees` and `/research/national-fee-index` render `TAXONOMY_COUNT` (65) on the same visit. | `src/app/landing-trust-stats.tsx:158-160`; `src/app/(public)/research/page.tsx:121, 230`; `src/app/for-institutions/page.tsx:264`; `src/app/(auth)/login/page.tsx:205`; `src/app/(public)/methodology/page.tsx:114-119`; `src/app/(public)/api-docs/page.tsx:283, 357`; `src/app/(public)/fees/page.tsx:465` (JSON-LD) — vs `src/app/(public)/fees/page.tsx:108`, `src/lib/fee-taxonomy.ts:552` |
| F-07 | **P1** | `/pro` marketing, `/for-institutions` "See a Demo" | The 778-line `/pro` marketing page is unreachable: `pro/layout.tsx` redirects signed-out users to `/login` and non-premium users to `/subscribe`, and premium users are redirected by the page itself to `/pro/monitor`. "See a Demo" therefore lands a prospect on a login wall. | `src/app/pro/layout.tsx:40-52`; `src/app/pro/page.tsx:43-45`; `src/app/for-institutions/page.tsx:64-69` |
| F-08 | **P1** | `/account`, `/register`, `/account/welcome` | Free users are promised "3 free AI research queries/day" and given a "Research Agent" tile, but its href `/pro/research` sits under the pro layout, which redirects non-premium users to `/subscribe`. | `src/app/(auth)/register/page.tsx:65`; `src/app/account/page.tsx:87-94`; `src/app/account/welcome/welcome-steps.tsx:58-64`; gate `src/app/pro/layout.tsx:50-52` |
| F-09 | **P1** | `/fees/[category]` | A consumer page (nav "Fee Benchmarks", linked from every guide) is half-gated: an `UpgradeGate` sits mid-page selling "CSV exports, AI research, and full API access", then the Fed-district table appears *below* the gate, then related fees. This is the pattern the tier model forbids. | `src/app/(public)/fees/[category]/page.tsx:241-246, 317-358`; gate copy `src/components/upgrade-gate.tsx:467-471` |
| F-10 | **P1** | `/fees/[category]` | No path to "my bank": the page never links to `/institutions?fee={category}` even though that lookup now exists; the only outbound links are the guide chips and same-family fee pills. | `src/app/(public)/fees/[category]/page.tsx:217-239, 399-423` (no `/institutions` href on the page) |
| F-11 | **P1** | `/institution/[id]` | Hierarchy inverted for a consumer: status badge → "Evidence Snapshot" → status banner → four-step **Source / Extraction / Review / Benchmark** stepper → validation CTA → metric strip, and only then the fee schedule. The number the reader came for is the sixth block. | `src/app/(public)/institution/[id]/page.tsx:309-469` (pipeline blocks), fee list `:511-567` |
| F-12 | **P1** | `/institution/[id]` | Consumer-facing copy is internal vocabulary: "Extraction: Rows detected", "Benchmark: Withheld", "deterministic review", "trust workflow", "Hamilton will start with this institution selected", "insight readiness". | `src/app/(public)/institution/[id]/page.tsx:274-295, 431-438, 674` |
| F-13 | **P1** | `/institution/[id]` | Fee rows never link to their benchmark page, so a reader seeing "$35 Overdraft" has no way to learn whether that is high; the only CTAs are a dark "Pro Preview" card whose three links go to `/pro/*` and hit the login wall for a signed-out reader. | rows `src/app/(public)/institution/[id]/page.tsx:855-918` (no `/fees/` href); CTAs `:666-708`; gate `src/app/pro/layout.tsx:40-52` |
| F-14 | **P1** | `/institution/[id]` | The headline "Overdraft" callout picks the first verified row whose *name* contains "overdraft" — an "Overdraft Protection Transfer" ($10) can be displayed as the overdraft fee even though `fee_category` is available on every row. | `src/app/(public)/institution/[id]/page.tsx:216-218, 487-499`; category available at `:175` |
| F-15 | **P1** | `/institutions` | Label mismatch and jargon: nav promises "Find Your Institution", the page H1 says "Browse institutions by state." and the lede asks the reader to check whether "fee evidence is verified, provisional, under review, or still missing"; stat labels are "Tracked / Approved rows / Mapped". | `src/components/consumer-nav.tsx:16`; `src/app/(public)/institutions/page.tsx:140-152, 159-164` |
| F-16 | **P1** | `/institutions` | The search box has no submit path: it is a client typeahead that only navigates on click of a suggestion; pressing Enter does nothing, and the `?q=` result list is reachable only by URL. | `src/app/(public)/institutions/search-bar.tsx:83-86, 96-108` (no `<form>`, no Enter handler); results require `params.q` `src/app/(public)/institutions/page.tsx:53, 64-66` |
| F-17 | **P1** | shared chrome | Global search is unreachable on phones: `SearchTrigger` is `hidden md:flex`, the mobile drawer has no search item, and the modal opens only on Cmd/Ctrl+K. | `src/components/search-trigger.tsx:697`; `src/components/consumer-mobile-nav.tsx:114-119, 193-243`; `src/components/public/search-modal.tsx:56-68` |
| F-18 | **P1** | `/research`, footer | "Original Research" cards and footer links send readers to two pages that are **entirely** paywalled for non-pro users (whole page replaced by `UpgradeGate`), with no lock marker on the link. | `src/app/(public)/research/page.tsx:453-517`; `src/components/customer-footer.tsx:361-363`; gates `src/app/(public)/research/fee-revenue-analysis/page.tsx:32-39`, `src/app/(public)/research/market-concentration/page.tsx:39-46` |
| F-19 | **P1** | `/research/articles/[slug]` | Article CTA "Request Custom Analysis" links to `/#request-access`; no element with that id exists on the home page, so the button scrolls nowhere. | `src/app/(public)/research/articles/[slug]/page.tsx:107-112`; `grep request-access src/app` → only this file and an unrelated component |
| F-20 | **P1** | `/subscribe` → `/register` | Choosing a plan while signed out sends the reader to `/register` with no plan intent; after registering they land on `/account`/welcome, never at checkout. | `src/app/subscribe/page.tsx:103-108, 151-156`; `src/app/(auth)/register/page.tsx:15` |
| F-21 | **P1** | `/account`, upgrade gate, `/pro` | "API access" is sold in the upgrade gate, the account upsell and the pro capabilities grid, while the same account page and the welcome flow say API access is "Coming soon" — and `/api-docs` is live in the footer. | sold: `src/components/upgrade-gate.tsx:469`, `src/app/account/page.tsx:187`, `src/app/pro/page.tsx:546-548`; "Soon": `src/app/account/page.tsx:310-321`, `src/app/account/welcome/welcome-steps.tsx:77-83` |
| F-22 | **P2** | `/research/state/[code]` | Headings use `font-[Newsreader]`, an arbitrary family name `next/font` never registers (it exposes `--font-newsreader`), so the state report H1 and section heads fall back to sans; the district page uses the correct `font-[family-name:var(--font-newsreader)]`. | `src/app/(public)/research/state/[code]/page.tsx:131, 179, 228, 348` vs `src/app/(public)/research/district/[id]/page.tsx:144` |
| F-23 | **P2** | footer | Small-text contrast below AA: `#B0A89C` at 11px (~2.4:1) and `#A09788` at 10–12px (~3.2:1) on cream; the guides fix moved this token to `#8A8073` but the shared footer did not follow. Contact email is plain text, not `mailto:`. | `src/components/customer-footer.tsx:297, 303, 312, 351, 380, 409-413` |
| F-24 | **P2** | nav | Logo links to `/account` when signed in instead of home; desktop nav sets no `aria-current`. "Pricing" and "Get Pro Access" both go to `/subscribe`. | `src/components/consumer-nav.tsx:34, 57-67, 92-97` |
| F-25 | **P2** | nav | Two parallel nav components with different CTAs and mobile menus: `(public)` uses `ConsumerNav`, while `/subscribe`, `/account` and `/consumer` use `CustomerNav` (no "Get Pro Access", pro-only item set). | `src/components/consumer-nav.tsx`; `src/components/customer-nav.tsx:17-34`; `src/app/subscribe/page.tsx:49`; `src/app/account/page.tsx:136` |
| F-26 | **P2** | mobile drawer | Drawer has no `role="dialog"`, no focus trap and no Escape handler; hamburger is 36px; decorative SVGs at `:151` and `:247` lack `aria-hidden`. | `src/components/consumer-mobile-nav.tsx:145-165, 166-262` |
| F-27 | **P2** | search modal | `role="combobox"` without `aria-controls`/`aria-activedescendant`, listbox unlabelled, no dialog role/focus trap; keyboard selection is not announced. | `src/components/public/search-modal.tsx:196-207, 218` |
| F-28 | **P2** | ask widget | `AskWidget` and `AskSearchBar` are mounted nowhere in `src/app`, and the widget posts to `/api/research/ask`, which does not exist (`src/app/api/research/` contains only `hamilton`). Dead surface. | `src/components/public/ask-widget.tsx:414`; `grep AskWidgetLoader src/app` → none |
| F-29 | **P2** | `/fees`, `/fees/[category]` | Internal tier keys shown to readers: the "Tier" column prints Spotlight/Core/Extended/Comprehensive; the category chip prints the raw key (`spotlight`). | `src/app/(public)/fees/page.tsx:31-36, 285-289`; `src/app/(public)/fees/[category]/page.tsx:154-156` |
| F-30 | **P2** | `/fees` | Spotlight cards hardcode 4 categories while `getSpotlightCategories()` returns 6, so the "Key Benchmarks" `slice(0, 6)` can never show more than 4; section header "Avg median" averages medians; JSON-LD says 49. | `src/app/(public)/fees/page.tsx:66-69, 184-190, 376, 465` |
| F-31 | **P2** | `/fees` at 375px | 8-column table sits in an `overflow-hidden` wrapper, so on narrow screens the trailing "Inst." column is clipped rather than scrollable; the distribution bar has a hard `min-w-[80px]`. | `src/app/(public)/fees/page.tsx:228-229, 304` |
| F-32 | **P2** | `/fees/[category]` | "Range" stat renders `$0.00 - $150.00` at 22px serif inside a half-width card at 375px — overflow risk; sub-line says "from N institutions" where N is the row count; methodology says "all non-rejected observations" while the read is approved-only. | `src/app/(public)/fees/[category]/page.tsx:179-182, 165-168, 430-436`; rows `src/lib/data-store/fees.ts:226-241` |
| F-33 | **P2** | a11y landmarks | Nested `<main>` inside the layout's `<main>` on `/institutions`, `/institution/[id]`, `/reports`, `/reports/[slug]`, `/submit-fees` and the public error page. | `src/app/(public)/layout.tsx:146`; `src/app/(public)/institutions/page.tsx:108`; `src/app/(public)/institution/[id]/page.tsx:307`; `src/app/(public)/reports/page.tsx:92`; `src/app/(public)/reports/[slug]/page.tsx:135`; `src/app/submit-fees/page.tsx:27`; `src/app/(public)/error.tsx:70` |
| F-34 | **P2** | a11y | `<nav>` elements without `aria-label`: `/fees` sidebar, `/fees/[category]` breadcrumb, `/research` sidebar, state/district breadcrumbs, report breadcrumb. | `src/app/(public)/fees/page.tsx:343`; `src/app/(public)/fees/[category]/page.tsx:133`; `src/app/(public)/research/page.tsx:619`; `src/app/(public)/research/state/[code]/page.tsx:117`; `src/app/(public)/research/district/[id]/page.tsx:133`; `src/app/(public)/reports/[slug]/page.tsx:139` |
| F-35 | **P2** | a11y | Decorative SVGs without `aria-hidden`: research hub icons, upgrade-gate lock and arrow, national-index arrow, account icons, auth logos. | `src/app/(public)/research/page.tsx:209, 256, 458, 491, 524, 680`; `src/components/upgrade-gate.tsx:456, 480`; `src/app/(public)/research/national-fee-index/page.tsx:237`; `src/app/account/page.tsx:195, 230`; `src/app/(auth)/register/page.tsx:34, 92` |
| F-36 | **P2** | a11y | Unlabelled `<select>`s (only a placeholder option) on the directory filter and the reports filter; welcome-step labels lack `htmlFor`. | `src/app/(public)/institutions/page.tsx:178-198`; `src/app/(public)/reports/page.tsx:133-172`; `src/app/account/welcome/welcome-steps.tsx:141-147` |
| F-37 | **P2** | `/research` | Eyebrow/lede copy is off-voice for consumers ("Research Terminal", "command center", "Core Product"); district card "Coverage %" (`fee_url_pct`) is unexplained; "fees extracted" wording; the state map uses an off-system slate/blue palette while `/institutions` uses terracotta. | `src/app/(public)/research/page.tsx:89, 99, 195, 347, 423-427`; `src/components/public/us-state-map.tsx:26-35, 69-104` |
| F-38 | **P2** | `/research/national-fee-index` | Free view stacks two upgrade CTAs (banner + bottom gate) on one page; a "Featured Fees 15" card means nothing to a reader. | `src/app/(public)/research/national-fee-index/page.tsx:212-249, 363-370, 195-208` |
| F-39 | **P2** | `/research/market-concentration` | Operator instructions leak to subscribers: a stat card that reads "Run ingest-sod first" and an empty state telling the reader to "Start the Atlas data refresh from the admin console". | `src/app/(public)/research/market-concentration/page.tsx:111, 352-355` |
| F-40 | **P2** | `/reports`, `/research/data-sources` | Orphaned surfaces: no inbound `href="/reports"` anywhere outside the reports tree, and `/research/data-sources` is linked only from itself; `/research` and `/reports` are two "research" catalogues with no cross-link. `/reports` is built entirely with inline styles rather than the token system. | `grep 'href="/reports'` → none; `grep data-sources` → self only; `src/app/(public)/reports/page.tsx:93-300` |
| F-41 | **P2** | upgrade gate, auth, welcome | More hardcoded stats that will drift: "60,000+ fee observations from 8,000+ institutions", "65,000+ data points", "8,000+ / 49 / 50" on login; "with a Seat License" jargon in the compact gate. | `src/components/upgrade-gate.tsx:441, 473`; `src/app/account/welcome/welcome-steps.tsx:61`; `src/app/(auth)/login/page.tsx:201-210` |
| F-42 | **P2** | `/account` | "Export Data" tile links straight to `/api/v1/fees?format=csv` (a raw file response, no UI); pro tiles for free users are `opacity-60` links that silently go to `/subscribe`. | `src/app/account/page.tsx:117-121, 105, 112, 279-283` |
| F-43 | **P2** | `/for-institutions`, `/subscribe` | Sub-AA small text on dark: `warm-600` (#7A7062) 12px uppercase on `warm-900` (~3.7:1); "Already have an account?" in `#A69D90` at 12px on cream (~3.1:1). | `src/app/for-institutions/page.tsx:258, 266, 274, 282`; `src/app/subscribe/page.tsx:223` |
| F-44 | **P2** | `/` | `aria-label` on a plain `<div>` (no role) is not announced; page `<title>` uses a double hyphen ("Bank Fee Index -- Fee Intelligence…"). | `src/app/landing-hero.tsx:31`; `src/app/page.tsx:11, 15` |
| F-45 | **P2** | 404 | Root `not-found.tsx` uses the slate/white palette while the public one uses the warm system — two different 404s. | `src/app/not-found.tsx:110-131` vs `src/app/(public)/not-found.tsx` |

**Totals: P0 3 · P1 18 · P2 24 = 45 findings.**

---

## 4. Per-surface notes

### `/` — home (`src/app/page.tsx`, `landing-hero.tsx`, `landing-trust-stats.tsx`)
- **Hierarchy.** H1 is just the brand name; the searchable input is the right first move, but the eyebrow "Public Evidence Layer" and the lede (`landing-hero.tsx:17-29`) describe the pipeline, not the benefit. The right column (`:47-92`) gives half the hero to a Pro workflow.
- **Labels.** "49 Fee categories" and "50 U.S. states" are literals (`landing-trust-stats.tsx:158-172`); the institution count is live. Mixed provenance in one row.
- **Dead ends.** No nav at all (F-04). Above-the-fold links: directory, submit-a-source, Pro workflow, pricing. No `/fees`, no `/guides`.
- **A11y.** `aria-label` on a `div` (`landing-hero.tsx:31`); lucide icons in the workflow list are decorative and fine (lucide ≥0.4 sets `aria-hidden`).

### `/fees` (`src/app/(public)/fees/page.tsx`)
- **Hierarchy.** Good: four spotlight medians, then family tables with median/P25/P75/range/bar. A reader finds the overdraft median in two seconds.
- **Labels.** "{TAXONOMY_COUNT} fee categories" in the header (`:108`) while a free reader's tables contain 6; the count in each family heading is the *filtered* count, which reads as if the family only has two fees. Tier column and "Avg median" (F-29, F-30).
- **Dead ends.** Action bar and sidebar route out well. Gate at the bottom (`:450-454`) is honest ("N more available").
- **A11y.** Sidebar `<nav>` unlabelled (`:343`); `overflow-hidden` table wrapper at 375px (F-31).

### `/fees/[category]` (`src/app/(public)/fees/[category]/page.tsx`)
- **Hierarchy.** Median card first, distribution second — right order.
- **Labels.** Raw tier chip (`:154-156`); "from N institutions" is rows (`:165-168`); methodology text contradicts the approved-only read (`:430-436`).
- **Dead ends.** Half-gate mid-page then more free content below it (F-09); no route to `/institutions?fee=` (F-10). Related-fee pills and the guide chips are good.
- **A11y.** Breadcrumb `<nav>` unlabelled (`:133`); `WarmTable` headers lack `scope` (`:75`).

### `/institutions` (`src/app/(public)/institutions/page.tsx`, `search-bar.tsx`, `state-directory-map.tsx`)
- **Hierarchy.** Search box is prominent, but the H1 tells the reader to browse by state, and the map (desktop only, `state-directory-map.tsx:107`) takes the next screen.
- **Labels.** F-15; "Fee rows" column with verified/provisional/none sub-labels (`:329-345`) is pipeline reporting, not consumer information.
- **Dead ends.** F-16 (no Enter/submit); F-03 (mobile card drops the fee). Pagination preserves filters correctly (`:89-98`).
- **A11y.** Unlabelled selects (`:178-198`); nested `<main>` (`:108`); map is `role="img"` with per-state `Link` elements — keyboard reachable, good.

### `/institution/[id]` (`src/app/(public)/institution/[id]/page.tsx`)
- **Hierarchy.** F-11. For a `verified` institution the reader scrolls past Evidence Snapshot, status banner, readiness stepper and a metric strip before the fee schedule.
- **Labels.** F-12, F-14. "Score: Withheld" (`:353`) reads as punitive.
- **Dead ends.** F-13. "Claim or validate" → `/contact` and "Submit official source" → `/submit-fees` are fine for institution staff but are the *only* non-pro CTAs.
- **A11y.** Nested `<main>` (`:307`); otherwise well structured — `break-words` on long names, `scroll-mt-24` on anchors.

### `/research` hub (`src/app/(public)/research/page.tsx`)
- **Hierarchy.** The "I'm a Consumer / Researcher / Professional" triage (`:136-179`) is the best wayfinding element on the site; it should be on the home page.
- **Labels.** "49" twice (`:121, 230`); "Research Terminal", "Core Product"; district "Coverage" unexplained (F-37).
- **Dead ends.** F-18 — paywalled studies presented as open. Sidebar and Explore lists route well.
- **A11y.** Sidebar `<nav>` unlabelled (`:619`); five undecorated SVGs (F-35).

### `/research/national-fee-index`
- **Hierarchy.** Clear: CPI strip, four stat cards, family tables.
- **Labels.** "Preview" badge and "6 / 65" card are honest; "Featured Fees 15" is not meaningful.
- **Dead ends.** Two upgrade CTAs (F-38). Table rows link to `/fees/[category]` — good.
- **A11y.** Arrow SVG at `:237` undecorated; `th` without `scope`.

### `/research/state/[code]`, `/research/district/[id]`
- **Hierarchy.** Stat cards then comparison table — fine. Delta pills carry sign as well as colour (`state/[code]/page.tsx:52-68`) — good.
- **Labels.** Gate copy "N more fee categories for {state}" is honest; district gate "Full {district} district intelligence" (`district/[id]/page.tsx:203`) is vague.
- **Dead ends.** Rows link to `/fees/[category]`; district page links to its states. Neither links to `/institutions?state=`, the obvious consumer next step.
- **A11y / consistency.** F-22 (state H1 not in Newsreader); breadcrumb navs unlabelled.

### `/research/fee-revenue-analysis`, `/research/market-concentration`, `/research/data-sources`, `/research/articles/[slug]`
- Both studies are entirely gated (F-18); the gate `message` prop is used as the h3 so the card reads "Fee-to-Revenue Analysis / Unlock…" with no explanation of what is behind it.
- Market concentration leaks operator copy (F-39).
- Data sources is orphaned (F-40) and speaks of "review gates" and "source lineage" (`data-sources/page.tsx:23`).
- Article CTA anchor is dead (F-19); `MarkdownContent` will emit a second `<h1>` for any `# ` heading in article body (`articles/[slug]/page.tsx:197`).

### `/reports`, `/reports/[slug]`
- F-01 is the headline. The email gate itself is well handled — pending state, 202 handling, one-hour link copy (`email-gate.tsx:30-36, 58-63, 106-108`).
- Orphaned and off-system (F-40); unlabelled selects (F-36); breadcrumb `<nav>` unlabelled and nested `<main>`.

### `/for-institutions`
- **Hierarchy.** Strong professional pitch; dark hero, problem statement, four capabilities.
- **Labels.** F-02 (free trial), F-06 (49), "$15K consulting fees" / "McKinsey" claims are marketing, not audited here.
- **Dead ends.** F-04 (no nav), F-07 ("See a Demo" → login wall). "Talk to Sales" → `/contact` is fine.
- **A11y.** F-43 contrast on the dark stat labels.

### `/pro` (marketing)
- Unreachable (F-07). If it were reachable: the ticker (`pro/page.tsx:114-137`) has no `aria-label`/`role="marquee"` and relies on horizontal scroll with `scrollbar-none`; "Request Data Access" is a `mailto:`; the table/card reflow is exemplary.

### `/subscribe`
- **Hierarchy.** Two plans side by side, annual highlighted — clear.
- **Labels.** "Seat License" is used only here and in the compact gate; "Save $1,000 vs monthly" checks out ($5,999.88 vs $5,000).
- **Dead ends.** F-20 (plan intent lost); no free-trial or money-back copy to back F-02.
- **A11y.** F-43 low-contrast sign-in line; `CustomerNav` instead of `ConsumerNav` (F-25).

### `/register`, `/login`
- Forms are the best-labelled on the site. The register form's "About your organization" block is pro-oriented (institution, asset tier, job role) with no consumer path — a consumer registering for a saved-institution alert (E-3) is asked for their asset tier.
- Hardcoded stats on the login panel (F-41, F-06). Logo SVGs undecorated (F-35).

### `/account`, `/account/welcome`
- F-08 (free AI queries unreachable), F-21 (API contradiction), F-42 (raw CSV link). The "Your State Insight" card (`account/page.tsx:226-259`) is the one genuinely consumer-useful element on the account page.
- Welcome flow: progress bar is four unlabelled `div`s (`welcome-steps.tsx:115-124`) — no `role="progressbar"` or text equivalent; labels lack `htmlFor` (F-36).

### Shared chrome
- **ConsumerNav / ConsumerMobileNav:** F-17 (no mobile search), F-24, F-26. Sticky header with `backdrop-blur` and `z-40` works with the sticky breadcrumb `top-14 z-30`.
- **CustomerFooter:** F-23. Link set is sensible; "State Reports" goes to `/research` (top) rather than `/research#states`, while "District Reports" correctly uses `#districts`.
- **SearchModal:** F-27. Grouping and keyboard navigation are otherwise good; institution results show "· 12 fees" which is the one consumer-legible count on the site.
- **AskWidget:** F-28 — dead code; if revived, the FAB (`ask-widget.tsx:456-476`) at `bottom-6 right-6 z-50` will collide with the mobile drawer (`z-50`).
- **UpgradeGate:** F-09 (pro-benefit copy on consumer pages), F-35, F-41. The compact variant ("N more available with a Seat License") is the more honest of the two.

---

## 5. Top five fixes (by consumer impact)

1. **Make the institution page answer the consumer's question first.** Move the fee schedule (`institution/[id]/page.tsx:511-567`) directly under the header; collapse the status banner, readiness stepper and Evidence Snapshot into one line ("12 verified fees · updated Aug 14"); link every fee row to `/fees/{fee_category}` with "vs national median $X"; select the overdraft callout by `fee_category === "overdraft"` (`:216-218`); replace the "Pro Preview" card with a consumer card (save this bank / compare on `/fees`). Closes F-11, F-12, F-13, F-14.

2. **Give the home page a nav and a consumer voice.** Wrap `src/app/page.tsx` (and `/for-institutions`, `/submit-fees`) in `ConsumerNav` + `SearchModal`; replace the "Public Evidence Layer" eyebrow and pipeline lede (`landing-hero.tsx:17-29`) with the reader's question ("What does your bank charge?"); lift the Consumer / Researcher / Professional triage from `research/page.tsx:136-179` into the hero; move the Pro workflow card below the fold. Closes F-04, F-05, F-44.

3. **Finish the fee-aware lookup on mobile and close the fee-page loop.** In `InstitutionMobileCard` (`institutions/page.tsx:413-476`) render `focus_fee_amount` with its median delta and carry `?fee=…#fee-…` in the href; add a "See what your bank charges for {fee}" block on `/fees/[category]` linking to `/institutions?fee={category}`; wrap the search input in a `<form action="/institutions">` so Enter submits `q`. Closes F-03, F-10, F-16.

4. **Stop shipping promises the next page cannot keep.** Remove or gate `/reports/[slug]` until `executive_summary` and chart artifacts exist (`reports/[slug]/page.tsx:194-220`); change "Start Free Trial" to "View pricing" or add a real trial (`for-institutions/page.tsx:61, 352`); point "See a Demo" at a reachable page or delete the dead `/pro` marketing route (`pro/layout.tsx:40-52`); route the "3 free queries/day" tile to a page free users can open, or drop the claim (`account/page.tsx:87-94`, `register/page.tsx:65`); pick one answer on API access (`account/page.tsx:187` vs `:313-321`); label the two paywalled studies on `/research` as Pro. Closes F-01, F-02, F-07, F-08, F-18, F-19, F-21.

5. **Finish E-5 and un-gate the consumer fee page.** Replace the eight remaining `49` literals (F-06) with `TAXONOMY_COUNT` or qualitative copy and extend `fee-catalog-copy.test.ts` to scan `src/app/**` and `src/components/**`; on `/fees/[category]` move the `UpgradeGate` (`:241-246`) below all free content, rewrite its copy for the consumer reader ("Breakdowns by charter, tier and state are part of the professional tier"), and stop listing CSV/API benefits there. Closes F-06, F-09, F-29.

Then, as a single accessibility pass: mobile search entry point (F-17), labelled `<nav>`s and `<select>`s, `aria-hidden` on decorative SVGs, un-nest `<main>`, and lift the footer small-text token to `#8A8073` (F-23, F-26, F-27, F-33–F-36).
