# Site v3 brief 03: positioning and message hierarchy (DRAPER)

Issue #1289. Written 2026-10-14. One-off brief; nothing is scheduled. Built on SHERLOCK's market
research (`01-sherlock-market.md`), NORMAN's CRO audit (`02-norman-cro-audit.md`) and James's
direction of 2026-10-14: the homepage sells the product and its value, not a report, through three
layers (Data, Insight, Workspace). Product facts were checked in code on this branch; file
references are given where a claim depends on them. No count appears in this brief. Where a count
belongs on the page, the brief names the live field that renders it. `[NEED: ...]` marks a claim
we cannot yet support.

## 0. The reasoning in one paragraph

SHERLOCK found that a fee owner judges fee data with three questions: is it my market, is it
current, and can I defend it? Each alternative answers one of these and leaves the other two.
Surveys give a national average, which is current once a year and comes from no named source.
Call-report peer platforms answer "my peers", but on performance ratios, not fee schedules.
Consultants answer "defend it", but with a person, not a document. Two pieces of ground are open:
no alternative read traces each figure to the institution's own published schedule, and none puts
data, market aggregation and a workspace in one product. A third gap is also ours: every
alternative's first step is a conversation, while we can show the product and its price. So
provenance carries the promise, the three layers carry the structure, and the first conversion is
the buyer seeing their own position rather than booking a call.

## 1. Positioning statement and the promise

**Positioning statement.** For people at U.S. banks and credit unions who set fee prices or have
to defend them, Fee Insight shows where each of their fees stands against their own market. It
covers named local competitors, the state, the Fed district, a peer group and the nation, and every
figure traces to the institution's own published fee schedule. Annual surveys give a national
average from an unnamed sample, and peer platforms compare call-report ratios. The Bank Fee Index
reads every institution's current schedule, and Hamilton, the Pro workspace, takes the buyer from
that figure to a decision and a board document.

**The promise line: three options**

| | Promise | What it leads with | Trade-off |
|---|---|---|---|
| A | "Every competitor's fee, in your market, traced to their own fee schedule." | Data and provenance | The sharpest differentiator, and no competitor can say it. But it sells a dataset, and a buyer files it next to RateWatch. It says nothing about what to do with the figure, which is the value James asked the page to sell. |
| **B (recommended)** | "Know where your fees stand in your market, with a source for every figure." | Value (position), then the proof (source) | It names the job (position in my market) and closes on what only we can claim (a source for every figure). It passes the swap test on its second half. "Your market" opens the Insight layer, and "know" leaves room for the workspace. |
| C | "From your competitors' fee schedules to your board pack, in one workspace." | The workflow across all three layers | It covers data, insight and workspace in one line, but "one workspace" is a generic software claim (Curinos sells "decision intelligence"), and it puts provenance in the middle where it is easy to miss. |

Why B. The buyer's first question, "is it my market?", is the hook, and "a source for every
figure" answers the third, "can I defend it?", with the one claim SHERLOCK found no one else
making. B also lets the hero follow the brand rule "lead with the figure, then the meaning": the
visual under it should be one real fee row placed in a box plot, with its source line (document,
page, date) visible. Option A's wording becomes the Data pillar's headline, so nothing is lost.

## 2. Message hierarchy

The page in order: the promise, the proof strip, the three pillars, how to start (the funnel in
section 4), and the consumer door (section 3).

**Public pillar labels.** "Insight" cannot be a public label, because the company is Fee Insight
and a heading "Insight" reads as the company name. Recommended labels: **Every fee** (Data),
**Every market** (Insight), **One workspace** (Workspace). Internally the team keeps calling them
Data, Insight and Workspace.

### Pillar 1: Every fee (Data: the Bank Fee Index)

- **What it is.** The Bank Fee Index reads each bank's and credit union's own published fee
  schedule. Each fee is kept with the document, page and date it came from. Fees stated as a rate
  are kept apart from dollar fees (`published_fee_rate_catalog`, `src/lib/percent-fees.ts`).
- **The value in a fee owner's terms.** It gives you a competitor's fee you can put in front of the
  pricing committee, because it is the competitor's own disclosure and not a survey answer. When
  a board member quotes a national average from the press, you answer with the schedules of the
  banks your customers can walk into.
- **Proof we can show today.** Live counts from `getPublicSnapshot()` in `src/lib/public-stats.ts`:
  `institutionsLabel` ("Institutions with published fees"), `observationsLabel` ("Published fee
  entries"), `categoriesLabel`, `statesLabel` and `freshnessLabel`. Show one real fee row with its
  source link, from the live sample report (`/reports/sample-competitive-fee-position`, which
  renders from published data). Link `/methodology`.
- **Must not claim.** No accuracy rate, and never "99%" (nothing beyond what `checkFeeAgainstSource`
  has measured). Do not say "every bank", "complete", "real-time" or "daily". Make no fee-change
  claims. Never type a count by hand. Do not use "verified" as a public label: NORMAN found
  "published fees" and "verified fees" with different counts on two pages, so use
  `COVERAGE_LABELS` only.

### Pillar 2: Every market (Insight: the market layers)

- **What it is.** The same fees rolled up into five layers (`LAYER_KEYS` in
  `src/lib/hamilton/research-layers.ts`):
  - **your market**: institutions with branches in your counties, or headquartered in your city
  - **your state**
  - **your Fed district**
  - **your peer group**: same charter and asset size, nationwide
  - **the nation**

  Each layer shows the median, the middle half and the institutions charging $0. A layer with fewer
  than five institutions is marked thin rather than given a median
  (`MIN_INSTITUTIONS_FOR_MEDIAN = 5`, `src/lib/data-store/maturity.ts`).
- **Should we name the peer group? Yes.** SHERLOCK found that credit union buyers already think
  in Callahan-style peer groups (charter and asset size), but on call-report ratios. Naming "your
  peer group" on the page gives them a familiar frame and shows the difference in one line: the
  same peer group, compared on its fee schedules. The cost is a word clash: the report promises
  "Named peers, not anonymous averages" (`REPORT_INCLUDES`), and there "peers" means named local
  competitors. The vocabulary rule in section 5 settles it: **competitors** are named local
  institutions, and **peer group** is the charter and asset-size layer.
- **The value in a fee owner's terms.** You see each fee above, inside or below the range in each
  of the five layers, so you know whether a fee is high for your town, for your state or only
  against the national average the press quotes. It answers SHERLOCK's top buyer question, "is it
  my market?".
- **Proof we can show today.** The free national and Fed district reports open at once. State
  reports are linked from the coverage map. The live readiness count on `/reports` comes from
  `getMarketReadinessCached()`: state markets, by state and charter type, where enough complete
  schedules exist for a full local comparison. A market is ready when at least 16 institutions
  each publish 9 or more headline fees (`src/lib/data-store/market-readiness.ts`). The
  institution page's peer-rank teaser shows a bank's overdraft and maintenance fees against its
  state or district group, as counts only.
  - `[NEED: a public figure for county-level coverage, meaning how many local markets have a median
    for a fee. No live field gives it today, so the page cannot claim "your counties" as a covered
    layer.]`
  - `[NEED: an approved Hamilton screenshot of My fees on a real institution whose local layer is not
    thin.]`
- **Must not claim.** Do not claim that every county or city has a local comparison. Never show a
  median from fewer than five institutions. Do not say "your market is covered" before the
  readiness check has run for that market. Never present Bankrate's or Moebs's averages as ours.
  Name no institution in public aggregate copy: named competitors belong inside a buyer's own
  report or workspace.

### Pillar 3: One workspace (Workspace: Hamilton)

- **What it is.** Hamilton, the Fee Insight Pro workspace (`HAMILTON_CANONICAL`). Its top
  navigation (`src/lib/hamilton/navigation.ts`) has four tabs and the Regulatory Wire, and an Ask
  Hamilton bar sits on every screen:
  - **This month**: the few fees worth a look now, and what changed in your market
  - **My fees**: the five layers, with competitors named
  - **Try a price**: any amount side by side, including $0, its effect on fee income from your own
    figures, and the notice it needs
  - **Reports**: a CEO one-pager, a pricing committee packet or a board brief, with every figure
    cited
  - **Regulatory Wire**: federal and watched-state items
- **The value in a fee owner's terms.** You go from a figure to a decision to the document the
  committee reads, without hiring a consultant or waiting for next year's survey. Hamilton shows
  the position and the effect of a price. It does not choose the price, so the decision stays with
  the institution.
- **Proof we can show today.** Prices are public. `PRO_TIERS` in `src/lib/pro-tiers.ts` sets them
  by asset size at $150, $300 and $500 a month (annual is ten monthly payments), for up to 5
  people. The `/subscribe` showcase panels render from live data, and the Regulatory Wire preview
  shows a real item. "The report is a snapshot; Pro is the feed" (`hamilton-copy.ts`).
  `[NEED: a current Hamilton screenshot approved for public use. Every public Hamilton preview
  except /subscribe is switched off.]`
- **Must not claim.** Never "our AI analyst". Do not use "recommend", "optimize" or "maximize
  revenue". Do not say "real-time alerts" or "each fee change as it is published": monitoring is
  limited to "once its schedule is re-read" (`hamilton-copy.ts`).
  - The paid report's closing section (`src/app/market-report/[token]/hamilton-close.tsx`) says
    Hamilton "shows each fee change as it is published", which breaks that rule. It should get
    its own issue.
  - Do not offer API access; it is by invitation (`hamilton-copy.ts`).
  - Show no customer logos, testimonials or outcome figures.

## 3. Audience strategy: fee owners and consumers on one homepage

The tension is real. Consumers bring search traffic, links and the public record that makes the
data trustworthy. Fee owners bring the revenue. A homepage that speaks to both in the same breath
becomes generic ("for consumers and banking teams", today's footer).

The insight that resolves most of it is that both audiences start in the same place, a
search for one institution. A consumer types their bank to see its fees. A fee owner types their
own institution to see where it stands. The institution page is where the two split. The hero
does not have to split them.

**Options (James's call):**

1. **Fee owner hero, with the search shared (recommended).** The h1 and subhead speak to the fee
   owner (promise B). The search box sits in the hero, with the placeholder "Your bank or credit
   union". A consumer line sits under it ("Checking your own bank's fees? Search the same index,
   free"). The consumer price strip moves below the three pillars and is relabeled as market
   evidence. The trade-off is that a consumer arriving at `/` reads a headline not written for
   them. That cost is small if most consumers enter on institution, fee and guide pages rather
   than the homepage. `[NEED: Vercel Analytics share of consumer sessions that land on / versus
   deep pages, to confirm.]`
2. **Two doors in the hero.** One line for each audience, side by side. It is fair to both, but it
   brings back the generic split NORMAN flagged and halves the weight of the promise.
3. **Consumer hero, with a buyer band (today, with fixes).** This is the lowest risk to SEO, but it
   is the "lookup site" first impression that NORMAN and James rejected.

Whichever is chosen, keep the `WEBSITE_JSON_LD` SearchAction and the search's crawlable path. The
consumer section can also do work for the buyer without being weaponized: "the same published
figures your customers can look up" tells a fee owner the data is public and current. Use it once,
neutrally, and never as a threat about exposure.

## 4. Funnel and primary conversion

**The ladder, as it exists in code today:**

1. **Free data.** Institution search, fee pages and the peer-rank teaser on institution pages.
2. **Free reports.** National and Fed district reports, instant (`REPORT_OFFER_LINE`), plus state
   reports. Basic fee alerts come with a free account (`src/app/account/alerts-panel.tsx`).
3. **Paid, one-off.** The Competitive Fee Position Report, `REPORT_OFFER.priceLabel` ("From
   $300"). Each one is quoted, and we reply within one business day with scope and price.
4. **Paid, ongoing.** Hamilton Pro, by asset tier, for up to 5 people. Consultants pay the mid
   price with 10 Hamilton reports a month (`CONSULTANT_PRICE_NOTE`). Per DECISIONS, Pro trials are
   14 days and set up by hand, and the market report and annual Pro are separate products.

**The primary homepage CTA: three options (James's call)**

| | Primary CTA | Pros | Cons |
|---|---|---|---|
| A | "Get a free fee report" (today's standard) | Lowest friction. It is set in product-marketing and is the measured event (`request_report_click`). | It sells a report, which James rejected. The free reports are national and district, not the buyer's market, so the CTA under-delivers on "your market". |
| **B (recommended)** | "See where your fees stand", which is the institution search | It shows the product before asking for anything, which no competitor does. It shares one door with consumers (section 3) and matches /subscribe's "Find your institution & see pricing". It leads naturally to either paid path. | The institution page has to become a buyer page: its position view is two fees, counts only, against the state or district group. That needs a build issue. A buyer who searches and finds thin coverage meets a weak moment, which is honest but costly. |
| C | "See Hamilton" (a tour, then pricing) | It sells the workspace directly, and the price is visible. | A cold buyer is asked to evaluate a subscription with no proof of their own market. Today it would lean on switched-off screenshots. |

**Recommendation.** B is primary and "See Hamilton plans" is secondary. Free reports become an
inline link in the Every market pillar ("Read the free national and district reports"). The paid
report sits in the One workspace pillar as the no-subscription option: "Prefer one document? We
build a Competitive Fee Position Report for your institution, from $300", rendered from
`REPORT_PRICE_INLINE`. The nav pill follows the primary CTA. If B cannot be built before launch,
use C's wording on the button and point it at /subscribe, which is already the most
conversion-ready page. Do not fall back to A.

**NORMAN's questions:**

- **Hamilton's public name.** "Hamilton" is the workspace, and "Pro" is the plan. First mention on
  any page: "Hamilton, the Fee Insight Pro workspace". Buttons: "See Hamilton plans". Retire "Fee
  Insight Pro" as a heading (it can stay as the Stripe product name, `PRO_PRODUCT_NAME`). BRAND.md
  supports this, since Hamilton has its own lockup.
- **Canonical tab list.** This month, My fees, Try a price, Reports, then Regulatory Wire, with Ask
  Hamilton described as the bar on every screen. Retire Benchmark, Analyze, Monitor and Report on
  /subscribe (`showcase.tsx`). Either add the Wire to `HAMILTON_MODES` or add a
  `HAMILTON_WIRE_NAV` line to every public description. The code is the source, so marketing reads
  from it.
- **The report: entry or output.** It is an output, offered as the one-off alternative to the
  feed. The homepage presents the paid report as "a snapshot" and Hamilton as "the feed"
  (`hamilton-copy.ts`). On /reports and the sample page the report stays the lead, with one line
  pointing to Pro (NORMAN quick win 4).
- **A free Hamilton tier.** Recommend no free Hamilton tier before the first sale. The free tier
  already exists in substance, as the public institution page plus free reports. Making that page
  the buyer's position view (option B) gets most of the endowment effect at no extra cost.
  - A signed-in free Hamilton would bring paid model calls (Ask Hamilton) under a provider budget
    that is capped. It would also blur the separation between the report and Pro that James
    chose.
  - Revisit after the first five conversations.
- **Local-level proof.**
  - Show the readiness count with its definition (state and charter markets).
  - Show the per-institution peer-rank teaser.
  - Show a Hamilton screenshot of a non-thin local layer.
  - Do not claim county coverage until a live field exists (`[NEED]` above).
  - The minimum-sample rule is five institutions for any median, and market readiness for a named
    comparison.

## 5. Naming and vocabulary rules for the site

| Say | Meaning | Don't say |
|---|---|---|
| Fee Insight | The company and site; it publishes | "Fee Insight Bank Fee Index", "Fee Insight's Index" as one name |
| Bank Fee Index | The data: fees read from each institution's own published schedule | "our database", "scraped", "crawled", "the platform" |
| Hamilton (first mention: "Hamilton, the Fee Insight Pro workspace") | The workspace | "our AI analyst", "Fee Insight Pro" as a heading, "the dashboard" |
| Pro | The plan you pay for | "seats" (it is one plan for up to 5 people) |
| your market, your state, your Fed district, your peer group, the nation | The five market layers | "Insight" as a heading; "peers" with no qualifier |
| competitors | Named local institutions in a buyer's own report or workspace | "peers" for these, in public copy |
| peer group | Same charter and asset size, nationwide | "peers" alone |
| published fee schedule; source document, page and date | Where every figure comes from | "verified" as a public count label; "real-time" |
| free market reports (national, Fed district, state) / Competitive Fee Position Report / Hamilton reports | The three things called "report" | "report" on its own when the price differs |
| lower, higher, above, inside or below the range | Position | cheapest, worst, gouging, raise, recommend, optimize, maximize revenue |
| once its schedule is re-read | Monitoring | "instant alerts", "every change as it happens" |

Pipeline agent names (Knox, Darwin and others) and "AI" do not appear on public pages. Proof
belongs to the published schedule, not to the machinery.

## 6. Proposed changes to `.agents/product-marketing.md` (for James's approval; not edited)

- **v1.0 to v1.1, changelog:** "Repositioned around three layers (data, market, workspace) and
  provenance, after the SHERLOCK and NORMAN site v3 briefs (#1289)."
- **Section 1, Product overview:**
  - Add the three layers with their public labels.
  - Replace "Its four tabs" with the four tabs plus Regulatory Wire and the Ask Hamilton bar.
  - Add the naming rule: Hamilton is the workspace and Pro is the plan.
- **Section 1, conflict with BRAND.md:** BRAND.md (design system package, commit 00eb246d) calls
  the Bank Fee Index "free public fee data for consumers" and Hamilton "the B2B fee intelligence
  product". James's direction makes the Bank Fee Index the data layer that buyers pay to work
  with. Product-marketing should say this, and BRAND.md should be aligned (see Q8).
- **Section 2, Ideal customer:** Add that consumers and fee owners share one entry point, the
  institution search.
- **Section 3, Problems:** Mark the four buyer quotes as hypotheses. SHERLOCK found no public
  source for them, so they become sourced voice only after customer conversations.
- **Section 4, Offers:**
  - Replace "Hamilton Pro | Pro price stays as is" with the tiers from `PRO_TIERS`: $150, $300 and
    $500 a month, or $1,500, $3,000 and $5,000 a year, by asset size, for up to 5 people. Add the
    consultant price and the cap of 10 reports a month.
  - Remove "Institution plan | $5,000 a year". No separate institution plan exists in code; $5,000
    a year is the large Pro tier.
  - Add state reports to the free row if James confirms they are free. `[NEED: confirm.]`
  - Add the 14-day hand-set trial and the founding two-year price lock only if James wants them on
    the site.
- **Section 4, CTA:** Replace "Get a free fee report" as the CTA with the outcome of Q1. Keep
  "Get a free fee report" as the label for the free reports only.
- **Section 5, Differentiation:**
  - Add SHERLOCK's gaps: no alternative claims source-traceability, none sells all three layers,
    and none shows a price.
  - Add "where alternatives are stronger": track record, outcome proof, consulting depth, rates
    and commercial fees, and free CU peer tools.
  - Change "Named peers" to "named competitors" and "peer group".
- **Section 6, Voice:** Add the section 5 vocabulary table. Add the BRAND.md rules: lead with the
  figure, then the meaning; no exclamation marks.
- **Section 7, Proof:** Add the readiness count (`getMarketReadinessCached`), a source-linked fee
  row and the public price as approved proof. Add the minimum sample: five institutions for a
  median.

## 7. Open questions for James

1. **The primary homepage CTA.** A free report, the institution search ("See where your fees
   stand") or See Hamilton? *Recommend the institution search, with "See Hamilton plans" as the
   secondary.*
2. **Who the hero speaks to.** *Recommend fee owners, with the search shared and a single consumer
   line under it (section 3, option 1).* Before deciding, check where consumer sessions land.
3. **The promise line.** *Recommend B: "Know where your fees stand in your market, with a source
   for every figure."*
4. **Name the peer group layer publicly?** *Recommend yes, as "your peer group (same charter and
   asset size)", with "competitors" reserved for named local institutions.*
5. **The public name and tab list.** *Recommend "Hamilton, the Fee Insight Pro workspace", with
   the four tabs plus Regulatory Wire.* Also retire the Benchmark, Analyze, Monitor and Report
   names on /subscribe.
6. **A free Hamilton tier.** *Recommend not before the first sale. Make the public institution page
   the buyer's free position view instead.*
7. **The institution plan.** Product-marketing lists a $5,000-a-year institution plan, but the code
   has none. *Recommend dropping it as a separate offer, since the large Pro tier covers it, unless
   you mean something else, such as more seats.*
8. **BRAND.md's product split.** It calls the Bank Fee Index consumer data and Hamilton the B2B
   product. *Recommend amending it so the Bank Fee Index is the data for everyone and Hamilton is
   where buyers work with it.*
9. **The hero visual.** Bring back the old sample images, or use a live Hamilton screen? *Recommend
   one live fee row in a box plot with its source line in the hero, and a live My fees screen in
   the Workspace pillar. Both need your approval for public use.*
10. **The HamiltonClose copy** ("each fee change as it is published"). *Recommend a fix issue to use
    "once its schedule is re-read".*
11. **Buyer voice.** *Recommend five short fee-owner conversations before the hero copy is final.*
    The problem phrases in product-marketing are unsourced, and the promise should be tested
    against real words.
