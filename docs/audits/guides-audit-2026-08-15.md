# `/guides/` Review & Audit — 2026-08-15

Scope: the consumer guides surface (`/guides`, `/guides/[slug]`), its content model,
its data pipeline, its UI/UX template, and its connection to the agentic runtime
(Hamilton/Knox/Darwin), institutions, and the paid/free access model.

Files in scope:

| File | Lines | Role |
| --- | --- | --- |
| `src/lib/guides.ts` | 265 | The entire content store — a hardcoded TS array |
| `src/app/(public)/guides/page.tsx` | 350 | Index page |
| `src/app/(public)/guides/[slug]/page.tsx` | 550 | Guide detail template |
| `src/app/(public)/guides/loading.tsx`, `[slug]/loading.tsx` | — | Skeletons |
| `.claude/skills/consumer-guide/SKILL.md` | — | Authoring spec — **not wired to anything** |

---

## Part 1 — Guide inventory

Ten guides, all defined as literals in `src/lib/guides.ts`. Five are promoted as
"primary" via a hardcoded slug set in `guides/page.tsx:21-27`; the other five render
as compact cards.

| # | Slug | Family label | Fee categories | Sections | Prose words |
| --- | --- | --- | --- | --- | --- |
| 1 | `overdraft-fees` | Overdraft & NSF ★ | `overdraft`, `od_daily_cap`, `od_protection_transfer` | 3 | 138 |
| 2 | `nsf-fees` | Overdraft & NSF ★ | `nsf`, `nsf_daily_cap`, `deposited_item_return` | 3 | 138 |
| 3 | `atm-fees` | ATM & Card ★ | `atm_non_network`, `atm_international`, `balance_inquiry` | 3 | 121 |
| 4 | `wire-transfer-fees` | Wire Transfers ★ | `wire_domestic_outgoing`, `wire_domestic_incoming`, `wire_intl_outgoing`, `wire_intl_incoming` | 3 | 125 |
| 5 | `monthly-maintenance-fees` | Account Fees ★ | `monthly_maintenance`, `early_closure`, `dormant_account` | 3 | 142 |
| 6 | `foreign-transaction-fees` | International | `card_foreign_txn`, `atm_international` | 3 | 131 |
| 7 | `check-fees` | Check Services | `cashiers_check`, `stop_payment`, `check_printing`, `money_order`, `counter_check` | 3 | 120 |
| 8 | `digital-banking-fees` | Digital Banking | `ach_origination`, `ach_return`, `bill_pay`, `mobile_deposit` | 3 | 126 |
| 9 | `account-closure-fees` | Account Lifecycle | `early_closure`, `dormant_account`, `account_research` | 3 | 124 |
| 10 | `safe-deposit-fees` | Branch Services | `safe_deposit_box`, `notary_fee` | 3 | 117 |

★ = in `PRIMARY_SLUGS`, rendered as a featured card.

**Coverage:** the ten guides touch 27 of the taxonomy's 65 fee categories (42%).
Forty categories have no guide at all, including several that are consumer-facing and
high-volume: `minimum_balance`, `paper_statement`, `card_replacement`, `late_payment`,
`check_cashing`, `zelle_fee`, `coin_counting`, `garnishment_levy`, and the entire
Mortgage Servicing, Retirement & IRA, and Vehicle & Title families.

**Shape:** every guide is identical in structure — 3 sections, 117–142 words of prose.
The `consumer-guide` skill that is supposed to govern this content specifies **800–1,200
words**, a mandated "What Regulators Say" section, a "Compare Your Bank" section, bolded
benchmark figures, and a data-attribution footer. **Zero guides meet that spec.** The
average guide is at ~13% of target length and is missing 3 of the 7 required sections.

---

## Part 2 — Data pipeline: creation → storage → display → management

### 2.1 Creation

There is no creation pipeline. Guide prose was hand-written directly into a TypeScript
literal. The `consumer-guide` skill exists as a spec document but has:

- no agent module (`src/lib/agents/` has `magellan`, `rosetta`, `knox`, `darwin`,
  `hamilton` — nothing for guides),
- no API route,
- no run-ledger integration,
- no invocation site anywhere in `src/`.

This is the sharpest structural gap. Compare with `research_articles`, the repo's other
long-form content type, which *does* have the full stack: a table, a data-store module
(`src/lib/data-store/articles.ts`) with `status`, `generated_by`, `conversation_id`,
`published_at` and `view_count`, an admin surface at `/admin/research/articles`, a
Hamilton surface at `/admin/hamilton/research/articles`, and a public renderer at
`/research/articles/[slug]`. Guides are the only content type on the site with none of it.

### 2.2 Storage

Guides are **not in Postgres**. Confirmed: no `guide` table in `supabase/migrations/`
(15 recent migrations, none guide-related), no guide module in `src/lib/data-store/`.

Consequences that follow directly from storage-in-code:

- Every content edit is a code change, a PR, a CI run and a deploy.
- No draft/review/publish lifecycle, no versioning, no rollback, no audit trail of who
  changed what claim about a bank fee — on a page that makes financial claims.
- No `published_at` / `updated_at` per guide, so the page cannot show a per-guide
  freshness date. The "Updated <date>" line on both index and detail is `getDataFreshness()
  .last_crawl_at` — the *fee crawl* date, not the date the guide's advice was reviewed.
  A consumer reads "Updated Aug 2026" as "this advice was checked in August 2026." It
  wasn't.
- No view counts, no engagement data, so there is no signal for which guides to invest in.
- No per-guide access tier field, so the free/paid question (below) can't even be expressed.

### 2.3 Display

The live-data half of the page *is* correctly wired to the published tier. Both pages read
through `src/lib/data-store/fees.ts`, which queries `published_fee_catalog` with
`review_status = 'approved'` — the Hamilton output boundary, exactly as `CLAUDE.md`
requires. No `extracted_fees` reads. That part is clean.

The problem is that the prose half is a parallel, unversioned, hardcoded copy of the same
facts:

```
guides.ts:25   "These fees typically range from $25 to $38 per occurrence"
[slug]/page.tsx:153   {formatAmount(fee.median_amount)}   ← live from published_fee_catalog
```

Those two numbers sit roughly 400px apart on the same screen and are guaranteed to drift.
Nothing recomputes the prose when Hamilton publishes a new median. **This is the single
largest content-integrity risk on the surface**: a consumer-facing page that states a fee
range as fact, next to a live figure that can contradict it, with no mechanism to reconcile
them.

Query behaviour, per request (both pages are `force-dynamic`):

| Page | Calls | Pattern |
| --- | --- | --- |
| `/guides` | `getFeeCategorySummaries()`, `getStats()`, `getDataFreshness()` | 3 sequential `await`s (`page.tsx:179-181`) |
| `/guides/[slug]` | + `getFeeCategoryDetail(primary)` | 4 sequential `await`s (`[slug]/page.tsx:43-52`) |

`getFeeCategorySummaries()` selects **every approved row** in `published_fee_catalog`
joined to `institution_sources` and aggregates in JS (`fees.ts:88-97`) — a full scan on
every page view, to render ten cards. `getFeeCategoryDetail()` then pulls every row for the
primary category (`fees.ts:150-160`) so the page can take `slice(0,5)` and `slice(-5)` for
two sidebar lists. `generateStaticParams()` is declared at `[slug]/page.tsx:22` but
`force-dynamic` at line 1 makes it dead code — the guides never statically render even
though the prose is a compile-time constant.

### 2.4 Management

There is no management surface. No `/admin/guides`. Editing a guide means editing
`src/lib/guides.ts`. There is no way for a non-engineer — a content lead, a compliance
reviewer, a Hamilton operator — to touch this content at all.

### 2.5 Agentic connection

| Agent | Relationship to guides |
| --- | --- |
| Atlas | none — no guide run type |
| Magellan / Rosetta | none |
| Knox / Darwin | indirect: they gate what reaches `published_fee_catalog`, which feeds the live cards |
| Hamilton | indirect only — `runHamiltonPublish` writes `published_fee_records`; nothing downstream regenerates guide prose |

No guide operation creates an `agent_run`, `agent_run_step`, or `agent_run_event`. Today
that is vacuously compliant with the `CLAUDE.md` rule ("every agent action must create or
update a visible agent run/step/event") because no agent acts on guides. The moment guide
generation is automated — which the `consumer-guide` skill clearly anticipates — it must
land inside the run ledger, not in a script. That constraint should be designed in now.

---

## Part 3 — Template & consumer UI/UX review

### 3.1 What works

The visual system is genuinely good and should be preserved:

- Coherent warm editorial palette (`#FAF7F2` ground, `#C44B2E` accent, `#E8DFD1` rules)
  applied consistently; Newsreader serif for headings and figures, sans for UI chrome.
- Data typography is right: `tabular-nums` on every figure, light weight at large size for
  medians — the numbers read as data, not as marketing.
- Restrained motion — 300–700ms transitions, a 2px gradient top-rule on hover, a 1px arrow
  translate. Nothing bounces.
- Genuine information density in the sidebar: median + P25/P75 + cheapest 5 + most
  expensive 5 + a $0-charging count. For a consumer asking "is my bank ripping me off,"
  that stack is the right stack.
- The distribution histogram (`[slug]/page.tsx:198-229`) is the strongest element on the
  page — it answers "where do I sit" better than any median can.
- Both routes have `loading.tsx` skeletons.
- Breadcrumb is sticky on mobile, static on desktop (`[slug]/page.tsx:78`) — a considered
  responsive detail.

### 3.2 Template defects

**T1 — The H1 throws away the value proposition.** Every render uses
`guide.title.split(":")[0]` (`[slug]/page.tsx:103`, index `page.tsx:101`, breadcrumb
`:87`, more-guides list `:347`). So the authored title
*"Understanding Overdraft Fees: What Banks Charge and How to Avoid Them"* displays as
*"Understanding Overdraft Fees"*. The half that says what the reader gets — "and How to
Avoid Them" — is discarded everywhere except `<title>`. The colon-split is a workaround
for a missing field; the model needs a separate `title` and `seoTitle`.

**T2 — Dead "median" label.** `page.tsx:85-89` renders the word "median" in the featured
card header with no number attached to it. The number lives in a separate block 30 lines
below with its own "median" label. One is redundant, one is orphaned.

**T3 — Two chips, one destination.** The sidebar renders "Distribution" and "By state"
chips (`[slug]/page.tsx:394-405`) that both `href` to `/fees/{category}`. "By state"
promises a filtered view and delivers the same page. Worse, for a signed-out consumer the
by-state breakdown on that page is behind `UpgradeGate` (`fees/[category]/page.tsx:211`)
— so the chip promises something the reader then cannot see.

**T4 — Primary-category disagreement.** The distribution chart uses
`guide.feeCategories[0]` (`[slug]/page.tsx:51`) but the primary CTA button uses
`relevantFees[0]` (`:180-190`), and `relevantFees` inherits the global ordering of
`getFeeCategorySummaries()` — sorted by institution count across the *whole* taxonomy
(`fees.ts:134`). For any guide whose first-listed category isn't its most-covered, the
chart analyses one fee while the button offers another. The sidebar, hero cards and
"Explore the Data" grid all inherit the same arbitrary order.

**T5 — Prose is a single `<p>` per section.** `[slug]/page.tsx:243-245` renders
`section.content` as one paragraph of plain text. The content type is `string`, so there
is no way to express a list, a bolded figure, a link to `/fees/overdraft`, a callout, or a
table — every device the `consumer-guide` skill mandates ("bullet points and numbered
lists for scannability", "bold key dollar amounts"). Section 3 of every guide is a list of
tips rendered as an undifferentiated 60-word paragraph. `research/articles/[slug]` already
has a `MarkdownContent` renderer; guides don't use it.

**T6 — No "check my own bank" path.** This is the biggest consumer-journey gap. A reader
arrives asking "what does *my* bank charge?" The page offers: an institution-agnostic
median, five cheapest institutions nationally, five most expensive, and links to `/fees`
and `/api-docs`. There is no institution search, no "compare your bank" input, and no link
to `/institutions` or `/institution/[id]` anywhere on either guide page — despite
`/institutions` being the first item in the consumer nav. The guide is a dead end relative
to the site's own primary consumer action.

**T7 — Sidebar CTA is aimed at the wrong reader.** On a page whose eyebrow says "Consumer
Guide," the terminal CTA is a dark card headed "For Professionals" offering **API docs**
(`[slug]/page.tsx:493-521`). The index page's CTA is "benchmark your institution →
/subscribe" (`page.tsx:317-333`). Neither surface offers a consumer anything: no email
digest, no fee alert, no bank-comparison entry point, no save/share. Consumer traffic is
monetised only by being asked to buy a professional product.

**T8 — Incomplete SEO metadata on the site's most search-driven surface.**
`generateMetadata` (`[slug]/page.tsx:26-36`) sets only `title`, `description`, `keywords`
— no `openGraph`, no `twitter`, no `alternates.canonical`. `keywords` has been ignored by
Google since 2009. Five other routes on the site (`page.tsx`, `layout.tsx`, `methodology`,
`fees/[category]`, `reports/[slug]`) do set `openGraph`; guides — the pages most likely to
be shared into a group chat or a Reddit thread — do not. So a shared guide link renders
with no card image and falls back to site-level OG.

**T9 — Non-standard JSON-LD.** `[slug]/page.tsx:528-544` emits an `Article` whose
`mainEntity` is a nested `FAQPage`. Google expects `FAQPage` as a top-level type; nested
this way it is unlikely to earn FAQ rich results. The `Article` also omits `datePublished`,
`dateModified`, `author` and `publisher` — all of which Google uses for
financial-advice content, where E-E-A-T signals matter most.

**T10 — Accessibility gaps.** Section anchors are `id="section-0"`, `section-1`
(`[slug]/page.tsx:234`) — meaningless to a screen-reader user navigating by landmark and
unstable if a section is inserted. The "In This Guide" nav (`:474-490`) is a `<nav>`
without an `aria-label`, and there are several of them on the page. All decorative SVGs
lack `aria-hidden`. Body text at `#5A5347` on `#FAF7F2` is fine (~7.3:1), but the
`#A09788` metadata used at 10–11px for institution counts and ranges lands near 3.2:1 —
below AA for text that size.

**T11 — Factual inconsistency in chrome.** Both guide pages state "All 49 fee categories"
(`page.tsx:295`, `[slug]/page.tsx:300`). The taxonomy actually contains **65**
(`TAXONOMY_COUNT`). The "49" claim is repeated across ~10 other surfaces including
`/subscribe`, `/for-institutions`, `/register` and the public OpenAPI description, so this
is a site-wide copy fact that needs a single decision — flagged here, not unilaterally
changed, because it touches pricing and API marketing copy.

### 3.3 Access model — free consumer vs. paying professional

Currently there is **no tiering in guides at all**: all ten are fully public and fully
ungated, and no guide field can express a tier. That is correct for overdraft and NSF —
the CFPB-adjacent content that should be free as a matter of positioning — but it means
the surface does no work for the paying side of the business either.

The mismatch shows up where guides hand off to `/fees/{category}`. Only six categories are
spotlight (`monthly_maintenance`, `overdraft`, `nsf`, `atm_non_network`, `card_foreign_txn`,
`wire_domestic_outgoing`). A signed-out consumer following the "Deep Dive" tile from the
check-fees or safe-deposit guide reaches a page whose charter/tier/state breakdowns are all
behind `UpgradeGate`. The tile's own subtitle promises exactly those breakdowns
(`[slug]/page.tsx:281`: "Distribution, breakdowns by charter, state, tier"). The guide
advertises gated content as though it were open.

The audience segmentation the product needs, and the content model cannot currently express:

| Audience | Should get | Today |
| --- | --- | --- |
| Consumer (anon) | Overdraft, NSF, ATM, maintenance — free, complete, no gate | free but thin |
| Consumer (registered) | + fee alerts, saved institution, personalised "your bank vs median" | nothing |
| Bank / CU employee | "how our fee compares to peers", disclosure-language guidance | nothing in guides |
| Consultant (paid) | methodology, peer-set construction, revenue-impact framing | nothing in guides |

---

## Part 4 — Audit findings

Severity: **P0** = shipping incorrect information or broken behaviour · **P1** = material
consumer or business impact · **P2** = quality and scale.

### Pipeline

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| P-1 | **P0** | *(fixed in this pass)* 5 of 27 guide fee-category references did not exist in the taxonomy, so 4 of 10 guides silently dropped a benchmark card, a sidebar row and an Explore tile, with no error | `guides.ts` — `returned_item`, `atm_balance_inquiry`, `wire_international_outgoing`, `wire_international_incoming`, `account_closure` |
| P-2 | **P0** | Prose states fee ranges as fact ("$25 to $38") that nothing reconciles against the live median rendered on the same page | `guides.ts:25` vs `[slug]/page.tsx:153` |
| P-3 | **P1** | Guides live in code, not Postgres: no draft/publish lifecycle, no versioning, no author, no per-guide `updated_at`, no view counts | no guide table in `supabase/migrations/` |
| P-4 | **P1** | "Updated <date>" shows the fee-crawl date, presented to consumers as the date the advice was reviewed | `[slug]/page.tsx:118-130` |
| P-5 | **P1** | No management surface — every content change is a deploy; no non-engineer can edit | no `/admin/guides` |
| P-6 | **P1** | `consumer-guide` skill is orphaned: no agent module, no route, no run-ledger integration, no caller | `.claude/skills/consumer-guide/SKILL.md` |
| P-7 | **P2** | Full-table scan of `published_fee_catalog` on every guide page view to render ten cards | `fees.ts:88-97` |
| P-8 | **P2** | 3–4 sequential awaits per page; no `Promise.all` | `page.tsx:179-181`, `[slug]/page.tsx:43-52` |
| P-9 | **P2** | `generateStaticParams` dead under `force-dynamic`; compile-time-constant prose never statically renders | `[slug]/page.tsx:1,22` |
| P-10 | **P2** | Full category detail fetched to render two 5-row sidebar lists | `fees.ts:150-160` |

### UX / UI

| ID | Sev | Finding | Ref |
| --- | --- | --- | --- |
| U-1 | **P1** | No "check my own bank" path; zero links to `/institutions` or `/institution/[id]` | T6 |
| U-2 | **P1** | Consumer page's terminal CTA is API docs "For Professionals" | T7 |
| U-3 | **P1** | Guides advertise breakdowns that are paywalled for the reader being sent there | §3.3 |
| U-4 | **P1** | No `openGraph`/`canonical` on the most shareable surface on the site | T8 |
| U-5 | **P1** | Title value proposition discarded by `split(":")[0]` in 4 places | T1 |
| U-6 | **P2** | "By state" and "Distribution" chips resolve to the same URL | T3 |
| U-7 | **P2** | Chart category and CTA category can disagree | T4 |
| U-8 | **P2** | Orphaned "median" label in featured card | T2 |
| U-9 | **P2** | Non-standard nested `FAQPage`; no `datePublished`/`author` | T9 |
| U-10 | **P2** | Positional `#section-N` anchors; unlabelled `<nav>`s; undecorated SVGs; sub-AA contrast on 10–11px metadata | T10 |
| U-11 | **P2** | "All 49 fee categories" vs. actual 65 | T11 |

### Content

| ID | Sev | Finding |
| --- | --- | --- |
| C-1 | **P1** | Every guide is 117–142 words against the skill's 800–1,200 target — ~13% of spec |
| C-2 | **P1** | Mandated sections absent from all ten guides: "What Regulators Say" (Reg E opt-in, Reg DD), "Compare Your Bank", data attribution footer |
| C-3 | **P1** | Comparative claims are asserted, not sourced — "Credit unions generally charge less than banks" (`guides.ts:30`) is stated in prose while the site holds the `by_charter_type` breakdown that could prove it |
| C-4 | **P1** | Content type is `{heading, content: string}` — cannot express lists, bold figures, internal links, callouts or tables, all of which the skill requires |
| C-5 | **P2** | 42% taxonomy coverage; 40 categories unguided, including `minimum_balance` and `paper_statement` which are *directly* the waiver mechanics of the maintenance-fee guide |
| C-6 | **P2** | Rigid 3-section shape for every topic regardless of complexity |
| C-7 | **P2** | No author, no reviewer, no methodology link, no "last reviewed" — weak E-E-A-T for financial-advice content |
| C-8 | **P2** | No FAQ, no glossary, no related-guide logic (the "More Guides" grid is `GUIDES.filter(g => g.slug !== slug)` — all nine others, unranked, `[slug]/page.tsx:337`) |

---

## Part 5 — Improvement samples

Worked examples live in [`guides-improvement-samples/`](./guides-improvement-samples/):

| File | Shows |
| --- | --- |
| `01-guide-model-v2.md` | Proposed `Guide` type: split `title`/`seoTitle`, block-based sections, data bindings, `accessTier`, review metadata — with before/after |
| `02-consumer-guides-schema.md` | Proposed Postgres schema mirroring the `research_articles` pattern, plus the Atlas/Hamilton run-ledger contract for agent-generated guides |
| `03-sample-guide-overdraft.md` | The overdraft guide rewritten to the `consumer-guide` skill spec — 950 words, all seven sections, data-bound tokens instead of hardcoded dollar figures |
| `04-template-improvements.md` | Concrete before/after JSX for the ten highest-value template fixes |

Applied in this pass (see Part 6): the P-1 category fix and its regression test.

---

## Part 6 — Prioritised roadmap

**Now — correctness (done in this pass)**
- ✅ P-1: corrected the five dangling fee-category references in `src/lib/guides.ts`
  (`returned_item`→`deposited_item_return`, `atm_balance_inquiry`→`balance_inquiry`,
  `wire_international_*`→`wire_intl_*`, `account_closure`→`early_closure`).
- ✅ Added `src/lib/guides.test.ts` — 7 tests asserting every guide category exists in
  `FEE_FAMILIES` and has a `DISPLAY_NAMES` entry, slugs are unique and URL-safe, and no
  guide ships an empty section. This class of bug cannot regress silently again.

**Next — stop shipping contradictions (P0/P1, no schema change required)**
1. P-2/C-3: replace hardcoded dollar figures in prose with data-bound tokens resolved at
   render from `getFeeCategorySummaries()` (sample 03 shows the token format). Nothing else
   removes the drift risk.
2. U-5/T1: add `seoTitle` to the `Guide` type; stop calling `split(":")[0]`.
3. U-4: add `openGraph`, `twitter` and `alternates.canonical` to `generateMetadata`.
4. U-1: add a "Check your own bank" institution-search block to the guide template.
5. U-3: label paywalled destinations honestly, or route free consumers to the ungated view.
6. U-6/U-7/U-8: fix duplicate chips, pin the primary category to `feeCategories[0]`
   consistently, drop the orphan label.

**Then — content to spec (P1)**
7. C-4: change `GuideSection.content` from `string` to a block union (or reuse the existing
   `MarkdownContent` renderer from `research/articles/[slug]`).
8. C-1/C-2: rewrite all ten guides to the skill spec using sample 03 as the reference.
9. C-7: add `author`, `reviewedAt`, `methodologyHref`; surface a real per-guide review date
   distinct from the crawl date (P-4).

**Then — storage and management (P1)**
10. P-3: migrate guides to `consumer_guides` + `consumer_guide_sections` (sample 02).
11. P-5: build `/admin/guides` mirroring `/admin/research/articles`.
12. P-6: implement a guide agent that drafts from the `consumer-guide` skill against
    `published_fee_catalog`, writing `agent_run`/`agent_run_step`/`agent_run_event` per
    `CLAUDE.md`, landing drafts in review rather than publishing directly.

**Then — scale and monetisation (P2)**
13. P-7/P-8/P-9/P-10: add a cached category-summary read path, parallelise awaits, and
    return guides to static/ISR rendering.
14. C-5: extend coverage past 42%, starting with `minimum_balance` and `paper_statement`.
15. §3.3: add `accessTier` and build the registered-consumer tier (fee alerts, saved
    institution, "your bank vs median") — the missing rung between free reader and
    professional subscriber.
16. U-11: settle the 49-vs-65 category count site-wide.

---

## Appendix — verification

- Category validity checked by extracting `FEE_FAMILIES` and every `feeCategories` array
  and diffing the sets; 5 dangling references found pre-fix, 0 post-fix.
- Word counts computed from the `content` string literals in `src/lib/guides.ts`.
- `TAXONOMY_COUNT` = 65, `FEATURED_COUNT` = 15, spotlight = 6, evaluated directly from
  `src/lib/fee-taxonomy.ts`.
- `npx vitest run src/lib/guides.test.ts` → 7 passed.
- No `extracted_fees` reads exist in the guides surface; all fee reads go through
  `published_fee_catalog`, consistent with `CLAUDE.md`.
