# Site v3 brief 04: three homepage directions (NORMAN)

Issue #1289. Written 2026-10-14. One-off brief; nothing is scheduled. Built on SHERLOCK's market
research (`01-sherlock-market.md`), my CRO audit (`02-norman-cro-audit.md`) and DRAPER's
positioning (`03-draper-positioning.md`), under James's direction of 2026-10-14: the homepage
sells the product and its value through three layers (Data = Bank Fee Index, Insight = market
layers, Workspace = Hamilton), and it is not a report page.

James has not yet answered DRAPER's open questions, so the three directions below differ on the
real choices: what the hero leads with, what the primary button does, and which buyer the page
serves first. All three keep DRAPER's message hierarchy (promise, proof strip, the three pillars
**Every fee / Every market / One workspace**, how to start, the consumer door) and the section 5
vocabulary.

**Rules every direction follows.** No count is typed in this brief or on the page: every figure
names its live field. Prices render from `REPORT_OFFER.priceLabel` / `REPORT_PRICE_INLINE` and
`PRO_TIERS` (`src/lib/pro-tiers.ts`). No testimonials, logos, booking links, accuracy rates or
fee-change claims. Primary buttons are navy (`Button variant="primary"`). Brick appears at most
twice per view; each section notes where. Copy is draft, in BRAND.md's voice (plain, numerate,
calm, sentence case, no exclamation marks), and gets a copy-editing pass before build.

**Two cautions from the brand assets.** The component preview
(`Branding/fee-insight-components-preview.png`) shows a "Book a demo" brick button and sample
figures ("412 peers", "4,812 banks and credit unions"). Neither belongs on the site: no booking
links, and those numbers are placeholders. The OG image (`public/brand/og/og-fee-insight.png`,
on `feat/brand-public-site`) sets the visual cue all three directions borrow: navy ground, the
stacked lockup and a column of brick box plots.

**Live proof available today** (fields referred to below):

| Short name | Field | Source |
|---|---|---|
| `inst` | `summary.institutionsLabel` ("Institutions with published fees") | `getPublicSnapshot()`, `src/lib/public-stats.ts` |
| `entries` | `summary.observationsLabel` ("Published fee entries") | same |
| `cats` | `summary.categoriesLabel` | same |
| `states` | `summary.statesLabel` | same |
| `fresh` | `summary.freshnessLabel` ("Data refreshed ...") | same |
| `natl[c]` | `categories[c]`: `median_amount`, `p25_amount`, `p75_amount`, `min_amount`, `max_amount`, `institution_count` | `getPublicNationalIndex()` |
| `ready` | count of `ready === true` rows | `getMarketReadinessCached()` |
| `rank` | peer-rank teaser (overdraft, maintenance; counts only) | `peer-rank-teaser.tsx` |
| `price` | `REPORT_PRICE_INLINE`, `PRO_TIERS[*].monthlyUsd` | constants, pro-tiers |

---

## Direction A: "Start with your own number" (search-first)

**Idea.** The hero is a promise and one search box. The first thing a fee owner does on the site
is look up their own institution and see where its fees stand.

**Who it serves first, and why.** The fee owner who arrives already holding the question
SHERLOCK ranks first, "is it my market?" (01 §4). Every alternative SHERLOCK read starts with a
conversation (01 §2, point 3), and this direction starts by showing the product. It is DRAPER's
recommended pairing: fee-owner hero with a shared search (03 §3, option 1), primary CTA option B
(03 §4). Consumers use the same box, so the SEO door stays open.

### Sections

1. **Hero (parchment).**
   - Purpose: the promise, then the one action.
   - h1: "Know where your fees stand in your market, with a source for every figure."
   - Sub: "Search your bank or credit union. We place each published fee against your market,
     your state, your Fed district, your peer group and the nation."
   - Visual: `SearchInput` (label "Your bank or credit union") with the navy primary button.
     Beside it on desktop, one `FeeRange` row for overdraft from `natl[overdraft]`, captioned
     "National range · `natl.institution_count` institutions · `fresh`". The box is the only
     brick (brick count: 1).
   - CTA: **See where your fees stand** (submits the search). Under it, the consumer line:
     "Checking your own bank's fees? Search the same index, free."
   - Live proof: `inst`, `fresh` in the hint under the input.
2. **Proof strip.** Four `StatCard`s without deltas: `inst`, `entries`, `states`, `fresh`.
   Source line "Bank Fee Index · `fresh`". No brick.
3. **Every fee (Data).**
   - h2: "Every competitor's fee, traced to their own fee schedule." (DRAPER's option A promise.)
   - Line: "Each figure links to the document, the page and the date it came from, so you can put it
     in front of the pricing committee."
   - Visual: one source-linked row from the live sample (`/reports/sample-competitive-fee-position`,
     `src/lib/custom-report/sample-report.ts`) in a `FeeTable`, with its source line in `small`.
     `[NEED: James to approve naming the sample's subject institution on the homepage, or use
     "Sample institution".]` Brick: the subject row (1).
   - CTA (text link): "How we read fee schedules" to `/methodology`.
4. **Every market (Insight).**
   - h2: "One fee, five markets."
   - Line: "See whether a fee sits above, inside or below the range in your market, your state,
     your Fed district, your peer group (same charter and asset size) and the nation."
   - Visual: five `FeeRange` rows on one `FeeRangeAxis`. National row live from `natl`. The other
     four rows are an illustration labelled "Example" until a public read exists. `[NEED: a
     public per-layer quartile read for one example institution or market; see build list.]`
     Brick: the boxes and the subject dot share one hue (counts as one use).
   - Live proof: "`ready` state markets are ready for a full local comparison" with its definition
     in `small`.
   - CTA (text link): "Read the free national and Fed district reports".
5. **One workspace (Hamilton).**
   - h2: "Hamilton, the Fee Insight Pro workspace."
   - Line: `HAMILTON_CANONICAL`, then the five tabs from `HAMILTON_MODES` + `HAMILTON_WIRE_NAV`.
   - Visual: a My fees screenshot (`src/app/pro/(hamilton)/research/page.tsx`, `/pro/research`).
     `[NEED: approved screenshot of a non-thin local layer.]`
   - Price: "From $`PRO_TIERS[0].monthlyUsd` a month by asset size, for up to 5 people."
   - CTA: secondary button **See Hamilton plans** (`/subscribe`). Report line under it: "Prefer
     one document? We build a Competitive Fee Position Report for your institution,
     `REPORT_PRICE_INLINE`."
6. **How to start (three steps).** "Search your institution. See where two fees stand against
   your state or district. Open Hamilton for all five markets, or ask us for one report."
7. **Close (navy band, `data-theme="dark"`).** h2 repeats the promise; the search box again.
   Brick: the box-plot I in the footer lockup only.

### Wireframes

Hero, desktop (~1280):

```
+------------------------------------------------------------------------------------------+
| [Fee Insight]   Bank Fee Index   Markets   Hamilton   Pricing        Sign in [See where] |
+------------------------------------------------------------------------------------------+
|                                                                                          |
|  Know where your fees stand in your market,         OVERDRAFT · NATIONAL RANGE           |
|  with a source for every figure.                     |-------[==|==]------|              |
|                                                     $0     p25 med p75     max           |
|  Search your bank or credit union. We place each    natl.institution_count · fresh       |
|  published fee against your market, your state,                                          |
|  your Fed district, your peer group and the nation.                                      |
|                                                                                          |
|  Your bank or credit union                                                               |
|  [ Q  Search a bank or credit union          ] [See where your fees stand]               |
|  inst institutions with published fees · fresh                                           |
|  Checking your own bank's fees? Search the same index, free.                             |
+------------------------------------------------------------------------------------------+
| [inst]        [entries]        [states]        [fresh]                                   |
+------------------------------------------------------------------------------------------+
```

Hero, mobile (375):

```
+-----------------------------------+
| [Fee Insight]              [=]    |
+-----------------------------------+
| Know where your fees stand in     |
| your market, with a source for    |
| every figure.                     |
|                                   |
| Search your bank or credit union. |
| We place each published fee in    |
| five markets.                     |
| [ Q Your bank or credit union  ]  |
| [ See where your fees stand    ]  |
| inst institutions · fresh         |
| Checking your own bank? Search    |
| the same index, free.             |
| OVERDRAFT · NATIONAL              |
| |----[=|=]-----|                  |
+-----------------------------------+
```

Full page outline (desktop | mobile stacks the same order, one column):

```
DESKTOP                                         MOBILE
[Nav]                                           [Nav]
[Hero: promise + search | national FeeRange]    [Hero: promise, search, FeeRange]
[Proof strip: 4 StatCards]                      [Proof: 2x2 StatCards]
[Every fee: copy | FeeTable source row]         [Every fee: copy, FeeTable]
[Every market: copy | 5 FeeRange rows + ready]  [Every market: 5 rows, ready]
[One workspace: My fees screenshot | tabs+price][One workspace: screenshot, tabs, price]
[How to start: 3 steps]                         [3 steps]
[Navy close: promise + search]                  [Navy close]
[Footer: Bank Fee Index lockup]                 [Footer]
```

### Alternatives

- Headlines: (1) "Know where your fees stand in your market, with a source for every figure."
  Rationale: DRAPER's promise, passes the swap test on the second half. (2) "See your fees the
  way your board will read them: against your own market." Rationale: names the defend-it job.
  (3) "Your fees, placed in your market, with each figure linked to its source." Rationale:
  shorter, safer on mobile.
- CTAs: "See where your fees stand" (outcome, matches the h1); "Find your institution" (plain,
  matches /subscribe); "Show my fee position" (first person, worth a test).

### Strengths, risks, build

- **Strengths.** Lowest activation energy: one field, no account. The same box serves both
  audiences, so the `WEBSITE_JSON_LD` SearchAction keeps its place. Shows the product before
  asking for anything. Each later step (Hamilton, report) is a natural second commitment.
- **Risks.** The page is only as good as the institution page it lands on. Today that page's
  buyer view is the two-fee teaser (`rank`), counts only. A buyer whose state is thin meets a weak
  moment straight after the promise. A consumer reads a headline written for someone else.
- **Must be built.**
  - `[NEED: institution page as a buyer position view: the teaser expanded to more categories and
    layers, with "See all five markets in Hamilton" and the report line.]`
  - `[NEED: public per-layer quartiles for the Every market example.]`
  - `[NEED: approved My fees screenshot.]`
  - `[NEED: an analytics event for a hero search submit, split from consumer searches if
    possible.]`
  - `[NEED: Vercel Analytics share of consumer sessions landing on / (DRAPER 03 §3).]`

---

## Direction B: "One fee, five markets" (product-story-first)

**Idea.** The hero shows the Insight layer working: one fee placed in five markets as stacked box
plots. The page then walks one figure down the product, from source document to market position
to Hamilton, and asks the buyer to look at plans.

**Who it serves first, and why.** The evaluator: a product or marketing manager comparing options
after a board member quotes a press average. SHERLOCK found that press averages are what boards
have seen (01 §3: Bankrate, Moebs) and that the page should "show the gap between a national
average and a local market" (01 §7). It also serves credit union buyers who already think in peer
groups (01 §5, 03 pillar 2). Public pricing is a real difference in this category (01 §6.4), so
this direction puts price one click from the hero. Its CTA is DRAPER's stated fallback, "See
Hamilton plans" to `/subscribe`, the most conversion-ready page today (02 §3, 03 §4).

### Sections

1. **Hero (navy band, `data-theme="dark"`, after the OG image).**
   - Purpose: show the product's core idea in one picture.
   - h1: "Your overdraft fee has five medians. See all of them."
   - Sub: "The Bank Fee Index reads each institution's own published fee schedule. Hamilton, the
     Fee Insight Pro workspace, places your fees against your market, your state, your Fed
     district, your peer group and the nation."
   - Visual: five `FeeRange` rows, overdraft, labelled by layer. Nation, the example Fed district
     and the example state are live. "Your market" and "Your peer group" rows are drawn in
     outline with the label "In Hamilton". Brick: the IQR boxes (1, lightened on navy).
   - CTA: **See Hamilton plans** (navy-reverse primary, i.e. parchment fill on navy). Secondary
     text link: "Or look up your institution free".
   - Live proof: under the chart, "Nation: `natl[overdraft].institution_count` institutions ·
     `fresh`". `[NEED: James picks the example state and district; both must pass
     MIN_INSTITUTIONS_FOR_MEDIAN and the state should be `ready`.]`
2. **Proof strip (parchment).** `inst`, `entries`, `cats`, `fresh`. No brick.
3. **Every fee.** h2: "Start with the competitor's own disclosure." Line: "Every figure in the
   index links to the fee schedule it came from: the document, the page and the date." Visual: a
   source line blown up as a caption card (document title, page, date) over one `FeeTable` row
   from the sample. Brick: subject row (1).
4. **Every market.** h2: "A national average answers a question your board didn't ask." Line:
   "Press averages come from national samples. Your customers choose between the institutions in
   their own counties." Visual: national `natl` box plot beside the example state box plot, same
   axis, gap labelled in words. Link: "Read the free national and Fed district reports". Proof:
   `ready` with its definition. Brick: boxes (1).
5. **One workspace.** h2: "From that figure to the document your committee reads." Visual: a
   horizontal strip of four small screenshots in tab order: This month (`/pro/hamilton`), My fees
   (`/pro/research`), Try a price (`/pro/simulate`), Reports (`/pro/reports`), plus a Regulatory
   Wire chip (`/pro/news`). One line each. "Hamilton shows the position and the effect of a
   price. The decision stays with you."
6. **Plans preview.** Three tier cards from `PRO_TIERS` (asset label, monthly price, "up to 5
   people"), annual noted as ten monthly payments. A fourth, quieter card: "One report, no
   subscription: Competitive Fee Position Report, `REPORT_PRICE_INLINE`." CTA: **See Hamilton
   plans**. No "Most popular" badge, since we have no data to back one.
7. **Consumer door.** One line and the search box: "Checking your own bank's fees? Search the
   same index, free."
8. **Close.** Promise line and **See Hamilton plans**.

### Wireframes

Hero, desktop (~1280), navy band:

```
+==========================================================================================+
| [Fee Insight]   Bank Fee Index   Markets   Hamilton   Pricing        Sign in [See plans] |
+==========================================================================================+
|                                                                                          |
|  Your overdraft fee has five medians.            OVERDRAFT                               |
|  See all of them.                                Your market    : - - [  in Hamilton ] - |
|                                                  Your state     |----[==|===]-----|      |
|  The Bank Fee Index reads each institution's     Fed district   |-----[==|==]------|     |
|  own published fee schedule. Hamilton, the Fee   Peer group     : - - [  in Hamilton ] - |
|  Insight Pro workspace, places your fees in      Nation         |------[=|===]-------|   |
|  five markets.                                                 $0   $10   $20   $30  $40 |
|                                                  natl.institution_count · fresh          |
|  [ See Hamilton plans ]   Or look up your institution free                               |
+==========================================================================================+
```

Hero, mobile (375):

```
+===================================+
| [Fee Insight]              [=]    |
+===================================+
| Your overdraft fee has five       |
| medians. See all of them.         |
|                                   |
| The Bank Fee Index reads each     |
| institution's own fee schedule.   |
| Hamilton places your fees in five |
| markets.                          |
| Your market  : in Hamilton :      |
| Your state   |--[=|=]---|         |
| Fed district |---[=|=]--|         |
| Peer group   : in Hamilton :      |
| Nation       |---[=|==]---|       |
| [ See Hamilton plans          ]   |
| Or look up your institution free  |
+===================================+
```

Full page outline:

```
DESKTOP                                          MOBILE
[Navy hero: promise | five-row ladder]           [Navy hero: copy, ladder, CTA]
[Proof strip: 4 StatCards]                       [2x2 StatCards]
[Every fee: source caption card + FeeTable row]  [caption card, row]
[Every market: national vs state, same axis]     [two FeeRange rows]
[One workspace: 4 screenshots + Wire chip]       [swipeable screenshots]
[Plans: 3 PRO_TIERS cards + report card]         [stacked cards]
[Consumer door: one line + search]               [line + search]
[Close: promise + See Hamilton plans]            [close]
```

### Alternatives

- Headlines: (1) "Your overdraft fee has five medians. See all of them." Rationale: concrete,
  numerate, and it states the Insight layer as a capability (02, high-impact 3). (2) "Know where
  your fees stand in every market your board asks about." Rationale: closer to DRAPER's promise
  B. (3) "See each fee against your market, your peer group and the nation." Rationale: shorter,
  names the peer group for CU buyers.
- CTAs: "See Hamilton plans" (DRAPER's wording); "See plans for your asset size" (answers the
  which-plan worry); "Compare Hamilton plans".

### Strengths, risks, build

- **Strengths.** It shows the product's central idea in the first view and needs no input from
  the visitor. The partly locked ladder is honest: it shows what is public and what Hamilton adds.
  The CTA lands on a page that already converts best (02 §3). It can ship before the institution
  page is rebuilt.
- **Risks.** It asks a cold buyer to look at a subscription before they have seen their own
  position, which is the weakness DRAPER names in CTA option C (03 §4). The example state is not
  the visitor's state, so "your" in the h1 is a promise the hero cannot yet keep. "Five medians"
  only holds where each layer has five or more institutions; the copy must say so in the source line.
- **Must be built.**
  - `[NEED: a public read of one category's quartiles for one state and one Fed district,
    under the fee-stats contract and MIN_INSTITUTIONS_FOR_MEDIAN.]`
  - `[NEED: approved screenshots of the four tabs and the Wire.]`
  - `[NEED: /subscribe to use Hamilton's tab names in place of Benchmark/Analyze/Monitor/Report
    (02 §3), so the page the CTA lands on says the same thing.]`
  - `[NEED: a dark-theme FeeRange check in the hero (contrast of outline rows at 3:1).]`

---

## Direction C: "The workspace, shown" (workspace-first)

**Idea.** The hero is Hamilton itself: a real My fees screen with an Ask Hamilton answer on top.
The page is a short tour of the five tabs, with the data and the market layers presented as what
sits underneath.

**Who it serves first, and why.** The person who has to produce something: a CFO or finance lead
preparing board material, a pricing committee member, and consultants who need one data backbone
per client (`.agents/product-marketing.md` §2). SHERLOCK found no alternative that offers a
self-serve workspace moving from figure to market position to board report (01 §6, gap 3).
DRAPER's pillar 3 is its spine, and its CTA is DRAPER's option C, "See Hamilton" (03 §4).

### Sections

1. **Hero (navy band).**
   - Purpose: show the workspace before describing it.
   - h1: "Your fee position, ready for the pricing committee."
   - Sub: "Hamilton, the Fee Insight Pro workspace, places each of your fees in your market and
     builds the board brief, with a source on every figure."
   - Visual: framed My fees screenshot (`/pro/research`) on parchment, overlaid with a
     `ChatMessage` pair: the user asks "How does our overdraft fee compare?"; Hamilton answers
     with a `Figure` and a source line. Brick: the subject dot in the screenshot and the HI badge
     (2). `[NEED: the answer text must be a real Ask Hamilton output (/pro/analyze) on an approved
     institution, not written for the page.]`
   - CTA: **See Hamilton** (to a tour section or a new `/hamilton` page). Secondary text link:
     "Or see where your fees stand, free" (search).
   - Live proof: price line "From $`PRO_TIERS[0].monthlyUsd` a month by asset size" under the
     button, and `fresh`.
2. **Proof strip (parchment).** `inst`, `entries`, `states`, `fresh`, framed as "What Hamilton
   reads". No brick.
3. **Tour: five tabs, one section each** (alternating screenshot left and right).
   - This month (`/pro/hamilton`): "The few fees worth a look this month, and what changed in
     your market once its schedule was re-read."
   - My fees (`/pro/research`): "Each fee against your market, state, Fed district, peer group
     and the nation, with competitors named."
   - Try a price (`/pro/simulate`): "Put any amount side by side, including $0, and see the effect
     on fee income from your own figures."
   - Reports (`/pro/reports`): "A CEO one-pager, a pricing committee packet or a board brief.
     Every figure is cited."
   - Regulatory Wire (`/pro/news`): "Federal and watched-state items next to your fee data."
   - Brick per view: one highlight per screenshot (BRAND imagery rule).
4. **Underneath: Every fee and Every market.** Two columns. Every fee: a source line card.
   Every market: national `FeeRange` from `natl` plus `ready`. Links to `/methodology` and the
   free reports.
5. **Plans.** `PRO_TIERS` cards and the consultant note (`CONSULTANT_MONTHLY_REPORTS` Hamilton
   reports a month at the mid price). Report card with `REPORT_PRICE_INLINE`. CTA: **See Hamilton
   plans**.
6. **Consumer door.** The search line, as in A and B.
7. **Close.** "Hamilton shows the position and the effect of a price. The decision stays with
   you." CTA **See Hamilton plans**.

### Wireframes

Hero, desktop (~1280):

```
+==========================================================================================+
| [Fee Insight]   Bank Fee Index   Markets   Hamilton   Pricing       Sign in [See Hamilton]|
+==========================================================================================+
|                                               +---------------------------------------+  |
|  Your fee position, ready for the             | Hamilton  This month  My fees  Try... |  |
|  pricing committee.                           |---------------------------------------|  |
|                                               | Overdraft   |---[==|==]--o--|  $xx   |  |
|  Hamilton, the Fee Insight Pro workspace,     | Maintenance |--[=|==]---|      $xx   |  |
|  places each of your fees in your market      |        +------------------------------+ |
|  and builds the board brief, with a source    |        | How does our overdraft fee   | |
|  on every figure.                             |        | compare?                     | |
|                                               |   [HI] | <real answer> · source line  | |
|  [ See Hamilton ]  Or see where your fees     +--------+------------------------------+ |
|                    stand, free                                                           |
|  From $PRO_TIERS[0] a month by asset size · fresh                                        |
+==========================================================================================+
```

Hero, mobile (375):

```
+===================================+
| [Fee Insight]              [=]    |
+===================================+
| Your fee position, ready for the  |
| pricing committee.                |
| Hamilton, the Fee Insight Pro     |
| workspace, places your fees in    |
| your market and builds the board  |
| brief.                            |
| [ See Hamilton                 ]  |
| Or see where your fees stand      |
| From $PRO_TIERS[0] a month        |
| +-------------------------------+ |
| | My fees (cropped screenshot)  | |
| | [HI] <real answer> · source   | |
| +-------------------------------+ |
+===================================+
```

Full page outline:

```
DESKTOP                                          MOBILE
[Navy hero: copy | My fees + Ask Hamilton]       [Navy hero: copy, CTA, cropped shot]
[Proof strip: "What Hamilton reads"]             [2x2 StatCards]
[Tour: This month | My fees | Try a price |      [5 tab sections, one shot each]
 Reports | Regulatory Wire, alternating]
[Underneath: Every fee | Every market]           [two stacked blocks]
[Plans: PRO_TIERS + consultant + report card]    [stacked cards]
[Consumer door]                                  [line + search]
[Close: decision stays with you + CTA]           [close]
```

### Alternatives

- Headlines: (1) "Your fee position, ready for the pricing committee." Rationale: names the
  output a finance reader is accountable for. (2) "From your competitors' fee schedules to your
  board packet, in one workspace." Rationale: DRAPER's option C promise. (3) "Know where your
  fees stand, try a price, and brief the board from one workspace." Rationale: names three tabs;
  long, so desktop only.
- CTAs: "See Hamilton" (DRAPER's wording); "Tour Hamilton" (sets the expectation of a look, not
  a sale); "See how Hamilton works".

### Strengths, risks, build

- **Strengths.** It answers the most common audit complaint directly: Hamilton is missing from
  the public site (02 summary). It is the clearest picture of the unmatched gap (data, market and
  workspace in one product). It suits consultants, who buy a tool.
- **Risks.** Every claim rests on screenshots that are switched off today (02 §2). A real Ask
  Hamilton answer must be captured and approved, and its figures go stale. It sells software
  before proof of the visitor's market, so a cold visitor has the least reason to believe "your".
  It also leans on the same "one workspace" claim SHERLOCK found generic (03 §1, option C).
- **Must be built.**
  - `[NEED: five approved Hamilton screenshots on one institution with a non-thin local layer.]`
  - `[NEED: one captured Ask Hamilton answer, approved for public use, with a date in its source
    line.]`
  - `[NEED: a public /hamilton tour page or anchored tour, and a nav item "Hamilton".]`
  - `[NEED: a refresh process for screenshots so their figures never contradict live counts.]`

---

## How each direction answers the CRO audit (02)

| Audit finding | A: search-first | B: story-first | C: workspace-first |
|---|---|---|---|
| h1 is the product name; buyer gets half a clause | Promise h1 to the fee owner | Insight-layer h1 to the fee owner | Output h1 to the fee owner |
| Buyer CTA hidden in a third tab | One navy button in the hero, no tabs | One navy button in the hero, no tabs | One navy button in the hero, no tabs |
| Hamilton buried; first seen as a gated 50-checkbox form | `LandingResearchPicker` removed; Hamilton is pillar 3 with a screenshot | Removed; Hamilton named in the sub and shown in four tabs | Removed; Hamilton is the hero |
| Insight layer never stated as a capability | Five-row ladder section with `ready` | The hero itself | My fees tab + national FeeRange |
| Live proof framed for consumers | Proof strip framed as evidence; national range as a market fact | Same, and national vs state as an argument | Proof strip as "What Hamilton reads" |
| No picture of the product | My fees screenshot in pillar 3 | Four tab screenshots | Five screenshots, hero included |
| Two vocabularies for Hamilton | Tabs from `HAMILTON_MODES` + Wire | Same, and /subscribe aligned | Same |
| Nav calls the workspace "Pricing" | Nav: Bank Fee Index, Markets, Hamilton, Pricing | Same | Same |
| 3,888 vs 3,875 counts | `COVERAGE_LABELS` only | same | same |
| Paid report steered down in the form | Report is a one-line offer under Hamilton, priced | Report card beside plans | Report card beside plans |

---

## Comparison

| | A: search-first | B: story-first | C: workspace-first |
|---|---|---|---|
| Hero leads with | Promise + search box | Five-market box-plot ladder | Hamilton screen + Ask answer |
| Primary CTA | See where your fees stand (search) | See Hamilton plans (/subscribe) | See Hamilton (tour) |
| Secondary | See Hamilton plans | Look up your institution free | See where your fees stand |
| Serves first | Fee owner who knows the question | Evaluator answering a press average; CU buyers | Finance and committee, consultants |
| SHERLOCK question answered first | Is it my market? | Can I defend it against an average? | Can I get it to the board? |
| Consumer door | In the hero (shared box) | Below the plans | Below the plans |
| Activation energy | Lowest (one field) | Low (one click, but a pricing page) | Low click, high belief needed |
| Proof in the first view | Live national range, `inst`, `fresh` | Live nation/state/district rows | Screenshot (static), price |
| Biggest dependency | Institution page as buyer view | Per-layer public read | Approved screenshots + Ask answer |
| Shippable before new builds | Partly (falls back to B's CTA) | Mostly (needs one data read) | No |
| Main risk | Thin-market landing moment | Asks for a plan look before own position | Rests on switched-off visuals |
| Measure with | hero search submit `[NEED]`, `subscription_gate_viewed` | `subscription_gate_viewed`, checkout start | tour depth `[NEED]`, `subscription_gate_viewed` |

## Recommendation (James decides)

**Direction A, shipped in two steps, with B's ladder as its Every market section and C kept for
a `/hamilton` page.**

Reasoning:

1. **It is the only direction where "your" is true in the first click.** A buyer types their own
   institution and sees their own fees. B and C describe the buyer's position; A shows it. That is
   the endowment effect DRAPER wants, at no cost in free Hamilton seats (03 §4, Q6).
2. **It shows the product before asking for anything**, which SHERLOCK found no competitor does
   (01 §2). B and C both ask the visitor to evaluate Hamilton before seeing their own market.
3. **One door for both audiences** keeps the SearchAction and consumer traffic without a generic
   "two doors" hero (03 §3).
4. **It degrades safely.** Until the institution page becomes a buyer position view, ship A's
   layout with B's button ("See Hamilton plans") as primary and the search as secondary, which is
   DRAPER's own fallback (03 §4). When the buyer view is live, swap the two. This also gives us a
   natural test of A's CTA against B's on `subscription_gate_viewed`.
5. **B's five-row ladder is the best single picture of the Insight layer**, so it belongs in A's
   Every market section, with the locked "In Hamilton" rows. C's tour is good material for a
   `/hamilton` page reached from the nav, where a visitor has already chosen to look at software.

What I would build first, in order: the institution buyer view (A's dependency), the per-layer
public read (A's ladder and B's hero both need it), the approved My fees screenshot, then the
`/subscribe` vocabulary fix. Before the hero copy is final, DRAPER's five fee-owner conversations
(03 Q11) should test the promise line.

## Copy review note

Drafts checked against `copywriting` (no AI tells: no contrast reveals, negation lists, em dashes
in short copy or self-answered questions), `editorial-policy.md` (no typed counts, no fee-change
claims, "lower/higher" only, no "recommend"), BRAND.md voice and DRAPER's vocabulary table
("competitors" vs "peer group", "once its schedule is re-read"). Two lines need James's eye: B's
"five medians" (true only where each layer meets the minimum sample, so the source line carries
the qualifier) and C's "ready for the pricing committee" (a promise about output quality). Full
`copy-editing` pass before build.
