# /guides Remediation Plan

**Living document.** Updated after each issue is resolved — status flipped, solution
documented, verification recorded. Source audit:
[`docs/audits/guides-audit-2026-08-15.md`](../audits/guides-audit-2026-08-15.md).
Worked samples: [`docs/audits/guides-improvement-samples/`](../audits/guides-improvement-samples/).

Branch: `claude/guides-review-audit-rbk1bt`

---

## How to use this document

Every issue from the audit has one entry below with a fixed shape:

- **Issue** — what is wrong, in one or two sentences.
- **Root cause** — why it is wrong, so the fix targets the cause and not the symptom.
- **Solution** — what to change.
- **Success criteria** — checkboxes. An issue is closed only when every box is ticked.
- **Verification** — the command or check that proves it.
- **Resolution** — filled in when closed: date, commit, and what actually shipped.

Status values: `DONE` · `IN PROGRESS` · `OPEN` · `BLOCKED` (needs a decision from the
product owner, named in the entry).

Work proceeds tranche by tranche. Within a tranche, order is free unless an entry names a
dependency.

---

## Progress

**26 work items** covering all **29 audit findings**, plus three items the audit did not
raise (D-4, E-3, E-4). Several items close more than one finding — B-8, B-9 and E-1 each
resolve three — because those findings share a single root cause and fixing them
separately would mean touching the same code three times.

| Tranche | Theme | Items | Findings closed | Done | Open | Blocked |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| A | Correctness | 1 | P-1 | 1 | 0 | 0 |
| B | Stop shipping contradictions | 9 | P-2 P-4 U-1…U-9 C-7 | 0 | 9 | 0 |
| C | Content to spec | 6 | C-1 C-2 C-3 C-4 C-6 C-8 | 0 | 6 | 0 |
| D | Storage & management | 5 | P-3 P-5 P-6 P-9 | 0 | 5 | 0 |
| E | Scale, coverage & tiering | 6 | P-7 P-8 P-10 C-5 U-11 | 0 | 6 | 0 |
| **Total** | | **27** | **29 of 29** | **1** | **26** | **0** |

Work items by severity: P0 **2** (1 done) · P1 **14** · P2 **11**.

**Nothing is blocked.** All four open decisions were answered 2026-08-15 — see
[Decisions](#decisions-answered-2026-08-15). E-5 is unblocked, E-4 has its topics, and
E-6 was added as a consequence of the institution-lookup answer.

---

## Access tier model

Corrected 2026-08-15 per product owner: **bank and credit-union employees are a paying
audience, on the same tier as consultants.** There is no separate institution tier. This
replaces the four-audience table in the audit.

| Tier | Who | Gets | Guides behaviour |
| --- | --- | --- | --- |
| `public` | Consumers, signed out | The consumer-education core — overdraft, NSF, ATM, monthly maintenance, and every other consumer fee guide. Complete, ungated, indexed. | Full guide. No gate anywhere in the body. |
| `registered` | Consumers with a free account | Everything in `public`, plus a saved institution, fee-change alerts on it, and the 3 daily AI research queries `getResearchQueryLimit` already grants | Full guide + personalisation blocks ("your bank vs. the median"). Never gates guide prose. |
| `pro` | **Bank / CU employees and consultants — one paying tier** | Peer positioning, disclosure-language guidance, methodology depth, revenue-impact framing, peer-set construction | Professional guides live here in full. Consumer guides stay ungated for pro users too. |

Two rules follow, and both are load-bearing:

1. **A guide's `accessTier` gates the whole guide, never a section of it.** Half-gated
   consumer education reads as bait. A guide is either `public` or it is a `pro` guide.
2. **Every consumer fee guide is `public`.** The paid tier is served by *different guides
   written for a different reader* — "Benchmarking your overdraft fee against your peer
   set" is a `pro` guide; "Overdraft fees and how to avoid them" is `public` forever.

This changes three things versus the audit as written:

- `GuideAudience` collapses from `consumer | institution | consultant` to
  **`consumer | professional`**.
- U-3 (guides advertising paywalled breakdowns) is a `public`-tier honesty problem, and its
  fix is labelling plus routing — not a new tier.
- E-3 (the registered rung) is the only genuinely new surface to build, and it sits between
  free reader and `pro`, aimed squarely at consumers.

---

# Tranche A — Correctness

Ships nothing but correctness. No product decisions.

### A-1 · P-1 — Dangling fee-category references `P0` `DONE`

**Issue.** Five of the twenty-seven fee-category references in the guide catalog did not
exist in the fee taxonomy. Four of the ten guides silently dropped a benchmark card, a
sidebar row and an "Explore the Data" tile, with no build error, no runtime error and no
symptom other than a shorter page.

**Root cause.** `guide.feeCategories` is an untyped `string[]` joined against
`getFeeCategorySummaries()` results with `Array.includes`. A non-matching string yields an
empty filter result — indistinguishable from "this category has no data yet". Nothing in
the type system or CI related the two lists.

**Solution.** Correct the five slugs to their real taxonomy keys, and add a test that
diffs every guide's categories against `FEE_FAMILIES` so the class of bug cannot recur.

**Success criteria.**
- [x] All five references resolve to real taxonomy keys
- [x] Every guide category has a `DISPLAY_NAMES` entry
- [x] A test fails if any guide references a category outside `FEE_FAMILIES`
- [x] `tsc --noEmit` and `eslint` clean
- [x] Relevant `ci-guards.sh` checks pass

**Verification.** `npx vitest run src/lib/guides.test.ts` → 7 passed.

**Resolution — 2026-08-15, commit `21a3c72`.**
Corrected in `src/lib/guides.ts`:

| Was | Now |
| --- | --- |
| `returned_item` | `deposited_item_return` |
| `atm_balance_inquiry` | `balance_inquiry` |
| `wire_international_outgoing` | `wire_intl_outgoing` |
| `wire_international_incoming` | `wire_intl_incoming` |
| `account_closure` | `early_closure` |

Added `src/lib/guides.test.ts` — seven tests covering category validity, display-name
coverage, slug uniqueness, URL-safe slugs, `getGuide` resolution, per-guide category
non-emptiness and non-duplication, and non-empty sections. `tsc`, `eslint` and seven
`ci-guards.sh` subcommands clean.

---

# Tranche B — Stop shipping contradictions

The highest-value tranche. No schema work; every item is reachable from the current
`Guide` type plus the optional fields in sample 01. **B-1 is the reason this tranche
exists** — the rest are cheap once the model is extended.

### B-1 · P-2 — Prose figures drift from live medians `P0` `OPEN`

**Issue.** Guide prose states fee amounts as string literals — *"typically range from $25
to $38 per occurrence"* — roughly four hundred pixels from a live median read from
`published_fee_catalog`. Nothing relates them. The prose cannot be right for long, and
when it is wrong it is wrong on a consumer-facing page making a financial claim.

**Root cause.** Two sources of truth for the same fact. The prose source is a hand-typed
literal with no review date and no owner; the card source is a live query. There is no
mechanism — not a test, not a lint, not a job — that compares them.

**Solution.** Delete one source. Prose keeps `{{category.stat}}` tokens; a resolver
substitutes them at render from the *same* `getFeeCategorySummaries()` result the cards
already use. Token grammar and the `resolveTokens` implementation are in
[sample 01](../audits/guides-improvement-samples/01-guide-model-v2.md#data-binding--the-fix-for-the-drift-risk-p-2).

**Success criteria.**
- [ ] `resolveTokens(text, summaries)` implemented, escaping input before substitution and
      emitting only `<strong>`/`<span>`
- [ ] Supports `median`, `p25`, `p75`, `min`, `max`, `institutions`, `zero_count`
- [ ] Every hardcoded dollar figure and count removed from `src/lib/guides.ts` prose
- [ ] An unresolvable token fails a test — it never renders raw and never renders a wrong number
- [ ] A test asserts every token's category exists in the taxonomy *and* in the guide's own
      `feeCategories` (a token may only cite a fee the guide declares)
- [ ] Zero-data case renders an em dash, not `$0` or `$NaN`

**Verification.** `npx vitest run src/lib/guides.test.ts` — new cases: token grammar,
escaping, unknown category, missing stat, empty summaries.

**Resolution.** —

---

### B-2 · U-5 — Title value proposition discarded `P1` `OPEN`

**Issue.** `guide.title.split(":")[0]` appears in four places, so *"Understanding Overdraft
Fees: What Banks Charge and How to Avoid Them"* renders as *"Understanding Overdraft
Fees"*. The half that tells the reader what they get survives only in `<title>`.

**Root cause.** One field carrying two jobs — H1 and SEO title. The split is a workaround
for a missing field.

**Solution.** Add `seoTitle` to `Guide` (optional, defaulting to `title`). Shorten `title`
to the H1 form. Delete all four `split(":")` calls.

**Success criteria.**
- [ ] `Guide` has `title` (H1) and `seoTitle` (`<title>` / `og:title`)
- [ ] Zero occurrences of `split(":")` under `src/app/(public)/guides/`
- [ ] Index card, detail H1, breadcrumb and "More Guides" list all render `title` intact
- [ ] `generateMetadata` uses `seoTitle`
- [ ] A test asserts both fields are non-empty for every guide

**Verification.** `grep -rn 'split(":")' src/app/\(public\)/guides/` → no matches;
`npx vitest run src/lib/guides.test.ts`.

**Resolution.** —

---

### B-3 · U-1 — No path to "my own bank" `P1` `OPEN`

**Issue.** The consumer journey's dead end. A reader arrives asking what *their* bank
charges; the page offers a national median, five cheapest, five most expensive, and links
to the fee index and API docs. There is no institution search and no link to
`/institutions` or `/institution/[id]` on either guide page — despite "Find Your
Institution" being the first item in the consumer nav.

**Root cause.** The guides were built as a leaf SEO surface, not as a step in the consumer
journey. Nothing routes outward to the site's own primary consumer action.

**Solution.** Add a "Check your own bank" block below the benchmark cards, linking to
`/institutions`. Markup in
[sample 04 §2](../audits/guides-improvement-samples/04-template-improvements.md).

**Scope decided 2026-08-15.** Ship the plain link now; do not block on a fee-aware
directory. `/institutions` today takes `q`, `state` and `charter` only, and its results
table shows a *count* of published fees per institution — never a specific fee amount. A
`?fee=` parameter would therefore be inert. Closing the dead end is worth far more than
the polish, so B-3 ships the link and **E-6** carries the fee-aware version separately.

**Success criteria.**
- [ ] Every guide page renders an institution-lookup block above the fold on desktop
- [ ] The block names the live median for the primary category (via B-1 tokens)
- [ ] The link goes to `/institutions` with no parameter the page does not honour
- [ ] Copy sets the right expectation — "search your bank," not "see your bank's overdraft fee"
- [ ] Keyboard-reachable with a visible focus state

**Verification.** Manual pass on three guides at 375px and 1280px; confirm no dead
parameter is emitted.

**Depends on** B-1 (for the median in the heading).

**Resolution.** —

---

### B-4 · U-2 — Terminal CTA aimed at the wrong reader `P1` `OPEN`

**Issue.** On a page whose eyebrow reads "Consumer Guide," the closing sidebar card is
headed **"For Professionals"** and offers API documentation. The index page's CTA sells a
Pro subscription. Neither offers a consumer anything.

**Root cause.** The funnel has two rungs — anonymous reader and paying subscriber — with
nothing between them, so every CTA on every surface points at the paid tier regardless of
who is reading.

**Solution.** On `audience: "consumer"` guides, replace the API card with a free-account
offer: save your institution, get alerted when it raises this fee. Keep a single quiet
professional line. On `audience: "professional"` guides, keep the pro CTA.

**Success criteria.**
- [ ] Consumer guides render a consumer CTA; no API-docs card on any consumer guide
- [ ] The CTA names the specific fee and the specific benefit, not "upgrade"
- [ ] Register link carries intent + category so the account flow can act on it
- [ ] Index-page CTA reworked the same way
- [ ] Professional guides (once they exist, E-4) still render the pro CTA

**Verification.** Manual pass; `grep` for `api-docs` under the guides tree returns only
intended occurrences.

**Depends on** the `audience` field from B-8.

**Resolution.** —

---

### B-5 · U-3 — Guides advertise content the reader cannot see `P1` `OPEN`

**Issue.** The "Deep Dive" tile promises "Distribution, breakdowns by charter, state,
tier" to every reader. Only six categories are spotlight; for the rest, a signed-out
consumer following that link lands on a page where all of those breakdowns sit behind
`UpgradeGate`.

**Root cause.** The tile copy is a hardcoded string with no knowledge of the destination's
gating, and no knowledge of the reader.

**Solution.** Per the tier model above, consumer education is never half-gated. Make the
tile honest: label what a free reader will actually get, and mark gated destinations
explicitly rather than discovering the gate on arrival.

**Success criteria.**
- [ ] Tile copy is derived from `getSpotlightCategories()`, not hardcoded
- [ ] Non-spotlight destinations carry a visible "breakdowns require a subscription" marker
      with an accessible label, not a bare icon
- [ ] No guide describes a destination capability the current reader will not receive
- [ ] A test asserts the copy branch matches the spotlight set

**Verification.** `npx vitest run` on the new tile-copy test; manual check signed out on a
spotlight and a non-spotlight guide.

**Resolution.** —

---

### B-6 · U-4 — No OpenGraph, Twitter or canonical `P1` `OPEN`

**Issue.** `generateMetadata` sets only `title`, `description` and `keywords` — the last
ignored by search engines since 2009. Five other routes on the site set `openGraph`;
guides, the pages most likely to be shared into a group chat or a forum thread, do not. A
shared guide link renders with no card.

**Root cause.** The route was written before the site's OG conventions were established
and never revisited.

**Solution.** Add `openGraph`, `twitter` and `alternates.canonical`; drop `keywords`. Add
an OG image route rendering the guide title over the primary category's live median. Diff
in [sample 04 §3](../audits/guides-improvement-samples/04-template-improvements.md).

**Success criteria.**
- [ ] `openGraph` with `type: "article"`, title, description, url, `publishedTime`,
      `modifiedTime`, image
- [ ] `twitter` card `summary_large_image`
- [ ] `alternates.canonical` absolute, matching the sitemap entry exactly
- [ ] `keywords` removed
- [ ] OG image route returns 200 for every guide slug at 1200×630
- [ ] Index page gets the same treatment

**Verification.** Fetch each `/guides/[slug]`, assert the OG tags are present and the
canonical matches `src/app/sitemap.ts`.

**Depends on** B-2 (`seoTitle`) and B-8 (`publishedAt` / `reviewedAt`).

**Resolution.** —

---

### B-7 · U-9 — Non-standard structured data `P2` `OPEN`

**Issue.** `FAQPage` is nested under an `Article`'s `mainEntity`, where it is unlikely to
earn rich results. The `Article` omits `datePublished`, `dateModified`, `author` and
`publisher` — exactly the signals that matter most for financial-advice content.

**Root cause.** The two schema types were merged into one block rather than emitted
separately.

**Solution.** Emit `Article` and `FAQPage` as two top-level JSON-LD blocks. Populate dates
from `publishedAt` / `reviewedAt`, author and publisher from the guide's own fields. Point
FAQ entries at the stable section anchors from B-9.

**Success criteria.**
- [ ] Two separate top-level JSON-LD blocks
- [ ] `Article` carries `datePublished`, `dateModified`, `author`, `publisher`
- [ ] FAQ entries reference real anchor fragments
- [ ] Both blocks validate against Schema.org's structured-data validator
- [ ] Escaping preserved (`.replace(/</g, "\\u003c")`)

**Verification.** Validate one guide's emitted JSON-LD; assert both `@type`s present in a
render test.

**Depends on** B-8, B-9.

**Resolution.** —

---

### B-8 · U-7 + P-4 + C-7 — Primary category, freshness and authorship `P1` `OPEN`

Three symptoms of one missing set of fields; fixed together.

**Issue.**
1. *(U-7)* The distribution chart uses `feeCategories[0]` while the primary CTA uses
   `relevantFees[0]` — which inherits a sort by institution count across the *whole*
   taxonomy. For any guide whose first category is not its most-covered, the chart analyses
   one fee while the button offers another.
2. *(P-4)* "Updated &lt;date&gt;" renders `getDataFreshness().last_crawl_at` — the fee-crawl
   date. A reader takes it as the date the advice was reviewed. It was not.
3. *(C-7)* No author, no reviewer, no methodology link, no "last reviewed" — weak E-E-A-T
   on financial-advice pages.

**Root cause.** The `Guide` type has no `primaryCategory`, no `reviewedAt`, no
`publishedAt` and no `author`, so the template improvises each one from whatever is at
hand.

**Solution.** Add `primaryCategory`, `relatedCategories`, `audience`, `family`, `featured`,
`author`, `publishedAt`, `reviewedAt`, `methodologyHref` per sample 01. Sort
`relevantFees` into the guide's own editorial order. Render both dates distinctly: "Fee
data updated &lt;crawl&gt;" and "Guide last reviewed &lt;reviewedAt&gt;".

**Success criteria.**
- [ ] Chart, hero CTA, sidebar order and "Explore the Data" order all derive from
      `primaryCategory` + `relatedCategories`
- [ ] `relevantFees` sorted by editorial order, never by global institution count
- [ ] The two dates are visually and semantically distinct; neither is labelled ambiguously
- [ ] Byline and methodology link render on every guide
- [ ] `PRIMARY_SLUGS` and `FAMILY_LABELS` lookups deleted in favour of `featured` / `family`
- [ ] Tests assert `primaryCategory` ∈ taxonomy, `primaryCategory` ∉ `relatedCategories`,
      and `reviewedAt` parses as a date

**Verification.** `npx vitest run src/lib/guides.test.ts`; manual check that chart and CTA
name the same fee on `wire-transfer-fees` and `check-fees`.

**Resolution.** —

---

### B-9 · U-6 + U-8 + U-10 — Display defects and accessibility `P2` `OPEN`

**Issue.**
- *(U-6)* "Distribution" and "By state" chips both link to `/fees/{category}`.
- *(U-8)* The featured card renders the word "median" with no number attached, while the
  real median renders thirty lines below with its own label.
- *(U-10)* Positional `#section-0` anchors; several unlabelled `<nav>` elements; decorative
  SVGs without `aria-hidden`; the `#A09788` metadata token at 10–11px lands near 3.2:1 on
  the cream ground, below AA for that size.

**Root cause.** Accumulated template drift; no accessibility pass on this route.

**Solution.** Collapse the duplicate chips to one "Full analysis" link. Delete the orphan
label. Give sections stable `id`s from a new `GuideSection.id`. Label every `<nav>`. Mark
decorative SVGs `aria-hidden="true" focusable="false"`. Darken the small-text token to
roughly `#8A8073`.

**Success criteria.**
- [ ] No two links in the same component share a destination with different labels
- [ ] No label renders without the value it labels
- [ ] Section anchors are stable slugs, unique per guide, asserted by test
- [ ] Every `<nav>` on the route has an `aria-label`
- [ ] Every decorative SVG is `aria-hidden`
- [ ] All text ≥ 4.5:1, or ≥ 3:1 where it qualifies as large — measured, both themes
- [ ] Visible focus state on every interactive element

**Verification.** Contrast measured on the shipped tokens; keyboard tab pass through both
pages; axe scan with zero serious or critical violations.

**Note.** The metadata token is shared beyond guides. Change it in one place and check the
other consumers, or scope it to the guides route — do not fork the palette silently.

**Resolution.** —

---

# Tranche C — Content to spec

Requires the block model. **C-1 gates the rest of the tranche.**

### C-1 · C-4 — Content type cannot express the required formatting `P1` `OPEN`

**Issue.** `GuideSection.content` is a `string` rendered as a single `<p>`. There is no way
to express a list, a bold figure, an internal link, a callout or a table — every device the
`consumer-guide` skill mandates. Section three of every guide is a numbered list of tips
flattened into an undifferentiated sixty-word block.

**Root cause.** The content type was designed for a one-paragraph placeholder and never
grew with the requirement.

**Solution.** Replace `content: string` with `blocks: GuideBlock[]` — paragraph, list,
callout, stat, comparison — per sample 01, with a paragraph fallback so partial conversion
always renders. Reuse the `MarkdownContent` renderer from `research/articles/[slug]`
rather than writing a second escaping path.

**Success criteria.**
- [ ] `GuideBlock` union defined; renderer handles every variant
- [ ] Escaping happens before substitution; renderer emits only a known-safe tag set
- [ ] A guide mid-conversion renders correctly (paragraph fallback holds)
- [ ] Lists render as real `<ol>`/`<ul>`, not styled paragraphs
- [ ] Token resolution (B-1) works inside every block variant
- [ ] No duplicated escaping logic between guides and articles

**Verification.** Render test per block variant, including a token inside a list item and
an XSS attempt in every variant.

**Depends on** B-1.

**Resolution.** —

---

### C-2 · C-1 — Guides are at ~13% of spec length `P1` `OPEN`

**Issue.** Every guide is 117–142 words against the `consumer-guide` skill's 800–1,200
target. The average guide is roughly an eighth of the length it is supposed to be.

**Root cause.** The guides were seeded as placeholders and never written.

**Solution.** Rewrite all ten to the skill spec, using
[sample 03](../audits/guides-improvement-samples/03-sample-guide-overdraft.md) as the
reference — ~950 words, seven sections, every figure a bound token.

**Success criteria.**
- [ ] All ten guides 800–1,200 words
- [ ] Zero hardcoded dollar figures or institution counts anywhere in guide prose
- [ ] Reading level Grade 7–9
- [ ] Second person throughout; no industry vocabulary ("non-interest income", "DDA")
- [ ] Every supporting category earns its place in the prose rather than sitting as an
      unexplained card
- [ ] A test asserts word count is within range for every guide

**Verification.** `npx vitest run src/lib/guides.test.ts` word-count case; manual reading
pass per guide.

**Depends on** C-1, B-1.

**Resolution.** —

---

### C-3 · C-2 — Mandated sections missing from all ten guides `P1` `OPEN`

**Issue.** Three sections the skill requires are absent from every guide: "What Regulators
Say", "Compare Your Bank", and the data-attribution footer.

**Root cause.** Same as C-2 — the structure was never built out.

**Solution.** Add all three to each guide. Regulatory content in plain language (Reg E
opt-in, Reg DD statement totals, CFPB complaint routes) with no CFR citations. "Compare
Your Bank" as a benchmarking table keyed to P25/median/P75. Attribution footer naming the
institution count, the review date and the methodology link.

**Regulatory sign-off decided 2026-08-15.** The product owner signs off regulatory
content, **through admin functionality on the Hamilton surface** — not in a code review and
not in a document. That makes sign-off a state in the guide workflow, not a convention:

- A guide carrying regulatory content cannot reach `published` without an explicit
  approval action recorded against a named approver.
- The approval is captured on the guide revision, so "who approved this Reg E statement,
  and when" is answerable from the record.
- Re-drafting regulatory content (D-4) **invalidates the prior approval** and returns the
  guide to review. An agent may never inherit a human's sign-off.
- This adds a `regulatory_review` requirement to D-2's workflow and a hard gate to D-3.

**Success criteria.**
- [ ] All ten guides carry all three sections
- [ ] Regulatory statements are accurate and cite the rule by common name only
- [ ] Guides flagged as carrying regulatory content cannot publish without a recorded
      approval from a named approver on the Hamilton admin surface
- [ ] The approval is stamped on the revision, with approver and timestamp
- [ ] Re-drafting regulatory content clears the approval and returns the guide to review
- [ ] "Compare Your Bank" thresholds are bound tokens, never literals
- [ ] Attribution footer renders the institution count and the guide review date
- [ ] A test asserts the three required section anchors exist on every guide

**Verification.** Section-presence test; attempt to publish a regulatory guide without
approval and confirm it is refused; confirm the approval record survives a re-draft as
*cleared*, not as *inherited*.

**Depends on** C-1, B-1, B-8, and — for the gate itself — D-2.

**Resolution.** —

---

### C-4 · C-3 — Comparative claims asserted, not sourced `P1` `OPEN`

**Issue.** "Credit unions generally charge less than banks" is stated as prose while the
site holds the `by_charter_type` breakdown that would prove it — or disprove it, per
category.

**Root cause.** No block type could render a computed comparison, so the claim was typed
instead of derived.

**Solution.** Add the `comparison` block from sample 01, rendering the live
`by_charter_type` (or asset-tier) split for the cited category. Where a claim cannot be
backed by data, delete the claim.

**Success criteria.**
- [ ] Every charter/tier/geography comparison in prose is either rendered from data or removed
- [ ] The comparison block degrades to nothing — not to a broken frame — when a category
      has too few observations
- [ ] A minimum-observations threshold is defined and enforced before a comparison renders
- [ ] No prose sentence asserts a directional comparison the page does not show

**Verification.** Grep guide prose for comparative language and confirm each instance is
backed; render test for the sparse-data path.

**Depends on** C-1.

**Resolution.** —

---

### C-5 · C-6 — Rigid three-section shape `P2` `OPEN`

**Issue.** Every guide has exactly three sections regardless of topic complexity. Overdraft
and safe-deposit-box fees get identical structure.

**Root cause.** Copy-paste seeding.

**Solution.** Let section count follow the topic, within the skill's spec. Keep the three
mandated sections as a floor, not a ceiling.

**Success criteria.**
- [ ] Section count varies across guides and reflects topic complexity
- [ ] The mandated sections (C-3) are present on all guides regardless of count
- [ ] The in-page "In This Guide" nav handles a longer list without overflow at 375px

**Verification.** Visual pass at 375px on the longest guide.

**Depends on** C-2, C-3.

**Resolution.** —

---

### C-6 · C-8 — No FAQ, glossary or related-guide logic `P2` `OPEN`

**Issue.** "More Guides" renders every other guide, unranked
(`GUIDES.filter(g => g.slug !== slug)`). There is no FAQ block and no glossary, on a
surface whose whole job is explaining vocabulary.

**Root cause.** No `relatedSlugs` field and no relatedness signal.

**Solution.** Add `relatedSlugs`, defaulting to guides sharing a fee family, capped at
four. Add an FAQ block type feeding the `FAQPage` JSON-LD from B-7. Add a glossary block
for the three or four terms each guide introduces.

**Success criteria.**
- [ ] "More Guides" shows at most four, ranked by relatedness
- [ ] A test asserts every `relatedSlugs` entry resolves to a real guide and excludes self
- [ ] FAQ block renders and feeds the JSON-LD from the same source
- [ ] Glossary terms are defined once and reused, not redefined per guide

**Verification.** `npx vitest run src/lib/guides.test.ts`; confirm JSON-LD FAQ entries match
rendered FAQ.

**Depends on** C-1, B-7.

**Resolution.** —

---

# Tranche D — Storage & management

Moves guides out of code. **D-1 gates the tranche.** Load the
`supabase-postgres-best-practices` skill before writing the migration.

### D-1 · P-3 — Guides live in code, not Postgres `P1` `OPEN`

**Issue.** No guide table, no data-store module. No draft/publish lifecycle, no versioning,
no rollback, no author, no per-guide `updated_at`, no view counts. Every content edit is a
code change, a PR, a CI run and a deploy.

**Root cause.** The surface was built as a static SEO page and never migrated to the
content pattern `research_articles` already established.

**Solution.** `consumer_guides` + `consumer_guide_sections` + `consumer_guide_revisions`,
mirroring `research_articles` conventions, plus `src/lib/data-store/guides.ts`. Schema in
[sample 02](../audits/guides-improvement-samples/02-consumer-guides-schema.md).

**Success criteria.**
- [ ] Tables created with `status`, `access_tier`, `audience`, `author`, `reviewed_at`,
      `published_at`, `view_count`, `generated_by`, `agent_run_id`
- [ ] RLS reviewed explicitly — anonymous traffic reads published rows; drafts are never
      publicly readable
- [ ] `consumer_guide_revisions` captures a full snapshot on every publish
- [ ] `src/lib/data-store/guides.ts` exposes the read/write surface including
      `getGuidesForCategory`
- [ ] Existing ten guides seeded with content identical to what ships today
- [ ] Public pages read from the data store; the literal array is deleted
- [ ] `ci-guards.sh migration-history-kill` and `catalog-contract-kill` pass

**Verification.** Seed then diff rendered output against the pre-migration pages; confirm
an anonymous session cannot read a draft.

**Depends on** B-8, C-1 (the shape must settle before it is persisted).

**Resolution.** —

---

### D-2 · P-5 — No management surface `P1` `OPEN`

**Issue.** No `/admin/guides`. No compliance reviewer, content lead or operator can edit
consumer-facing financial advice without an engineer and a deploy.

**Root cause.** Follows directly from D-1.

**Solution.** Build `/admin/guides` mirroring `/admin/research/articles`: list, edit,
preview, publish, revision history, and a token-resolution preview showing what the reader
will actually see.

**Regulatory review is part of this surface** (per the C-3 decision). The status machine is
`draft → in_review → regulatory_review → published`, where the third state applies only to
guides flagged as carrying regulatory content, and is where the product owner signs off on
the Hamilton surface.

**Success criteria.**
- [ ] List with status, tier, audience, review date, view count
- [ ] Edit with live token preview — an unresolvable token is visible before publish, not after
- [ ] Publish writes a revision row and stamps `reviewed_at`
- [ ] Revision history is viewable and a prior revision can be restored
- [ ] Admin-only, consistent with the existing admin auth pattern
- [ ] Publishing requires an explicit action — no autosave-to-live
- [ ] Guides flagged regulatory route through `regulatory_review`; the publish control is
      disabled, with a stated reason, until approval is recorded
- [ ] The approver and approval timestamp are captured on the revision and visible in history
- [ ] Reachable from the Hamilton admin surface, alongside the existing research/articles tools

**Verification.** Create a draft, publish, edit, restore the prior revision; confirm the
public page reflects each state correctly.

**Depends on** D-1.

**Resolution.** —

---

### D-3 · P-6 — The `consumer-guide` skill is orphaned `P1` `OPEN`

**Issue.** The skill exists as a spec with no agent module, no route, no run-ledger
integration and no caller anywhere in `src/`.

**Root cause.** The skill was written before there was anywhere to run it.

**Solution.** `src/lib/agents/guides/draft.ts`, following the `runHamiltonPublish` shape.
Five steps, each visible in the ledger: read benchmarks, draft, validate, persist as
`in_review`, human publish. Contract in
[sample 02](../audits/guides-improvement-samples/02-consumer-guides-schema.md#agentic-contract).

**Success criteria.**
- [ ] Every run creates an `agent_run` with steps and events, per `CLAUDE.md`
- [ ] Benchmarks read from `published_fee_catalog` only
- [ ] Provider access through `src/lib/ai-provider.ts` — `provider-kill` stays clean
- [ ] Validation gate: token resolution, taxonomy membership, length, reading level
- [ ] **Never auto-publishes.** Drafts land in `in_review`; a human publishes
- [ ] Failed validation records an event and leaves the prior published guide untouched
- [ ] Not a script — an agent module, per `CLAUDE.md`

**Verification.** `ci-guards.sh provider-kill` and `script-kill` pass; a draft run appears
in the agent console with all five steps.

**Depends on** D-1, D-2.

**Resolution.** —

---

### D-4 — Re-draft on benchmark movement `P2` `OPEN`

**Issue.** Not in the original audit; it is the durable half of B-1. Token binding stops
the *numbers* drifting, but the surrounding argument still ages — "credit unions charge
meaningfully less" can stop being true.

**Root cause.** No feedback loop from publication to content review.

**Solution.** Hamilton already computes movement signals when it publishes. When a guide's
primary-category median moves past a threshold, enqueue a re-draft and flag the guide as
stale in admin.

**Success criteria.**
- [ ] A movement threshold is defined and documented
- [ ] Crossing it flags the guide stale and enqueues a draft run
- [ ] Staleness is visible in `/admin/guides`
- [ ] The public page never silently serves content flagged stale beyond a defined window
- [ ] The loop cannot publish without human approval

**Verification.** Simulate a median move; confirm the flag, the enqueued run and the admin
surface.

**Depends on** D-3.

**Resolution.** —

---

### D-5 · P-9 — Return guides to static rendering `P2` `OPEN`

**Issue.** `generateStaticParams` is declared but dead — `force-dynamic` means guides never
statically render, even though the prose is a compile-time constant today.

**Root cause.** `force-dynamic` was applied to get live fee data, taking the prose with it.

**Solution.** Once prose is in Postgres (D-1) and summaries are cached (E-1), switch to
`revalidate` + `generateStaticParams`, revalidating on publish.

**Success criteria.**
- [ ] `force-dynamic` removed from both guide routes
- [ ] `generateStaticParams` actually generates
- [ ] Publishing a guide or a Hamilton run revalidates the affected pages
- [ ] Rendered output is byte-identical to the dynamic version for a given data state

**Verification.** Build output lists the guide routes as static/ISR; publish and confirm
the page updates within the revalidation window.

**Depends on** D-1, E-1.

**Resolution.** —

---

# Tranche E — Scale, coverage & tiering

### E-1 · P-7 + P-8 + P-10 — Query cost `P2` `OPEN`

**Issue.** `getFeeCategorySummaries()` selects every approved row in
`published_fee_catalog` and aggregates in JavaScript on every page view to render ten
cards. The detail page then pulls every row for the primary category to take
`slice(0,5)` and `slice(-5)`. Both pages make three to four sequential awaits with no
`Promise.all`.

**Root cause.** Read paths written for correctness, never revisited for cost.

**Solution.** Parallelise the awaits. Cache the summary read with a tag revalidated on
Hamilton publish. Add a narrow `getCheapestAndMostExpensive(category, n)` for the sidebar.

**Success criteria.**
- [ ] All independent awaits parallelised on both pages
- [ ] Summary read cached, invalidated on publish rather than on a timer alone
- [ ] Sidebar lists no longer require a full category fetch
- [ ] Measured: rows read per guide page view drops by at least an order of magnitude
- [ ] Identical rendered output before and after

**Verification.** Query counts and row counts logged before and after on the same data.

**Resolution.** —

---

### E-2 · C-5 — 42% taxonomy coverage `P2` `OPEN`

**Issue.** Forty of sixty-five categories have no guide, including `minimum_balance` and
`paper_statement` — which are literally the waiver mechanics the monthly-maintenance guide
tells readers to use.

**Root cause.** The initial ten were chosen by search volume, not by journey coverage.

**Solution.** Prioritise by consumer impact, not category count. Start with the two that
close the maintenance-fee loop, then the consumer-facing remainder. Not every category
needs a guide — mortgage servicing and IRA fees are a different reader.

**Success criteria.**
- [ ] A documented list of which categories warrant a guide and which deliberately do not
- [ ] `minimum_balance` and `paper_statement` covered
- [ ] Every consumer-facing category is either covered or explicitly excluded with a reason
- [ ] Coverage figure reported in this document and kept current

**Verification.** Coverage computed from the taxonomy against the guide catalog.

**Depends on** C-2 (do not scale a format that is not yet right).

**Resolution.** —

---

### E-3 — Build the registered-consumer tier `P1` `OPEN`

**Issue.** The funnel is anonymous reader → paying subscriber, with nothing between, on the
surface where consumer traffic actually lands. Per the corrected tier model, the paid tier
is bank/CU employees and consultants — *not* consumers. Consumers need their own rung.

**Root cause.** The access model was built for the professional product; the consumer side
was never designed.

**Solution.** A free registered tier: save an institution, get alerted when it raises a
fee, and see "your bank vs. the median" inline on every guide. `getResearchQueryLimit`
already grants free registered users three daily queries — the tier partly exists in code
and has no surface.

**Success criteria.**
- [ ] A signed-in free user sees their saved institution's fee inline on relevant guides
- [ ] Fee-change alerts can be subscribed from a guide in one action
- [ ] Registration from a guide preserves intent and category through the flow
- [ ] **No guide prose is gated behind registration** — personalisation is additive only
- [ ] Consumer guides remain fully readable signed out, per the tier model

**Verification.** End-to-end: anonymous read → register from a guide → saved institution
appears inline → alert fires on a simulated fee change.

**Depends on** B-3, B-4.

**Resolution.** —

---

### E-4 — Professional guides for the paying tier `P2` `OPEN`

**Issue.** The paying audience — bank and CU employees, and consultants, one tier — gets
nothing from the guides surface today beyond a link to API docs.

**Root cause.** Guides were scoped as consumer-only; the professional reader was assumed to
live in `/pro` and `/research`.

**Solution.** A `pro`-tier guide set written for the other reader. Separate guides, not
gated sections of consumer ones.

**Opening topics decided 2026-08-15 — three guides, one per benchmarking dimension:**

| Guide | Question it answers | Data it stands on |
| --- | --- | --- |
| Building a peer set | "Who should we actually be compared against, and why is the national median the wrong yardstick?" | `by_asset_tier`, charter, district; the peer tooling under `/pro/peers` |
| Reading your state | "How does our state's fee landscape differ from national, and what does that mean for our pricing?" | `by_state`, the state reports under `/research/state/[code]` |
| Charter and institution type | "How much of the bank-versus-credit-union gap is charter, and how much is size?" | `by_charter_type` crossed with `by_asset_tier` |

These three are deliberately the same three dimensions the fee detail pages already
break down — so the guides explain the site's own analytical instrument rather than
introducing a parallel one. The professional reader learns to read `/fees/[category]`
properly, which is the product.

**Success criteria.**
- [ ] The three guides above exist as `audience: "professional"`, `accessTier: "pro"`
- [ ] Each is anchored to a real breakdown the site already computes — no guide asserts a
      dimension the data cannot support
- [ ] No consumer guide is reclassified or gated in the process
- [ ] Professional guides carry the pro CTA; consumer guides never do
- [ ] The index makes the two sets legible without making consumers feel gated
- [ ] Each guide links into the tool that performs the analysis it describes

**Verification.** Signed-out, free-registered and pro sessions each see the correct set.

**Depends on** B-8, E-3.

**Resolution.** —

---

### E-5 · U-11 — "49 fee categories" vs. an actual 65 `P2` `OPEN`

**Issue.** Both guide pages state "All 49 fee categories". `TAXONOMY_COUNT` is **65**. The
claim repeats across roughly ten surfaces including `/subscribe`, `/for-institutions`,
`/register`, `/pro`, `/account` and the public OpenAPI description.

**Root cause.** A literal that was true at one point and was never derived from the
taxonomy.

**Decided 2026-08-15.** The catalog is a **curated subset**, and **no hard number is
advertised**. This is the better answer than picking 49 or 65: a count is a promise that
has to be maintained forever, it goes stale the moment the taxonomy moves, and it invites
exactly the drift that produced this finding. Describing the coverage qualitatively is
accurate at every point in time.

**Solution.** Remove the numeric claim rather than correcting it. Replace with language
that describes the coverage without committing to a figure — "every fee category we
benchmark", "a curated set of consumer and commercial fee categories". Where a number is
genuinely informational rather than promotional — an API response describing its own
payload, an admin count — derive it from the taxonomy at runtime; never type it.

**Success criteria.**
- [ ] Zero hardcoded category counts in user-facing copy anywhere in `src/`
- [ ] The two guide occurrences replaced with non-numeric language
- [ ] Pricing, register, for-institutions, pro, account and OpenAPI copy updated
      consistently — one voice, not eight rewordings
- [ ] Any remaining numeric display derives from the taxonomy at runtime
- [ ] `getVisibleCategoryCount`'s free/paid split still works and no longer implies a
      total that copy contradicts
- [ ] A test fails if a hardcoded category count reappears in copy

**Verification.** `grep -rnE '\b(49|65) (fee )?categor' src/` returns nothing in copy.

**Note on scope.** The two guide occurrences are in scope for this plan. The other eight
touch pricing and public API description; they are listed for the same pass so the voice
stays consistent, but they are outside `/guides` and should be reviewed as marketing copy
before shipping.

**Resolution.** —

---

### E-6 — Fee-aware institution lookup `P2` `OPEN`

**Issue.** Split out of B-3. A consumer finishes the overdraft guide and clicks "Find your
institution." Today `/institutions` accepts only `q`, `state` and `charter`, and its
results table shows a *count* of published fees per institution — "12 verified" — never an
amount. The reader must find their bank, click into `/institution/[id]`, and scan a full
fee list for the one line they came for. `/institution/[id]` takes no search params and has
no per-fee anchors, so there is nothing to deep-link to either.

**Root cause.** The directory was built to answer "does this institution have fee data?"
The guides ask a different question — "what does this institution charge for *this* fee?"
— and no read path answers it.

**Solution.** Make the fee category a first-class dimension of the lookup, so the guide can
hand the reader straight to the answer.

**Success criteria.**
- [ ] `searchInstitutions` accepts a fee category and returns that fee's amount per row
- [ ] The results table shows the amount, and how it sits against the national median, when
      a category is supplied
- [ ] Results can be sorted by that amount
- [ ] `/institution/[id]` accepts a fee category and anchors or highlights that row
- [ ] Guides link with the category; the reader lands on the answer, not on a search box
- [ ] Institutions with no observation for that category are shown honestly as "not
      published", never as `$0`
- [ ] Reads go through `published_fee_catalog`, consistent with every other public fee read
- [ ] No new gating — this is `public`-tier behaviour, per the tier model

**Verification.** From three guides, follow the lookup to a named institution and confirm
the cited fee is visible without a manual scan; confirm the no-observation path.

**Depends on** B-3. **Note:** this touches `/institutions` and `/institution/[id]`, which
serve more than the guides — treat the parameter as additive and leave the unparameterised
behaviour unchanged.

**Resolution.** —

---

## Resolution log

Newest first. One line per closed issue.

| Date | Issue | Commit | Summary |
| --- | --- | --- | --- |
| 2026-08-15 | A-1 (P-1) | `21a3c72` | Corrected five dangling fee-category references; added `src/lib/guides.test.ts` (7 tests) closing the class of bug |

---

## Decisions

### Open

None. All decisions raised by the audit have been answered.

### Answered 2026-08-15

| # | Decision | Answer | Effect on the plan |
| --- | --- | --- | --- |
| 0 | Who is the paying audience? | Bank and CU employees are a paying audience, on the same tier as consultants | Audience collapses to `consumer \| professional`; access tiers to `public \| registered \| pro`. Added E-3 and E-4; reshaped B-5 |
| 1 | Advertised category count — 49, 65, or a curated subset? | **A curated subset, with no hard number advertised** | E-5 unblocked. The fix becomes *remove the claim*, not *correct the number* — a count is a promise that goes stale the moment the taxonomy moves |
| 2 | Which professional guide topics ship first? | **Peer set, state, and institution type** | E-4 now names three guides, one per benchmarking dimension — deliberately the same three the fee detail pages already break down, so the guides teach the site's own instrument |
| 3 | Does `/institutions` gain a category pre-filter? | **Staged** — ship the plain link now, build the fee-aware lookup separately | B-3 emits no dead parameter. New item **E-6** carries the real work: `/institutions` today cannot show a specific fee amount at all, so a `?fee=` param would have been inert |
| 4 | Who signs off regulatory content? | **The product owner, through admin functionality on the Hamilton surface** | Sign-off becomes a workflow state, not a convention. C-3 gains an approval gate; D-2 gains a `regulatory_review` status; D-4 must clear approval on re-draft — an agent never inherits a human's sign-off |

**Note on decision 3.** The question was poorly put the first time. Concretely: today a
reader clicking "Find your institution" from the overdraft guide lands on a name/state
search whose results show *"12 fees verified"* — a count, not the overdraft amount. They
then click into the institution and scan its full fee list for the line they came for.
Making the guide hand them the answer directly requires new work in `searchInstitutions`
and the results table, which is why it is now its own item rather than a condition on B-3.
