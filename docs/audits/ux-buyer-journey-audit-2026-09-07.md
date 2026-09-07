# UX, buyer journey and browser simulation audit — 2026-09-07

Three agents, one question: **can a reader get from "what does my bank charge?" to an
answer — and can a professional get from "we need to benchmark" to a subscription — without
the product getting in the way?**

| Agent | Method | Report |
| --- | --- | --- |
| `ux-ui-auditor` | Every public and pro surface, read from source; `file:line` for each finding | [`ux-ui-audit-2026-09-07.md`](./ux-ui-audit-2026-09-07.md) — 45 findings (P0 3 · P1 18 · P2 24) |
| `buyer-journey-mapper` | Three journeys traced route by route; registration and Stripe flows followed through their handlers | [`buyer-journey-map-2026-09-07.md`](./buyer-journey-map-2026-09-07.md) — 17 breaks (3 blocking) |
| `playwright-ux-simulator` | Real Chromium, 375×812 and 1280×800, signed out then signed in as a consumer and as a professional, against a fixture database | [`playwright-ux-simulation-2026-09-07.md`](./playwright-ux-simulation-2026-09-07.md) — see §4 |

The agent definitions live in `.claude/agents/` and are reusable.

**About the fixture.** The repository's migration history assumes a base schema created
before migrations were tracked, so the full schema cannot be rebuilt locally. The
simulation ran against a fixture of the tables the public journey actually reads — 12
synthetic institutions across four states, 384 published fee rows covering every category
the guides cite, two fixture users (a free consumer with two saved institutions, and an
active professional). Institution names and figures are synthetic; page behaviour is real
production code served from a production build.

---

## 1. Verdict

The data surfaces are strong and the guides remediation held up under a real browser: the
warm editorial system is applied consistently, figures are set in tabular Newsreader, every
fee read goes through `published_fee_catalog`, and a consumer landing cold on
`/guides/overdraft-fees` sees the median, a "Does your bank charge more than $X?" prompt and
a single clear next step above the fold on a phone.

The product then loses that reader at almost every subsequent hop. The two blocking
problems are structural rather than cosmetic:

1. **The registered-consumer journey cannot be completed from the product.** Nothing in
   `src/` calls `POST /api/alerts` or `addAlertSubscription`. A reader can be told "save
   your bank and we'll email you" on the guide, but there is no control anywhere that saves
   a bank, no alerts list on `/account`, and no dispatcher or mail sender to honour the
   promise. The data layer, the API route and the guide-side panel all exist and are wired
   to nothing.
2. **Consumer intent is dropped at the door.** The guide sends
   `/register?intent=fee-alert&category=overdraft`; the register page reads neither param,
   asks for a "Work email" and "About your organization", creates a Stripe customer before
   the user row (so registration fails outright if Stripe is unavailable), and lands every
   new user on a professional dashboard whose first card is a $499.99/mo upsell.

The theme across both reports: **internal vocabulary and professional CTAs have leaked
onto consumer surfaces, and several professional promises resolve to pages that do not
deliver them** — "Start Free Trial" with no trial, "See a Demo" behind a login wall, "3
free AI queries/day" behind the pro gate, a `/reports/[slug]` page shipping placeholder
text as its executive summary.

## 2. What this session already fixed

Running the audit surfaced defects in code from the earlier guides work, and the browser
run surfaced one that only a real runtime could catch. All are committed on this branch.

| Fix | What was wrong | Evidence |
| --- | --- | --- |
| **Session-free public chrome** | The public layout and consumer nav both read cookies, which makes every page beneath them dynamic. The static guide pages therefore 500'd at runtime with `Page changed from static to dynamic … reason: cookies`. The earlier build passed only because no data was present to prerender. | `src/app/(public)/layout.tsx`, `consumer-nav.tsx`, new `api/session`, `nav-account.tsx`, `admin-view-banner.tsx`, `use-session-chrome.ts`. Verified: `● /guides/[slug]` prerendered, served with `x-nextjs-cache: HIT` |
| **E-5 completed** | "49" was still printed on eight surfaces the first sweep missed — bare stat tiles, "49-category taxonomy", "(6 of 49)", report titles. The guard regex only matched "N fee categories". | Five tiles now derive from `TAXONOMY_COUNT`; prose describes the taxonomy by kind; `fee-catalog-copy.test.ts` catches every form that slipped through |
| **Mobile lookup carries the fee** | The "Comparing overdraft" banner promised the amount, but the phone card showed only "32 verified fees" and its link dropped `?fee=` | `InstitutionMobileCard` shows the amount, its distance from the median, "Not published", and deep-links to the highlighted row |
| **Search submits on Enter** | The typeahead only navigated on click; Enter did nothing, and `?q=` results were reachable only by URL. Both paths also dropped the fee focus | `search-bar.tsx`: Enter runs a search; `?fee=` survives Enter and selection; wrapped in Suspense so the prerendered home hero is safe |
| **Fee page → your bank** | `/fees/[category]` never linked to the lookup that now exists | "Find your institution" block linking to `/institutions?fee=…` |
| **Prose labels** | "its published overdraft (od) against the median" — taxonomy display names leaked their abbreviations into sentences | Parentheticals stripped in prose on the guide, lookup and personalisation panel |
| **Search suggestion unclickable** (found only in the browser) | `.fi-reveal` used `animation-fill-mode: both`, which keeps the animated section promoted after the animation ends, so the search dropdown's `z-50` was trapped beneath the next section — `elementFromPoint` over a suggestion returned the map heading, and click/tap timed out on both viewports. This was the guide's promised payoff step. | `globals.css`: fill-mode `backwards` (end state is the natural state, so nothing visible changes); search section `relative z-20`. Verified: suggestion is the top element, click and tap both land on `/institution/3?fee=overdraft#fee-overdraft` with the row highlighted |
| **Mobile drawer painted under the page** (browser only) | The sticky header's `backdrop-blur` made it the containing block for the `fixed` drawer, so page text bled through the open menu | `backdrop-blur-sm` removed from the three sticky headers; the 95% ground carries the look. Verified: a menu item is the top element at its own centre |
| **Personalisation panel shifted the hero** (browser only) | The signed-in "Your institutions" island rendered above the "Check your own bank" box ~475 ms after load, moving the primary CTA | Island moved below the CTA block, so its arrival shifts only what sits beneath it. Verified |

## 3. Consolidated findings — what to do, in order

Deduplicated across the two source-based reports (IDs: **F-** = UX audit, **J-** = journey
map). Ordered by consumer impact, then by how much of the funnel each unblocks.

### Blocking — the journey cannot complete

| # | Change | Why it is first | Sources |
| --- | --- | --- | --- |
| 1 | **Add the save/alert action.** A "Save {institution} — alert me when {fee} changes" control on `/institution/[id]`, pre-filled from `?fee=`, posting to the existing `/api/alerts`; an alerts list with remove on `/account`. | Turns on a data layer, API and guide panel that already exist. Without it the registered tier has no reason to exist. | J-1, J-7, F-13 |
| 2 | **Honour the guide's intent on `/register`.** Read `intent`, `category`, `from`; render a consumer variant (name, email, password — no organisation block); redirect to `/institutions?fee=<category>` rather than `/account`; create the user before the Stripe customer, and create the customer lazily at checkout. | Every word of the guide's ask is dropped the moment the reader clicks. Stripe-before-user also means a free signup fails when Stripe is down. | J-2, J-4, J-5, F-20 |
| 3 | **Back the e-mail promise or remove it.** An agent module with run-ledger visibility that diffs `published_fee_catalog` against subscriptions and sends mail — or delete "we'll email you" from the guide and panel until it exists. | The copy currently promises something no code can do. | J-3 |

### Material — readers are misled or sent to the wrong product

| # | Change | Sources |
| --- | --- | --- |
| 4 | **Institution page: answer the question first.** Fee schedule directly under the header; collapse status banner, readiness stepper and evidence snapshot to one line; link every fee row to `/fees/{fee_category}` with "vs national median"; pick the overdraft callout by `fee_category`, not by name substring; replace the "Pro Preview" card with the consumer action from #1. | F-11, F-12, F-13, F-14 |
| 5 | **Give the home page a nav and a consumer voice.** `/`, `/for-institutions` and `/submit-fees` mount no header, no search and no sign-in; the hero reads "Public Evidence Layer … provisional source signals". Lift the Consumer / Researcher / Professional triage from `/research` into the hero. | F-04, F-05, F-44 |
| 6 | **Stop shipping promises the next page cannot keep.** "Start Free Trial" → real trial or "View pricing"; "See a Demo" → a reachable page (the `/pro` marketing route is unreachable behind its own layout gate); "3 free AI queries/day" → a surface free users can open, or drop the claim; one answer on API access; gate or finish `/reports/[slug]` until it has content. | F-01, F-02, F-07, F-08, F-21, J-6, J-8, J-9 |
| 7 | **Land the professional buyer in the product.** `success_url` → `/pro/monitor?success=true`; carry `from`/`instId` from `/pro/layout.tsx` through `/subscribe` into checkout metadata; make `/account/welcome` send premium users on rather than re-asking their profile. | J-10, J-12, J-13, F-20 |
| 8 | **Un-gate the consumer fee page.** Move the `UpgradeGate` on `/fees/[category]` below all free content and rewrite it for a consumer ("breakdowns by charter, tier and state are part of the professional tier"); stop selling CSV/API there. | F-09, F-29 |
| 9 | **Global search on phones; honest lookup copy.** A search entry in the mobile drawer; H1 "Find your institution" instead of "Browse institutions by state."; retire "fee evidence is verified, provisional, under review". | F-15, F-17 |
| 10 | **Two paywalled research pages are linked without a lock**; article CTA scrolls to an anchor that does not exist. | F-18, F-19 |

### Quality — one accessibility and consistency pass

Labelled `<nav>`s and `<select>`s, `aria-hidden` on decorative SVGs, un-nest `<main>`,
mobile drawer as a dialog with focus trap, search modal combobox wiring, footer small-text
token to `#8A8073`, one 404, one nav component, `font-[Newsreader]` → the registered
variable on state reports. (F-22 – F-27, F-31 – F-36, F-43, F-45.)

Also worth a decision: the 24-hour fixed session TTL means a returning consumer is
anonymous again two days later and the guide's personalisation silently disappears (J-15);
and the webhook maps `paused` to `none` while leaving `role = premium` (J-16).

## 4. Browser simulation

Chromium 141 via Playwright, 375×812 (touch) and 1280×800, 84 screenshots. Signed out
through all ten journey steps, then signed in as a registered consumer with two saved
institutions and as an active professional. Full report:
[`playwright-ux-simulation-2026-09-07.md`](./playwright-ux-simulation-2026-09-07.md);
selected frames in [`screenshots/`](./screenshots/).

**What it felt like, in the simulator's words.**

- *Consumer, anonymous:* "The guide is the best page on the site. Landing cold I
  understood within a second what it was about, and the number I came for is inside the
  'Check your own bank' box well above the fold, with a big button next to it." Then: "the
  promised payoff dies at the institution search — the suggestion cannot be clicked on
  desktop or tapped on mobile, and forcing through drops the fee context onto a data-ops
  page with the row 2,500–6,000 px down and no way back." *(The unclickable suggestion and
  the dropped fee are fixed above; the institution page's hierarchy is item 4 in §3.)*
- *Professional:* pricing is one click from `/` on desktop "only because the landing page
  has no global header"; on a phone the link is below the fold. The site tells "four
  different scale stories" — 12 / 12+ / 8,000+ institutions, 384 vs 60,000+ observations.
- *Registered consumer:* the "Your institutions" panel appears in ~475 ms with correct
  deltas and deep links that scroll to the highlighted row — "but 'Manage your alerts'
  leads to `/account`, a professional dashboard with an upsell and no alerts."
- *Professional, signed in:* the pro guide and the breakdown tables render in full;
  `/pro/monitor` "is a different skin with placeholder-strategy copy, a self-contradicting
  header, and horizontal overflow on mobile."

**Confirmed from the browser.** `/guides/overdraft-fees` served prerendered
(`x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`). The professional guide shows a gate
signed out (lock, "View Plans", 162 words, no article body) and the full article signed in
(759 words, five sections). No 5xx, no page errors, no console warnings; every audited
link and button had an accessible name; focus rings were visible on all 14 tab stops.

**Defects the source-based agents could not have seen** — 19 in total, by type:
functional 8 · recurring console error 1 · overflow 1 · landmark/ARIA 4 · copy/trust 4 ·
environmental 1.

| ID | Where | Finding | Status |
| --- | --- | --- | --- |
| D1 | `/institutions` search | Suggestion unclickable on both viewports (stacking context from `.fi-reveal`) | **Fixed** |
| D2 | Search → institution | Suggestion dropped `?fee=`; state links drop it too | **Fixed** for suggestion and Enter; state/charter filter links still drop `fee=` — item 9 in §3 |
| D3 | `/institution/[id]?fee=` | Highlight applied but no scroll without the `#fee-` hash | All links now carry the hash; consider scrolling on `?fee=` alone |
| D4 | Mobile drawer | Painted under page content (`backdrop-filter` containing block) | **Fixed** |
| D5 | Mobile | No search entry point (trigger is `hidden md:flex`) | Open — item 9 in §3 |
| D6 | Guide → `/account` | "Manage your alerts" leads to a page with no alerts | Open — item 1 in §3 |
| D7 | `/register` | `intent`/`category` unused; "Work email"; organisation block | Open — item 2 in §3 |
| D8 | `/pro/monitor` mobile | Horizontal overflow (566 > 375); header contradicts body | Open |
| D9 | Every page | `/_vercel/insights/script.js` 404 + MIME refusal — `@vercel/analytics` injects its script off-Vercel | Open — guard `<Analytics />` on `process.env.VERCEL` |
| D11–D14 | Landmarks | Nested `<main>`; five routes with no `<main>`; search overlay without `role="dialog"`; no skip link | Open — the a11y pass in §3 |
| D15 | `/institution/[id]` | Raw enums in the UI: `tier_4`, `per_item` | Open — item 4 in §3 |
| D16–D19 | Copy | Four scale stories; "12 observations from 12 institutions" above "384 observations"; login asks *Username* after register collected *Work email*; `/pro/monitor` placeholder-strategy copy | Open — item 6 in §3 |

One thing the simulator flagged that is not a defect: the professional guide showed no
comparison bars. The comparison block suppresses itself below eight observations per group
by design (audit item C-4), and a twelve-institution fixture never reaches that in any
asset tier or state. On production data it renders.

## 5. What works and should be kept

- Consumer guides: static, never gated, median and next step above the fold on a phone;
  the guide → `/institutions?fee=` → highlighted row handoff works on desktop and, after
  today's fix, on mobile.
- `/institutions` validates `?fee=` against the taxonomy and degrades to the plain
  directory on a bad value; pagination preserves the focus.
- The webhook is idempotent with sound Stripe-poll fallbacks; `/login` honours and
  sanitises `from`.
- Design system, tabular figures, reduced-motion, global focus ring, properly labelled auth
  forms, pro tables that reflow to cards on mobile.
