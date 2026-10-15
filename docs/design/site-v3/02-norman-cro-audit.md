# Site v3: CRO audit of the current pages (NORMAN)

> **Goal updated 2026-10-15 (James).** The site's goal is a Hamilton Pro subscription, monthly or
> annual. The paid report is a high-value lead, not the goal. The funnel: a free sample report, then
> the Competitive Fee Position Report ("from $300"), then Pro, either because the buyer wants it on a
> regular basis or because the report sparks a Pro demo request (through `/contact?source=demo`; no
> booking links). Where anything below ranks the report above Pro, this note wins.

Issue #1289. Written 2026-10-14 from the code on `origin/main` (branch `docs/site-v3-brief`) and the
live pages read the same day with WebFetch (feeinsight.com, /for-institutions, /subscribe, /reports;
every fetch worked). Method: the `cro` skill's seven checks, in order of impact, applied to each page.
This audit lists findings, constraints and opportunities only. The new layout waits for DRAPER's
message hierarchy.

## The goal each page was judged against

A bank or credit union fee owner should understand, within five seconds, that Fee Insight sells a
product with three layers:

1. **Data.** The Bank Fee Index: live fees read from each institution's own published schedule.
2. **Insight.** That data rolled up at institution, local (county or city), state, Fed district and
   national level.
3. **Workspace.** Hamilton, the Pro workspace: This month, My fees, Try a price, Reports, and
   Regulatory Wire.

The Competitive Fee Position Report is one thing the product produces. Consumers bring traffic and
trust, but they are not the buyer (`.agents/product-marketing.md` section 2).

Live figures quoted below are what the pages showed when fetched on 2026-10-14. They are evidence
for this audit and must not be copied into copy. Public numbers come from a fresh query under the
editorial policy.

## Summary verdict

The site sells a report, not a product. On all four pages the paid offer is the Competitive Fee
Position Report, and every primary call to action leads to its request form. Hamilton is missing
from the homepage hero, the nav, the footer and /reports. It appears properly in only two places:
the third section of /for-institutions and the /subscribe page, and those two describe it with
different vocabularies. The Insight layer (local, state, district, national) is never stated as a
capability. It shows up only as a state map and as Fed district options inside the report form. The
data layer is well proven. Live counts, medians and freshness dates appear across the site, but they
are presented to consumers ("What banks charge") rather than as evidence for a buyer.

## 1. Homepage (`src/app/page.tsx`)

**Value-prop clarity: fails for the buyer.** The h1 is just the product name, "The Bank Fee Index"
(`landing-hero.tsx:70`), with "Powered by FeeInsight.com" under it (`:74`). The subhead
(`:77-79`) leads with consumers ("Free to search for anyone checking their bank") and gives banks half
a clause ("benchmarks for the banks themselves"). A fee owner learns that this is a lookup site. They
do not learn that there is a workspace, or that the data rolls up to their own counties. The page
title and meta description are consumer-first too ("Look up overdraft, ATM, wire and monthly
fees...", `page.tsx:19-24`).

**Headline.** A noun phrase with no outcome. It fails the "Now you can" test, and it would pass the
competitor swap test only because it names the brand.

**CTA placement and hierarchy.** The hero is a three-tab switcher (`landing-hero.tsx:25-29`), and
"Find your bank's fees" is the default (`:48`). The buyer's path, "Benchmark your institution", is
the third tab and hidden behind a click. Inside it, the only CTA is "Get a free fee report", which
jumps to `#for-banks` (`:14`, `:167-174`), and the copy sells "a PDF you can take to your pricing
committee" (`:161-164`). Above the fold, a buyer sees no primary button at all. The nav pill
"Request your report" (`nav-items.ts:25`, `nav-account.tsx:50`) is the one persistent buyer CTA,
and it also points at the report.

**Hamilton is buried, and where it does appear it adds friction.** Hamilton's only appearance on the
homepage is `LandingResearchPicker`, inside the second tab, "Explore fee data"
(`landing-hero.tsx:136`). It is an unstyled form: a market select, a charter select, and a scrolling
fieldset of up to 50 fee-category checkboxes. Its links are "Review comparison in Hamilton" and
"Prepare board-report draft", and the footnote reads "Hamilton access required"
(`LandingResearchPicker.tsx:21-33`). So the first time a visitor meets the workspace, it is a gated
form with no explanation of what Hamilton is. WebFetch read this panel as page content even though
it is hidden behind a tab, so search engines and preview tools may describe the homepage by this form.

**Visual hierarchy.** The section order is hero, then the consumer price strip "What banks charge"
(`landing-price-strip.tsx:83`, everyday consumer fees at `:7-13`), then the bank offer
(`landing-bank-offer.tsx`), then the coverage map (`landing-trust-stats.tsx`) (`page.tsx:83-86`).
The strongest proof, live medians, is framed for consumers. The buyer section sits third.

**Trust signals.** These are real and live: the institution count in the subhead, the medians with
"updated Oct 14, 2026" (`landing-price-strip.tsx:113-114`), the coverage map with counts per state,
source tags (FDIC, NCUA, Federal Reserve, published schedules; `landing-trust-stats.tsx:14`), a
freshness pulse and a methodology link (`:186-197`). The sample report page images are switched off
(`SAMPLE_REPORT_LIVE = false`, `constants.ts:53`, gating `landing-bank-offer.tsx:46`), so the bank
section has no picture of the product. The only sample is a text link. There are no customer logos
or testimonials, which is correct, since none exist.

**Objection handling.** The "What happens next" steps (`landing-bank-offer.tsx:10-14`) handle
process and price for the report. Nothing handles the workspace objections: what Pro costs, whether
the buyer's market is covered, or who uses it.

**Friction.** The shared request form (`request-report-form.tsx`) defaults to the free national
report (`:88-93`). The paid option is styled to look secondary: a dashed border, muted text and a
lock icon (`:274-297`). Under the radio list, a "Look it up free" link (`:306-312`) sends a buyer
out of the form to the consumer directory. The form is well built (labels stay visible, optional
fields are marked, the button copy is specific), but its design steers a buyer down to the free
item.

## 2. /for-institutions (`src/app/for-institutions/page.tsx`)

**Value-prop clarity: partial.** "Stop guessing what your competitors charge" (`:59`) names a real
pain in the buyer's words. The subhead (`:62-64`) has live proof and closes with "or run the
workspace yourself", the only hero mention of a workspace on the whole site. Hamilton is not named.

**CTA hierarchy.** The primary CTA is "See the sample report" when the sample is live (it was live
on 2026-10-14) and "Get a free fee report" otherwise (`:70-90`). "See Fee Insight Pro" appears as the
secondary CTA only when the sample is offline (`:94-97`). Every other CTA on the page ("Get your free
report" at `:200` and `:240`, "Talk to us" at `:191`) is about reports or Advisory.

**Visual hierarchy.** The sections run: Report offer, then Pro, then comparison table, then
audiences, then Advisory, then final CTA (`:106-111`). Pro is second. Its section is the clearest
Hamilton description on the site: the canonical line (`pro-tools.tsx:77`), the four mode cards (`:28-57`) and
"The report is a snapshot; Pro is the feed" (`hamilton-copy.ts:8-11`). But the screenshot preview is
switched off (`hamilton-benchmark-preview.tsx:23`), so the workspace is described in text only. The
mode cards list four tabs (`HAMILTON_MODES`, `constants.ts:69`) and leave out Regulatory Wire, which
became a top nav item in Hamilton on 2026-10-08 (`src/lib/hamilton/navigation.ts:43-46`).

**Insight layer.** "My fees" is the only place on the site that names the geography ladder: "your
own counties, your state, your Fed district, your peer group and the nation" (`pro-tools.tsx:40-41`).
That is the Insight layer, and it is inside a card body. The comparison table's peer-group cell says
"charter, asset tier, district" (`compare-table.tsx:54`), with no county or city, and the Fee Insight
cost cell lists only "Free national and district reports" (`:55`). The table compares data sources
but never mentions the workspace.

**Trust and objections.** The live sample excerpt (`report-offer.tsx:73-113`) is strong proof:
real rows against a named local median. The comparison table handles the objection "we already buy a
survey" well. The four audience cards (`:119-140`) answer "is this for me?".

## 3. /subscribe (`src/app/subscribe/page.tsx`)

**Value-prop clarity: good for Pro, weak for Hamilton.** The h1 reads "Understand your fees. Know your
market." (`:441`) and the subhead "Benchmark, analyze and monitor bank and credit union fees." (`:444`).
These are clear but generic, and the swap test fails: a competitor could use them unchanged. The card is titled
"Fee Insight Pro" (`pro-plan-cards.tsx`, h2), and Hamilton appears only in the preview frame labels
("Hamilton · Try a price", `analyze-demo.tsx:77`) and once in the pillar copy (`showcase.tsx:17`).

**Two vocabularies for one product.** /subscribe sells Benchmark, Analyze, Monitor and Report
(`showcase.tsx:7-31`) under "One platform. Four ways to understand your market." (`:509`).
/for-institutions sells This month, My fees, Try a price and Reports under "One workspace. Four
views." (`hamilton-copy.ts:13`). Inside the product the tabs are the latter, plus Regulatory Wire.
A buyer who reads both pages meets eight names for four or five things.

**CTA and friction.** One repeated primary CTA, "Find your institution & see pricing" (`:457`,
`:552`, sticky at `:577`), with price shown up front ("From $150/mo · Up to 5 people", live). The
price follows asset size, the FAQ is short, there is a cancellation and refund line, and POs are
accepted. This is the most conversion-ready page on the site. It is also the page with the least
traffic intent, because the nav labels it "Pricing" (`nav-items.ts:20`).

**Proof.** The showcase panels are built from live data (`:181-250`), and the Regulatory Wire preview
is a real item (`:519-534`, `pro-overview.tsx:54`). This is the only place the Wire is sold.

## 4. /reports and the sample (`src/app/(public)/reports/page.tsx`)

The hub is a landing page for the paid report alone. Its h1 is "Know where your fees stand against
your market." (`:246`), it carries price, next step and format facts (`:270-282`), and it has six
contents cards, three steps, the form, an FAQ and state reports. Hamilton and Pro are absent (the
live fetch found only a "Pro" tag on a research link). The steps promise a "board-ready PDF ...
Quarterly refreshes on request" (`:82-84`), which is the job a subscription does, sold as a manual
add-on. The position-map preview is off (`:218`). The sample page (`sample-competitive-fee-position/page.tsx:134`)
is strong proof ("This is what your institution report looks like", live data, source links, CSV),
but it ends with the report CTA only (`:186-202`) and never mentions that Pro keeps this view current.

One inconsistency was visible live: the homepage said 3,888 institutions "with published fees"
(`COVERAGE_LABELS.institutions`, `public-stats.ts:44`), while /reports said 3,875 "with verified
fees" (an inline sum over state coverage, `reports/page.tsx:228`, `:373-376`). The two counts use
different definitions under different labels.

## 5. Nav and footer

- Public nav (`nav-items.ts:5-11`, `:20`): Find Your Institution, Explore data (Bank Fee Index,
  Research, Guides), For Institutions, Pricing, plus the "Request your report" pill. The product
  name is tucked into a dropdown. Hamilton does not appear. "Pricing" is the only route to the
  workspace.
- Footer (`customer-footer.tsx:36-40`): it describes the index as "for consumers and banking
  teams", and its Product column (`:46-86`) lists no Hamilton and no Pro, only "Pricing". The live
  footer also showed a second "Get the free report" email signup.

## Live proof available (`src/lib/public-stats.ts`)

`getPublicSnapshot` provides the following: institutions with published fees, institutions monitored, published fee entries,
fee categories, states covered, refresh date and the national category medians (`:14-36`,
`COVERAGE_LABELS` at `:42-47`). The homepage uses institutions, categories, states, freshness and five
medians. It does not use `observationsLabel` ("Published fee entries") or `monitoredLabel`, which
other pages do use (institutions, fees, methodology, about). It never shows any local-level figure,
such as county or city medians, or the "38 of 102 state markets ready for a full local comparison" readiness
count that /reports computes live (`reports/page.tsx:228-233`). That readiness count is the honest
proof for the Insight layer.

## Quick wins (no layout decision needed)

1. Give the homepage a visible buyer CTA in the hero, outside the tabs. Today a buyer has to click
   a tab to find one.
2. Move `LandingResearchPicker` out of the public hero, or put it behind a plain sentence about what
   Hamilton is. A gated 50-checkbox form is a poor first look at the product.
3. Add Regulatory Wire to the Hamilton description on /for-institutions. `HAMILTON_MODES` is the
   source, so check that the in-app tabs and the marketing list agree.
4. Add one line and link to Pro on /reports and on the sample page: "Pro keeps this view current
   for your market."
5. Name Hamilton in the /subscribe hero or card title, once, using the canonical line.
6. Reconcile the 3,888 and 3,875 counts by using one `COVERAGE_LABELS` figure on both pages.
7. Stop styling the paid report option as locked and muted in the form.

## High-impact changes (for the brief)

1. Reframe the homepage around the product's three layers, with the report as an output and a way
   in. This is the core of #1289. The hero h1 and subhead are the highest-impact lines on the site.
2. Choose one vocabulary for Hamilton and use it across the homepage, /for-institutions,
   /subscribe, the nav and the footer.
3. State the Insight layer as a capability, with live proof at each level: one institution, local,
   state, district, national. Today it exists only as a map and as form options.
4. Give the workspace a visible picture. Every Hamilton preview on the public pages, except those on
   /subscribe, is switched off.
5. Make the nav show the three layers. The product name is in a dropdown and the workspace is
   called "Pricing".
6. Split consumer and buyer framing on the homepage so live proof reads as evidence for a fee
   owner, not only as a consumer price list.

## Test ideas (once traffic allows)

- Hero CTA: "See your fees against your market" (opens Hamilton or a preview) against "Get a free
  fee report".
- Default hero tab: buyer versus consumer lookup, measured on `request_report_click` and
  `subscription_gate_viewed`.
- Nav label: "Pricing" against "Hamilton" or "Pro".

## Constraints the redesign must respect

- Brand: Fee Insight is the site, the Bank Fee Index is the dataset and Hamilton is the workspace.
  Never write them as one name (`constants.ts:4-6`, the `brand-kill` guard). Hamilton's canonical line
  is `HAMILTON_CANONICAL`, never "our AI analyst".
- Report price only as "From $300" from `REPORT_OFFER.priceLabel`. No turnaround promise on free
  reports. No booking links. The CTA wording "Get a free fee report" is set in product-marketing.
- No testimonials, logos or accuracy percentages, because none have been measured or earned. Proof
  must be live counts with a time, from `public-stats.ts`.
- Neutral words: "lower" and "higher". Never "recommend" or "raise". Hamilton "doesn't pick one".
- Monitoring claims are limited to "once its schedule is re-read" (`hamilton-copy.ts:4-7`). There is
  no fee-change content.
- Consumer traffic must keep its lookup path (the search bar is the site's SEO entry, along with
  `WEBSITE_JSON_LD` SearchAction, `page.tsx:49-59`).
- Headings balance and must not leave one word on a line (`heading-wrap-kill`).
- Pro pricing follows asset tiers (`pro-tiers.ts:26-28`). Prices are James's decision.

## Questions the brief must answer

1. Who does the homepage hero speak to first, the fee owner or the consumer? If it is the fee owner,
   where does the consumer lookup live, and how prominent is it?
2. What is the single primary conversion on the homepage: a report request, a Pro trial or
   checkout, or a free account? What is the secondary one?
3. What is the canonical name for the workspace in public copy: "Hamilton", "Fee Insight Pro" or
   both? Which tab list is canonical, and does it include Regulatory Wire?
4. Is the report sold as an entry product that leads into Pro, as an output of Pro, or as both?
   How should the report and the $150 to $500 a month plans appear side by side?
5. Which local-level proof can we show honestly today (county or city medians, the count of ready
   markets), and what is the minimum-sample rule for showing it?
6. What does the nav show to signed-out visitors: the three layers, or audiences ("For
   institutions")?
7. Is a free tier of Hamilton (a sign-in to see your own institution) on the table? It changes the
   CTA ladder.
8. When will the old sample visuals (`SAMPLE_REPORT_LIVE`) return, and can a live Hamilton screen
   replace them as the hero image?
