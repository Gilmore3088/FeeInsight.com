# Site v3 brief 08: the hero sizzle and the homepage copy (DRAPER with NORMAN)

> **Goal updated 2026-10-15 (James).** The site's goal is a Hamilton Pro subscription, monthly or
> annual. The paid report is a high-value lead, not the goal. The funnel: a free sample report, then
> the Competitive Fee Position Report ("from $300"), then Pro, either because the buyer wants it on a
> regular basis or because the report sparks a Pro demo request (through `/contact?source=demo`; no
> booking links). Where anything below ranks the report above Pro, this note wins.

Issue #1289. Written 2026-10-14. It follows James's direction of 2026-10-14: BetterAnalyst's page
shape, and a 20-second sizzle in the hero that walks from the pain of gathering fee data to
Fee Insight, the Bank Fee Index, the market view and Hamilton ("Hamilton is the chat process
which leads to a quick report"). It builds on 01 (SHERLOCK), 03 (DRAPER), 05 (ERNEST), 06 and 07
(NORMAN). Product facts were checked in code on `main` (fdd21bd7); the file is named where a
claim depends on it.

Rules held throughout: no number typed by hand (each names its live field or carries an on-screen
"Example" label); no testimonials, logos or user counts; no fee-change claims; Hamilton never
recommends a price. `[NEED: ...]` marks what James has to approve or supply.

---

## A. The sizzle storyboard

### A.1 Format

A coded React sequence, as 06 §4.1 recommends: built from the brand components on
`feat/brand-public-site` (`src/brand/components/SearchInput.tsx`, `FeeTable.tsx`, `FeeRange.tsx`,
`ChatMessage.tsx`) plus a report-page frame drawn in the report design tokens. Motion stays quick
and functional, 120-200ms ease-out per BRAND.md; the movement is the product doing its job.
The cycle mechanics reuse `src/app/subscribe/showcase.tsx` (cycle timer, progress bar, rotation
stops when a reader picks a chapter, reduced-motion hook).

The pain scenes carry no figures at all. SHERLOCK found no public source for how long a manual fee
study takes or what a consultant charges for one (01 §4: "What is not found in public"), so the
scenes show time and cost as objects (a stack of PDFs, a growing spreadsheet, an invoice) and
never as numbers. `[NEED: a sourced time or cost figure, from the five fee-owner conversations
03 §7 Q11 recommends, before any number goes into scenes 1-2.]`

### A.2 Scenes

Times are seconds from the start of the cycle. Each caption is set in `h3` weight at the top of
the frame, at most 8 words, and holds at least 1.5s after it finishes appearing.

| # | Time | Chapter tab | Caption |
|---|---|---|---|
| 1 | 0.0-2.0 | The old way | Fee studies start one PDF at a time. |
| 2 | 2.0-3.5 | The old way | Then a spreadsheet, a deck, an invoice. |
| 3 | 3.5-7.0 | Bank Fee Index | Fee Insight reads the published schedules for you. |
| 4 | 7.0-10.5 | Every market | Your fee, placed in every market around you. |
| 5 | 10.5-14.0 | Ask Hamilton | Ask Hamilton. Each answer cites its source. |
| 6 | 14.0-17.5 | The report | Add findings. Hamilton writes the report. |
| 7 | 17.5-20.0 (rest) | The report | Your fee study, done by Hamilton. |

The message lands at 3.5-5.0s: scene 3's caption appears at 3.5s and is read by about 5s, over a
fee table that already carries live counts. The static h1 above the frame states the outcome
before any motion starts (07 rule 2).

**Scene 1, 0.0-2.0s. The old way: collecting.**
- Shows: four document tiles, styled as generic fee-schedule PDFs with grey text bars and no bank
  names or logos, open one after another. A text cursor selects one grey line, and a cell in a
  plain spreadsheet frame fills with a grey bar.
- Components: none from the brand set; neutral grey frames on `surface-200`, so the old way reads
  as drab next to what follows.
- Numbers: none. The cells hold grey bars, not digits.

**Scene 2, 2.0-3.5s. The old way: time and cost.**
- Shows: the spreadsheet grows to many rows; a slide-deck tile and an invoice tile stack on top.
  The invoice's amount line is a grey bar.
- Numbers: none (see A.1).

**Scene 3, 3.5-7.0s. Fee Insight and the Bank Fee Index.**
- Shows: the PDFs and the spreadsheet fold into one `FeeTable` under the Bank Fee Index lockup.
  Three rows (Overdraft, NSF, Monthly maintenance) show the national median. Under the first row
  a source line draws in, underlined once in brick. A proof strip slides up under the table.
- Live data (`getPublicSnapshot()`, `src/lib/public-stats.ts`):
  - rows: `categories[]` where `fee_category` is `overdraft`, `nsf`, `monthly_maintenance`;
    `median_amount`, with `institution_count`;
  - proof strip: `summary.institutionsLabel` ("Institutions with published fees",
    `COVERAGE_LABELS`), `summary.categoriesLabel`, `summary.statesLabel`;
  - source line: "Bank Fee Index · `summary.freshnessLabel`".
- A national median is an aggregate, so its source is the index and date. The single-document
  source line (document, page, date) needs a real institution row. `[NEED: James approves an
  example institution and its row for this underline; until then the line reads as above.]`

**Scene 4, 7.0-10.5s. Every market.**
- Shows: five stacked `FeeRange` box plots, one added every 0.6s, labelled with the screen labels
  from `src/lib/hamilton/research-layers.ts`: your market, your state, your Fed district, your
  peer group, the nation. A brick dot labelled "Your fee" (the institution layer) drops onto each
  row. Each row ends with a position word and glyph (above ▲, inside ●, below ▼), never colour
  alone (BRAND.md).
- Live data: the nation row uses the overdraft entry in `categories[]` (`min_amount`,
  `p25_amount`, `median_amount`, `p75_amount`, `max_amount`).
- Illustrative: the subject fee and the four other layers. The frame carries an "Example" tag in
  its top-right corner for the whole scene, and a footnote "National row: Bank Fee Index,
  `summary.refreshedOn`".
- One row may show "Too few institutions for a median" in place of a box. That is the real
  behaviour (`MIN_INSTITUTIONS_FOR_MEDIAN = 5`) and shows the method holds back thin data.

**Scene 5, 10.5-14.0s. Ask Hamilton.**
- Shows: the Ask Hamilton bar (`src/app/pro/(hamilton)/analyze`, `AnalyzeWorkspace.tsx`). A
  question types in: "How does our overdraft fee compare in our market?" It posts as a navy user
  `ChatMessage` on the right. Hamilton's reply arrives with the HI badge: the figure first, then
  its meaning, then a source line in `muted` (BRAND.md, Hamilton chat). A small `FeeRange` sits
  inside the answer. The "+ Add to report" button (`AddToReportButton.tsx`) is pressed and turns
  to "✓ Added to report".
- Illustrative: the whole exchange, with an "Example" tag on the frame. The reply states a
  position ("inside the middle half of your market"), never a suggested price.

**Scene 6, 14.0-17.5s. The report.**
- Shows: a report page assembles on parchment. Title "Peer Brief" (`REPORT_TYPE_LABELS`,
  `src/components/hamilton/reports/report-labels.ts`), the institution line, then the real section
  headings in order: "Summary", "Findings you added", "Snapshot: research institution against its
  benchmark" (`REPORT_SECTION_HEADINGS`). The finding from scene 5 slides into "Findings you
  added". A footnote cites the source. Under the page, a row of three chips headed "Turn this
  into": CEO one-pager, Board memo, Pricing committee packet (`DELIVERABLE_TITLES`,
  `src/lib/hamilton/workspace/deliverables.ts`).
- Illustrative: page content. The "Example" tag stays.
- Build note: in the product, "Turn this into" works from saved decisions (Try a price), not
  straight from a report. The scene shows the chips beside the report as the family of outputs;
  it does not animate a click from the report into a memo.

**Scene 7, 17.5-20.0s. Rest state (also the poster and the reduced-motion frame).**
- Shows: the finished Peer Brief page, the three "Turn this into" chips and the caption. Below
  the frame, the chapter tabs and a "Replay" control. Nothing moves.
- Live data: the footer line "Bank Fee Index · `summary.freshnessLabel`".
- The server renders this frame, so the page reads with JavaScript off and there is no layout
  shift.

**Playback** (06 §4.2, unchanged): muted autoplay only in view, at most three cycles then rest, a
visible pause button, chapter tabs that jump and stop the cycle, reduced motion shows scene 7,
and phones get a portrait cut with fewer, larger rows.

### A.3 Transcript for screen readers

A visually hidden paragraph linked to the frame by `aria-describedby`, also shown under a "Read
the transcript" disclosure. Braces are live fields.

> Fee studies start one PDF at a time: competitors' fee schedules opened one by one and copied
> into a spreadsheet, then a deck, then a consultant's invoice. Fee Insight reads the published
> fee schedules for you. The Bank Fee Index shows the national median for each fee, across
> {institutionsLabel} institutions with published fees in {statesLabel} states. {freshnessLabel}.
> Your fee is placed in every market around you: your market, your state, your Fed district,
> your peer group and the nation, marked above, inside or below the range. In Hamilton, the
> Fee Insight Pro workspace, you ask a question and each answer cites its source. Add a finding
> to your report and Hamilton writes it: a Peer Brief with your findings and their sources,
> ready to turn into a CEO one-pager, a board memo or a pricing committee packet. Your fee
> study, done by Hamilton. Scenes after the Bank Fee Index use example figures.

---

## B. Homepage copy, in page order

Live fields render in place of the braces. Constants are named, never typed.

### B.1 Announcement bar (optional)

> National and Fed district fee reports are free and open at once. Read the national report

Source: `REPORT_OFFER_LINE`. Link: `/research/national-fee-index`. Drop the bar if James prefers
a clean top.

### B.2 Navigation (per 05 ERNEST)

Product ▾ · Reports · Resources ▾ · Pricing · [search] · Sign in · **[See where your fees stand]**

The navy pill repeats the primary CTA and opens the institution search. "Sign in" goes to
`/login`.

### B.3 Hero

**Eyebrow:** THE BANK FEE INDEX

**h1 options:**

1. **Recommended:** "Know where your fees stand," / "with a source for every figure." Ten words
   on two balanced lines, the second in brick. It is DRAPER's promise B with "in your market"
   moved to the subhead to keep the h1 short. The second half passes the swap test: no
   competitor SHERLOCK read claims source-traceability.
2. "Every competitor's fee," / "traced to its own schedule." Sharper on provenance, weaker on the
   outcome.
3. "From fee schedules" / "to your board report." Covers all three layers, but it pulls attention
   to Hamilton before the data has earned it.

Each option breaks into two lines of similar length, so `text-wrap: balance` keeps any single
word off its own line at 390px. Check on the Vercel preview.

**Subhead:**

> The Bank Fee Index reads the published fee schedules of U.S. banks and credit unions. See each
> of your fees against your market, your state, your Fed district, your peer group and the
> nation, then let Hamilton write it up.

**Primary CTA:** See where your fees stand

**Microcopy:**

> {institutionsLabel} institutions with published fees · {freshnessLabel}. Free to search.

Both from `getPublicSnapshot().summary`. "Free to search" is true: institution pages are public.

**The "try a real question" input.**

Decision: the hero input is the **institution search**, not Ask Hamilton. Reasons:

1. Ask Hamilton makes paid model calls under a capped provider budget; an open public box would
   spend it on anonymous visitors (03 §4, free Hamilton tier).
2. Ask Hamilton answers about a selected institution or market inside Pro (its placeholder is
   "Ask about the selected institution or market", `AnalyzeWorkspace.tsx`). A cold visitor has no
   selection yet.
3. A public model answer to "should we change our fee?" would sit outside the no-advice rule
   with no review.
4. The search is the one door consumers and fee owners share (03 §3). It keeps the
   `WEBSITE_JSON_LD` SearchAction, and it is DRAPER's recommended primary CTA (03 §4, option B).

The sizzle shows Ask Hamilton, so visitors still see the chat. Copy:

- Label (tracked capitals): TRY IT ON A REAL INSTITUTION
- Placeholder: Your bank or credit union
- Beside the field: Free. Search any institution in the index.
- Suggestion chips, each a working link:
  - "Overdraft fees nationwide" → `/fees/overdraft`
  - "National fee report" → `/research/national-fee-index`
  - "Sample competitive report" → `/reports/sample-competitive-fee-position` (shown only while
    `sampleReportAvailable()` is true)
- Under the chips: Questions for Hamilton come with Pro. See Hamilton plans → `/subscribe`

**Second-buyer line:**

> Prefer one document? A Competitive Fee Position Report for your institution, {REPORT_PRICE_INLINE}.

**Consumer line:**

> Checking your own bank's fees? Search the same index, free.

### B.4 Showcase tabs (the sizzle chapters)

The old way · Bank Fee Index · Every market · Ask Hamilton · The report

### B.5 The old way and Fee Insight

**Eyebrow:** REPLACE THE FEE STUDY BY HAND

**h2:** Five sources, or one

**Left panel, "How fee studies get done today"** (dashed lines, grey icons):
- Competitor fee schedules, saved one PDF at a time
- A spreadsheet someone keeps by hand
- A national survey average from a sample you didn't choose
- Call-report peer ratios that don't list fees
- A consultant to put it together

**Right panel, "In Fee Insight"** (solid navy lines): published fee schedules flow into the Bank
Fee Index, out to five markets, then into Hamilton, ending in four verbs: Read, Place, Ask,
Report.

**Line under the diagram:**

> Every figure in Fee Insight keeps its source: the institution's own document, the page and the
> date.

Basis: the alternatives are SHERLOCK's (01 §1); the source claim matches `REPORT_INCLUDES`.

### B.6 Every fee

**Eyebrow:** EVERY FEE

**h2:** Your competitors' fees, from their own schedules

**Body:**

> The Bank Fee Index reads each institution's published fee schedule and keeps every fee with
> the document, page and date it came from. When a board member quotes a national average from
> the press, you can answer with the schedules of the banks your customers can walk into. Fees
> stated as a rate, such as a percentage of a transaction, are kept apart from dollar fees.

**Visual:** one `FeeTable` with live national rows and a proof strip: {institutionsLabel}
institutions with published fees, {observationsLabel} published fee entries, {categoriesLabel}
fee categories, {statesLabel} states, {freshnessLabel}.

**Link:** How we read a fee schedule → `/methodology`

### B.7 Every market

**Eyebrow:** EVERY MARKET

**h2:** See each fee in five markets at once

**Body:**

> Each of your fees sits against your market (institutions with branches in your counties), your
> state, your Fed district, your peer group (same charter and asset size, nationwide) and the
> nation. You see the median, the middle half and who charges $0, and whether your fee is above,
> inside or below the range. A market with fewer than five institutions is marked thin and gets
> no median.

**Visual:** five `FeeRange` rows. The national row is live; the rest carry an "Example" tag until
an example institution is approved.

**Link:** Read the free national and Fed district reports → `/reports`

### B.8 One workspace

**Eyebrow:** ONE WORKSPACE

**h2:** Ask, compare and take a report to committee

**Body:**

> Hamilton, the Fee Insight Pro workspace, puts the index and the markets in one place. Ask
> Hamilton a question and each answer cites its source. Add the findings you want to keep, and
> Hamilton writes a sourced report, such as a Peer Brief or a Competitive Positioning report.
> Try a price shows any amount side by side, including $0, before you decide. Hamilton shows
> the position and the options; the decision stays with your institution.

**Tabs line:** This month · My fees · Try a price · Reports, with Ask Hamilton on every screen
(`HAMILTON_MODES`).

**Link:** See Hamilton plans → `/subscribe`. Beside it, a quieter link: Or ask for a demo →
`/contact?source=demo`

**One-off line:**

> Prefer one document? We build a Competitive Fee Position Report for your institution,
> {REPORT_PRICE_INLINE}.

### B.9 Operating-record panel (navy)

**Eyebrow:** BEHIND EVERY FIGURE

**h2:** How a fee reaches the index

| Step | Label | Line |
|---|---|---|
| 01 | Schedule read | The institution's own published fee schedule is collected and read. |
| 02 | Fee recorded | Each fee is kept with its document, page and date. |
| 03 | Checked against source | A fee is checked against the schedule it came from before it is published. |
| 04 | Published | It joins the Bank Fee Index. {freshnessLabel} |

**Panel footer:** {observationsLabel} published fee entries. Schedules are re-read on a rolling
calendar, and a competitor's change shows once its schedule is re-read.

Basis: the fee tiers (`raw_fee_observations` → `verified_fee_observations` →
`published_fee_records`) and the monitoring wording in `src/app/for-institutions/hamilton-copy.ts`.
No status lights, run counts or agent names. `[NEED: a public re-read cadence. A code comment in
hamilton-copy.ts says states are re-read at least monthly; confirm before the panel states it.]`

### B.10 Pricing preview

**Eyebrow:** PRICES ON THE PAGE

**h2:** What it costs

- **Free.** {REPORT_OFFER_LINE}. Institution search, and basic fee alerts with a free account.
  Button: Read the national report
- **Hamilton Pro.** Three cards from `PRO_TIERS`, each showing `assetsLabel` and
  `tierPriceLabel(key, "monthly")`, with `tierPriceLabel(key, "annual")` beneath. Shared line:
  "One plan for up to 5 people. Annual is ten monthly payments." Small print:
  `CONSULTANT_PRICE_NOTE`. Button: See Hamilton plans
- **One report.** `REPORT_OFFER.name`, `REPORT_OFFER.priceLabel`. "Each report is quoted.
  {REPORT_OFFER.nextStep}." Button: `REPORT_OFFER.institutionCtaLabel`

No strikethrough prices, and no trial line unless James approves one (C, item 6).

### B.11 FAQ

**Eyebrow:** QUESTIONS BEFORE YOU START

1. **Where does each figure come from?**
   From the institution's own published fee schedule. Every fee keeps the document, the page and
   the date it was read from, and our method is public on the methodology page.
2. **How current is it?**
   {freshnessLabel}. Schedules are re-read on a rolling calendar, and a change shows once the
   schedule is re-read. The index is not a real-time feed.
3. **Which institutions and fees are covered?**
   U.S. banks and credit unions that publish a fee schedule: {institutionsLabel} institutions
   with published fees in {statesLabel} states today. We cover consumer fee schedules. Deposit
   and loan rates and treasury management fees are outside the index.
4. **What if my market has only a few institutions?**
   A market with fewer than five institutions is marked thin and gets no median, so you never
   see a figure built from two or three banks. Your state, Fed district, peer group and the
   nation still give a comparison.
5. **Does Hamilton tell us what to charge?**
   No. Hamilton shows where each fee stands and what a price you try would mean against your
   market. Its reports set out options for management to weigh. The decision is yours.
6. **What does Hamilton cost?**
   Pro is priced by your institution's assets, {PRO_ANNUAL_RANGE_LABEL}, as one plan for up to 5
   people. {CONSULTANT_PRICE_NOTE}
7. **What is in a Competitive Fee Position Report?**
   {REPORT_INCLUDES, as a list}. Each report is quoted, {REPORT_PRICE_INLINE}.
   {REPORT_OFFER.nextStep}.
8. **How do you check accuracy, and what if a fee is wrong?**
   We measure accuracy as the share of live published fees whose amount and category match the
   institution's own current schedule. If a fee doesn't match, send us the source and we'll
   re-read it. Link: Submit a fee source → `/submit-fees`.
   `[NEED: a measured figure James approves for publication. Until then this answer states the
   method only, and never "99%".]`

### B.12 Closing band (navy)

**h2:** See where your fees stand in your market

**Body:** Search your bank or credit union. Every figure comes with its source.

**Primary:** See where your fees stand (the search, repeated)

**Secondary text link:** See Hamilton plans

---

## C. Approvals James needs to give `[NEED]`

1. **An example institution** for scenes 3-6 and the Every market visual, from a market that
   passes readiness, so the "Example" tags can come off and every figure becomes live (07 rule 5
   asks for no illustrative numbers; this item closes that gap).
2. **Public Hamilton frames.** Scenes 5-6 draw Ask Hamilton, "+ Add to report" and a Peer Brief
   from real components. Approve them for public use with example content.
3. **The closing caption.** "The fee study? Done." is a self-answered question, which the
   copywriting skill bans as an AI tell. Recommended: "Your fee study, done by Hamilton." James
   can overrule.
4. **A sourced time or cost figure** for the pain scenes, from fee-owner conversations; until
   then the scenes show none.
5. **The h1** (B.3, option 1 recommended) and the **primary CTA**, the institution search
   (DRAPER Q1). This copy assumes both.
6. **A trial line.** DECISIONS records 14-day Pro trials set up by hand. Say so on the page or
   not?
7. **The re-read cadence** for the operating-record panel and FAQ 2.
8. **Free state reports.** Confirm before the announcement bar or pricing names them.
9. **A published accuracy figure** for FAQ 8.
10. **The announcement bar:** keep or drop.

---

## Copy review note (for the PR)

Skills applied: `copywriting` (page structure, CTA rules, AI-tells self-check), `copy-editing`
(seven sweeps), `marketing-psychology`, plus the editorial policy and product-marketing context.

- **Clarity.** Replaced "every bank" wording with "the published fee schedules of U.S. banks and
  credit unions"; split the subhead into two sentences; defined "your market" and "peer group"
  where they first appear (B.7).
- **Voice and tone.** Sentence case, no exclamation marks, no emoji, no em dashes in short copy.
  Position words only (above, inside, below); no "recommend", "real-time", "AI" or agent names.
- **So what.** Each pillar opens with what the buyer can do (answer the board, see five markets,
  take a report to committee) before the mechanics.
- **Prove it.** Every count names a `getPublicSnapshot()` field, every price names a constant,
  and illustrative scenes carry "Example". No testimonials, logos or user counts.
- **Specificity.** Real labels from code: Peer Brief, CEO one-pager, Board memo, Pricing committee
  packet, "+ Add to report", the five layer names.
- **Heightened emotion.** The pain scenes carry the felt cost (one PDF at a time, the invoice)
  without invented figures; the rest frame resolves it.
- **Zero risk.** Free search and free reports come first, prices are shown, and the FAQ answers
  source, freshness, thin markets, advice and accuracy. No turnaround is promised on free
  reports.

AI-tells check: removed one self-answered question (C3), one "not X, Y" construction from the
Every fee draft and a trailing pile-on from the subhead. Psychology used: status-quo cost and loss
aversion in the old-way scenes; the endowment effect through the hero search (the visitor sees
their own institution before any form); anchoring through visible prices; authority through the
source line rather than adjectives.
