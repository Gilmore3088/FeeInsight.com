# Public site review: SEO, copy, structure, buyer path (issue #1134, step 1)

Reviewed 2026-10-13, about 02:20 to 02:35 UTC, against `main` at `332afc26` and the live site
https://feeinsight.com. This review is read-only. It changed nothing.

## How the review was done, and what it did not check

- **Live pages.** This session's proxy refuses `feeinsight.com` (curl got a 403 on CONNECT, and
  WebFetch could not resolve the host). Live pages were fetched with the Vercel MCP
  `web_fetch_vercel_url` tool, which returns the raw HTML, the status code and the response
  headers. A local script parsed each page's `<title>`, meta tags, canonical, Open Graph tags,
  JSON-LD, headings, links and visible text. Pages fetched: `/`, `/for-institutions`, `/reports`,
  `/reports/sample-competitive-fee-position`, `/subscribe` (the "Pricing" page), `/methodology`,
  `/research`, `/research/national-fee-index`, `/research/state/WA`, `/research/state/wa`,
  `/research/district/12`, `/research/fee-revenue-analysis`, `/fees/overdraft`,
  `/fees/city/wa/seattle`, `/fees/city/ar/little-rock`, `/institution/1`,
  `/institution/99999999`, `/guides`, `/guides/overdraft-fees`, `/about`, `/contact`,
  `/robots.txt`, `/sitemap.xml`, `/llms.txt`.
- **Not measured:** Core Web Vitals, Lighthouse, TTFB, and render timing. The fetch tool gives no
  timings, and Playwright goes through the same blocked proxy. The page-speed findings below rest
  on response headers and HTML size only. Search Console and analytics were not available.
- **Not fetched live, source only:** `/fees`, `/institutions`, `/api-docs`, `/terms`, `/privacy`,
  `/submit-fees`, `/guides/pro/*`, `/research/market-concentration`.
- **Numbers.** Every count in this file was read from a live page at the time above, or counted
  from the live sitemap. None comes from a database query. Where two pages disagree, both values
  are quoted as the page showed them.

## Summary

The technical base is mostly in place. Every page has a canonical URL. Thin pages are noindexed
and left out of the sitemap. Tokenized report and pay links are noindexed and blocked in
robots.txt. JSON-LD is present on most templates, and `llms.txt` exists. The problems that cost
the most are elsewhere.

1. **The buyer path does not lead to the paid report.** The nav's one call to action, "Request
   your report", opens a form with the *free* national report preselected. The paid option is
   third and looks disabled (dashed border, muted text, a lock icon). `/reports`, the page that
   actually sells the report, has no inbound link from the nav, the footer, the homepage or any
   template fetched. "Pricing" in the nav is the Hamilton Pro page, where the report is listed
   under "Not ready for a subscription?" (P1, S1, T13).
2. **Public copy breaks the editorial policy in several places.** The `/subscribe` page lists
   named credit unions with old-to-new fee amounts, which is fee-change content. Guides make
   unsourced claims and give switching advice ("change banks", "Worth switching over"). The guide
   footer and the national page use a second index name, "National Fee Index". Methodology states
   a recheck cadence and an asset-size skew without a source, and the state pages describe the
   cadence differently (C5, C6, C7, C10).
3. **Some public figures look wrong or are not comparable.** The public sample report leads with
   an overdraft fee of $7 read from a line that says "Overdraft Fee on item under $5". City pages
   compare a city *mean* against the national *median*, and show a figure from a single
   institution. Coverage counts disagree from page to page at the same moment. These wait on
   #1058 (C17, C14, C15).
4. **There are technical SEO fixes that are safe now:** 29 duplicate city URLs in the sitemap,
   city pages reachable at two self-canonical URLs, an unused render-blocking icon stylesheet on
   every public page, gated pages left indexable, a soft 404 on missing institutions, missing
   `og:url`, overlong titles and descriptions, `lastmod` set to "now", schema gaps, and a stale
   link in `llms.txt`.

**Class key**

- **(a)** safe now. Technical SEO with **no visible wording change** on the page. The heading of
  each such finding is marked **PURE TECH**. Title and meta-description edits show up only in
  search results and browser tabs; they are marked "SERP-only" and kept in (a).
- **(a-copy)** safe now. Visible copy that quotes no benchmark number. It is customer-facing:
  open the PR with a copy-review note, do not merge it yourself, and list it for James to check
  on the Vercel preview.
- **(b)** waits on #1058. Anything that shows, or changes, a benchmark number.

Severity is High, Med or Low, judged by the effect on the ~$300 report sale and on trust in the
figures.

---

## Findings

### Technical SEO

#### T1. Sitemap lists 29 duplicate city URLs. **PURE TECH**
- **Area:** sitemap. **Severity:** Med. **Class:** (a)
- **File:** `src/lib/data-store/geographic.ts:282` (`GROUP BY LOWER(ct.city), ct.city, ct.state_code`);
  `src/app/sitemap.ts:114-127` (lowercases the city when it builds the URL).
- **URL:** https://feeinsight.com/sitemap.xml. It has 4,096 `<loc>` entries and 29 duplicates,
  among them `/fees/city/ar/little%20rock`, `/fees/city/ca/los%20angeles`,
  `/fees/city/fl/miami`, `/fees/city/ut/salt%20lake%20city` and `/fees/city/dc/washington`.
- **What's wrong:** The query groups on both `LOWER(city)` and the raw `city`. A city stored as
  "Little Rock" on some rows and "LITTLE ROCK" on others comes back as two rows, and both map to
  the same lowercased URL. The same `GROUP BY` appears at lines 253 and 306.
- **Change:** Group on `LOWER(ct.city), ct.state_code` only, and pick one display name with
  `MIN(ct.city)` or `INITCAP`. Also dedupe URLs in `sitemap.ts` before returning them. Extend
  `src/app/sitemap.test.ts` with a duplicate-case fixture.

#### T2. City pages answer at two URLs, and each one is self-canonical. **PURE TECH**
- **Area:** canonical. **Severity:** Med. **Class:** (a)
- **File:** `src/app/(public)/fees/city/[state]/[city]/page.tsx:33-54` sets no
  `alternates.canonical`, so the page inherits `canonical: "./"` from `src/app/layout.tsx:30`.
  `titleCase()` at `page.tsx:26-31` splits on both hyphens and spaces, so `little-rock` and
  `little%20rock` render the same page. The BreadcrumbList at `page.tsx:94-101` uses
  `encodeURIComponent` (`%20`).
- **URL:** https://feeinsight.com/fees/city/ar/little-rock returns 200 with canonical
  `https://feeinsight.com/fees/city/ar/little-rock`, while its own breadcrumb JSON-LD and the
  sitemap use `/fees/city/ar/little%20rock`.
- **What's wrong:** One page has two indexable URLs. Spaces in a URL also make a weak slug.
- **Change:** Set `alternates: { canonical: \`/fees/city/${state.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}\` }`
  so the canonical matches the sitemap and internal links. Moving to hyphen slugs would also mean
  handling hyphenated city names (see the note at
  `src/app/(public)/institution/[id]/profile-data.ts:164-168`), so treat that as a follow-up with
  a 301.

#### T3. An unused, render-blocking icon stylesheet loads on every public page. **PURE TECH**
- **Area:** page speed. **Severity:** Med. **Class:** (a)
- **File:** `src/app/layout.tsx:58-67` (the Material Symbols `<link rel="stylesheet">` from
  fonts.googleapis.com in the root `<head>`).
- **URL:** every page fetched. The live HTML has both a `preload` and a `stylesheet` link for
  it. The class `material-symbols` appears 0 times in the HTML of `/`, `/for-institutions`,
  `/reports`, `/research/state/WA`, `/fees/city/wa/seattle`, `/institution/1`,
  `/guides/overdraft-fees` and the sample report.
- **What's wrong:** A third-party CSS file blocks first paint on every public page, and only the
  `/pro` Hamilton screens use it.
- **Change:** Move the link into the `/pro` layout (`src/app/pro/layout.tsx`). React 19 hoists
  `<link rel="stylesheet" precedence="default">` into `<head>`, so the first-paint fix the comment
  describes still holds there. Related: #1003 (a Google font response breaking a preview build).

#### T4. Every marketing page renders on each request and is never cached. **PURE TECH**
- **Area:** page speed and availability. **Severity:** Med. **Class:** (a)
- **File:** `src/app/(public)/fees/city/[state]/[city]/page.tsx:1` and
  `src/app/(public)/fees/city/[state]/page.tsx:1` (`force-dynamic`). For `/`,
  `/for-institutions`, `/reports`, `/subscribe`, `/about` and `/contact`, the source of the
  dynamic rendering was not traced. A likely cause, not verified, is the session-aware nav
  (`src/components/nav-items.ts:36-39`, `navItemsFor(session)`), which reads cookies.
- **URL:** these responses carried `cache-control: private, no-cache, no-store` and
  `x-vercel-cache: MISS`: `/`, `/for-institutions`, `/reports`, `/subscribe`, `/about`,
  `/contact`, `/research`, `/research/state/WA`, `/fees/city/wa/seattle`, `/institution/1`,
  `/guides`. Only `/methodology` (`STALE`) and `/guides/overdraft-fees` sent a public
  cache-control.
- **What's wrong:** Every crawl and every visit hits the database. #1153 records public pages
  failing for about five minutes on 2026-10-12 because of database connect timeouts. TTFB was not
  measured here.
- **Change:** Measure TTFB first. Then make the marketing pages static or ISR (`revalidate`),
  with the signed-in parts of the nav rendered as a client island. Data pages can use the
  existing `cachedPublicRead` with ISR.

#### T5. Heavy HTML and duplicated markup. **PURE TECH**
- **Area:** page speed. **Severity:** Low. **Class:** (a)
- **File:** `src/components/hamilton/landing/LandingResearchPicker.tsx` (renders 50 fee-category
  checkboxes on the homepage); `src/app/for-institutions/request-report-form.tsx:352-364` (the form
  renders twice on `/`, so `id="report-email-free"` appears twice).
- **URL:** uncompressed HTML sizes measured: sample report 625 KB, `/research` 358 KB,
  `/research/state/WA` 343 KB, `/institution/1` 268 KB, `/` 217 KB.
- **Change:** Take the picker off the public homepage (see C2). Render the request form once.
  Make IDs unique.

#### T6. A missing institution returns 200, not 404. **PURE TECH**
- **Area:** indexation. **Severity:** Low. **Class:** (a)
- **File:** `src/app/(public)/institution/[id]/page.tsx:90-93` (`generateMetadata` returns the
  title "Institution Not Found" instead of calling `notFound()`); `src/app/(public)/loading.tsx`
  starts streaming before the page's own `notFound()` at lines 120 and 125, which locks the status
  at 200. The same pattern is at `src/app/(public)/research/district/[id]/page.tsx:34`,
  `src/app/(public)/fees/city/[state]/[city]/page.tsx:37` and
  `src/app/(public)/fees/city/[state]/page.tsx:17`.
- **URL:** https://feeinsight.com/institution/99999999 returns status 200 with
  `<meta name="robots" content="noindex">` and a canonical pointing at itself.
- **Change:** Call `notFound()` inside `generateMetadata` when the record is missing, so crawlers
  get a real 404.

#### T7. Gated research pages are indexable, thin, and linked from every page. **PURE TECH**
- **Area:** indexation, thin content. **Severity:** Med. **Class:** (a)
- **File:** `src/app/(public)/research/fee-revenue-analysis/page.tsx:14-15,29-32` (UpgradeGate for
  signed-out visitors, no robots rule); `src/app/(public)/research/market-concentration/page.tsx:11-12,38`
  (same pattern); footer link at `src/components/customer-footer.tsx:102`. Professional guides
  `/guides/pro/*` are in the sitemap even though only the title, description and an upgrade prompt
  show (`src/app/sitemap.ts:204-214`). The `/guides/pro/*` pages were not fetched.
- **URL:** https://feeinsight.com/research/fee-revenue-analysis returns 200 with no H1, an H3
  only, about 1,660 characters of visible text and a "See pricing" gate.
- **Change:** Set `robots: { index: false, follow: true }` when the viewer can't see the body, or
  publish a real public summary first. Take `/guides/pro/*` out of the sitemap while they are
  gated.

#### T8. `og:url` is missing on most pages. **PURE TECH**
- **Area:** metadata. **Severity:** Low. **Class:** (a)
- **File:** `src/app/layout.tsx:37-40` (the root `openGraph` has no `url`).
- **URL:** no `og:url` on `/`, `/reports`, `/subscribe`, `/contact`, `/about`,
  `/fees/city/wa/seattle`, `/fees/overdraft` or `/institution/1`.
- **Change:** Add `url: "./"` to the root `openGraph`. It resolves per route the same way the
  canonical already does.

#### T9. Titles and meta descriptions are too long. **PURE TECH, SERP-only text**
- **Area:** metadata. **Severity:** Med. **Class:** (a). The text shows only in search results
  and browser tabs.
- **File and URL (measured lengths):**
  - Institution title, 94 characters:
    "JPMorgan Chase Bank, National Association Fees: Overdraft $34, Monthly $5 (2026) | Fee Insight".
    Built at `src/app/(public)/institution/[id]/profile-data.ts:154-162`.
    https://feeinsight.com/institution/1
  - Guide title, 79 characters, at https://feeinsight.com/guides/overdraft-fees (guide data, see C6).
  - `/research/national-fee-index` title, 72 characters
    (`src/app/(public)/research/national-fee-index/page.tsx:26`).
  - `/research/district/12` title, 72 characters.
  - Home description, 214 characters (`src/app/page.tsx:23-24`).
  - `/reports` description, about 222 characters.
  - `/methodology` description, about 230 characters (`src/app/(public)/methodology/page.tsx:33-34`).
- **Change:** Keep titles to about 60 characters and descriptions to about 155. Drop
  " (2026)" and the second and third fee from the institution title, or fall back to
  "{Name} fees and fee schedule". The institution title prints the institution's own fee amounts,
  not a benchmark, so it does not need to wait on #1058.

#### T10. Sitemap `lastmod` is "now" for static pages. **PURE TECH**
- **Area:** sitemap. **Severity:** Low. **Class:** (a)
- **File:** `src/app/sitemap.ts:130,155-168,173-174,209` (`now` is used as `lastModified`).
- **URL:** https://feeinsight.com/sitemap.xml. `/about`, `/privacy` and `/terms` show the time of
  each rebuild.
- **Change:** Use a real date: the file's last change, or a constant updated when the page
  changes. Otherwise leave `lastModified` out for static pages. Google ignores `lastmod` values it
  finds unreliable.

#### T11. Structured data gaps and a misleading type. **PURE TECH**
- **Area:** schema. **Severity:** Med. **Class:** (a)
- **File and URL:**
  - Institution page: `src/app/(public)/institution/[id]/profile-jsonld.tsx:17` marks Fee
    Insight's page as `FinancialService` with the bank's name, which presents the page as the
    bank's own. Seen at https://feeinsight.com/institution/1.
    **Change:** use `WebPage` with `about: { "@type": "BankOrCreditUnion", name, address }`, and
    keep the BreadcrumbList.
  - The `Article` on state, district and fee-category pages has only `headline`, `description` and
    `url`. It lacks `datePublished` or `dateModified`, `author` and `publisher`
    (`/research/state/WA`, `/research/district/12`; `/fees/overdraft` has `dateModified` and
    `publisher` but no `author`).
    **Change:** add `dateModified` (the data refresh date) and the Organization.
  - Data pages are good candidates for `Dataset` (Google Dataset Search, AI answers). Only
    `/research/national-fee-index` carries `Dataset`, and it lacks `license`, `temporalCoverage`,
    `variableMeasured`, `isAccessibleForFree` and `creator.url`.
    **Change:** add `Dataset` to `/fees/[category]` and `/research/state/[code]`, with those
    fields.
  - The Organization on `/` (`src/app/page.tsx:32-47`) has no `sameAs`.
    **Change:** add the Fee Insight LinkedIn company page URL once James confirms it.
  - Guide FAQPage: fine to keep. Google shows FAQ rich results only for government and health
    sites, so expect no rich result from it.

#### T12. `llms.txt` has a stale link and leaves out the paid offer. **PURE TECH (llms.txt only)**
- **Area:** AI search. **Severity:** Med. **Class:** (a)
- **File:** `src/lib/llms-txt.ts:28` links `/districts`, which permanently redirects to
  `/research#districts` (`src/app/(public)/districts/page.tsx`).
- **URL:** https://feeinsight.com/llms.txt (200, `text/plain`).
- **What's wrong:** Besides the stale link, it never names the Competitive Fee Position Report,
  `/reports`, the sample report, Hamilton or `/contact`. An AI assistant asked "who sells bank fee
  benchmarking reports" has nothing to quote. There is no `llms-full.txt`.
- **Change:** Link `/research#districts`. Add a "Reports" section with `/reports`, the sample
  report and one line on what the report contains (from `REPORT_INCLUDES` in
  `src/lib/constants.ts`). Name Hamilton with `HAMILTON_CANONICAL`. Add `/contact`. If the price
  is added, use `REPORT_OFFER.priceLabel`; it is a price, not a benchmark.

#### T13. Internal links skip the pages that sell and the indexable state reports.
- **Area:** internal links. **Severity:** High. **Class:** split.
  - **T13a, PURE TECH (a):** the homepage map links each state to `/institutions?state=XX`
    (`src/app/landing-trust-stats.tsx:71,156`) instead of the indexable state report
    `/research/state/XX`. Change the href. The visible labels stay the same.
  - **T13b (a-copy):** `/reports` has no inbound link. Of the 20 page fetches checked, none links
    to `/reports` except `/reports` itself and the sample report. The nav (`src/components/nav-items.ts:5-25`)
    and the footer (`src/components/customer-footer.tsx:50-145`) leave it out. The footer label
    "State Reports" points to `/research` (`customer-footer.tsx:108`). The footer has no
    Methodology link and no sample report link.
    **Change:** add "Reports" to the nav and the footer. Point "State Reports" at the state list
    anchor. Add Methodology and the sample report to the footer.

### AI search

#### A1. Pages read well to AI engines; conflicting figures are the risk.
- **Area:** AI search. **Severity:** Med. **Class:** see the linked findings.
- Content is server-rendered, so headings, tables and the "Key findings" blocks are in the HTML.
  Each state page states its method in plain words ("One value per institution; a state median
  needs at least 5 institutions").
- The risk is contradictions an answer engine would pick up: three institution counts (C15), two
  CPI figures for the same month (C16), and guide claims that the same page's chart contradicts
  (C6). Fix those before pushing for AI citations.
- Robots.txt blocks no AI crawler, which matches the goal.

#### A2. Give AI engines a quotable fact block about the report. (a-copy)
- **Area:** AI search and copy. **Severity:** Med. **Class:** (a-copy)
- **File:** `src/app/(public)/reports/page.tsx`, `src/app/for-institutions/page.tsx`.
- **URL:** https://feeinsight.com/reports and https://feeinsight.com/for-institutions
- **What's wrong:** No short Q&A on either page says, in one place, what the report is, who it is
  for, what it costs ("From $300", quoted per institution), what it contains, how peers are chosen
  and how it is delivered.
- **Change:** Add a five-to-six question FAQ built from `REPORT_OFFER`, `REPORT_INCLUDES` and the
  "Sources and method" text of the sample report. Add `FAQPage` JSON-LD only if the visible text
  matches it.

### Copy

#### C1. "From $300": the product-marketing file contradicts the decision record, and the site phrases the price four ways.
- **Area:** copy, docs. **Severity:** Low. **Class:** (a-copy) for the site wording; the docs fix
  is Foundation work.
- **File:** `.agents/product-marketing.md` section 4 says "Never write 'from $300'".
  `growth-os/context/editorial-policy.md` section 3 points to it. `docs/project/DECISIONS.md:728-735`
  records James choosing "From $300" (UAT thread, 8 Oct, 15:24 to 15:25 UTC), and
  `src/lib/constants.ts:36` follows the decision.
- **On the site:** "the report for your institution starts at $300" (`src/app/landing-hero.tsx:164`,
  `src/app/landing-bank-offer.tsx:33`); "From $300" (`REPORT_OFFER.priceLabel`); "from $300" written
  out by hand in `src/app/(public)/about/page.tsx:55`, `src/app/(public)/contact/contact-form.tsx:9`
  and `src/app/(public)/institution/[id]/institution-metrics.tsx:103`; "From $300, one institution,
  paid once" on `/subscribe`.
- **Change:** Update `.agents/product-marketing.md` section 4 and the editorial-policy pointer to
  match DECISIONS.md. Render every price mention from `REPORT_OFFER.priceLabel`.

#### C2. The homepage hero holds a Hamilton-only tool.
- **Area:** copy, CRO. **Severity:** High. **Class:** (a-copy)
- **File:** `src/app/landing-hero.tsx:136` renders `LandingResearchPicker`
  (`src/components/hamilton/landing/LandingResearchPicker.tsx:22,33`).
- **URL:** https://feeinsight.com/. The second H2 is "Compare published fees in Hamilton", followed
  by about 50 fee checkboxes, "Hamilton access required", and buttons that go to `/pro/analyze` and
  `/pro/reports`, both of which need sign-in.
- **What's wrong:** A first-time visitor, whether a consumer or a bank marketing manager, meets a
  locked tool before the medians or the report offer. It also adds markup weight (T5).
- **Change:** Remove the picker from the public homepage. Point "Benchmark your institution" to
  `/reports`.

#### C3. "Powered by FeeInsight.com" under the H1.
- **Area:** brand copy. **Severity:** Low. **Class:** (a-copy)
- **File:** `src/app/landing-hero.tsx:11,74`.
- **URL:** https://feeinsight.com/
- **What's wrong:** It reads like a third-party widget credit. It spells the company as a domain,
  where brand strings live in `src/lib/constants.ts`.
- **Change:** Drop the line, or use "from {SITE_NAME}".

#### C4. Fee-change content naming institutions sits on public pages.
- **Area:** copy, editorial policy. **Severity:** High. **Class:** (a-copy). Removing the panel
  quotes no number.
- **File:** `src/app/subscribe/example-panels.tsx:36-58` (MonitorPreview), rendered at
  `src/app/subscribe/page.tsx:393`. Related wording:
  `src/app/for-institutions/hamilton-copy.ts:9` ("see a competitor's fee change once its schedule
  is re-read"); `src/app/(public)/guides/[slug]/page.tsx:640` ("Get told when your bank raises this
  fee"); `src/app/(public)/institution/[id]/fee-alert-control.tsx:70` ("Get an email when {name}
  changes a fee"); the sample report's "shows each fee change as it is published".
- **URL:** https://feeinsight.com/subscribe shows "Published fee changes" with two named credit
  unions and old-to-new amounts (for example "Account Research · Oct 5, 2026 · $25.00 to $50.00").
- **What's wrong:** `.agents/product-marketing.md` section 6 and editorial policy section 2 say
  catalog changes mostly reflect fees being loaded and re-read, and rule out fee-change claims.
  This panel names institutions with changes that may be load artifacts. "Raises" is on the
  banned list.
- **Change:** Remove the live change list from `/subscribe`, or replace it with a non-live
  illustration James approves. Reword the alert CTAs to "Get an email when {name}'s published
  schedule is updated". Drop "raises".

#### C5. Guides: unsourced claims, regulatory statements without a primary source, and switching advice.
- **Area:** copy, editorial policy. **Severity:** High. **Class:** C5a (a-copy) for the
  qualitative claims; C5b (b) for the rows that print p25 and p75 thresholds.
- **File:** `src/lib/guides/catalog-consumer.ts`. The live guide may be served from the
  `consumer_guides` table instead (`src/lib/guides/source.ts`), so edit both the seed and the
  stored rows.
  - Line 100: "Large national banks charge the most … Credit unions charge less — … consistently".
    The same live page's chart shows credit unions at $30.00 (n=1,493) and banks at $30.00
    (n=992).
  - Line 126: "Banks routinely waive a first overdraft fee … It works more often than people
    expect". No source.
  - Line 127: "If it keeps happening, change banks … a reason to move". This is advice.
  - Line 151: "Most people underestimate their annual total by a wide margin". No source.
  - Line 155: the CFPB "most-complained-about" claim has no link or date.
  - Regulation E and Regulation DD statements (around lines 140-151) have no primary-source link.
    Editorial policy section 2 requires a statute, rule or agency release.
  - Lines 171-174, repeated at 315-317, 465-467, 613-615, 753-755, 903-905 and 1053-1055: "Better
    than 75% of institutions", "You pay more than 75% of the country", "Worth switching over".
  - Line 96 (and 397): the heading "Who charges the most, and who charges the least?"
- **URL:** https://feeinsight.com/guides/overdraft-fees (the other guides share the pattern).
- **Change (C5a):** Delete or source each claim. Link Reg E (12 CFR 1005.17) and Reg DD
  (12 CFR 1030) to the eCFR, and the CFPB claim to a dated CFPB source, or drop them. Replace
  advice with neutral wording ("Compare your bank's schedule with the range below"). Rename the
  heading to "Where banks and credit unions sit".
- **Change (C5b, waits on #1058):** Reword the threshold table to state position only ("At or
  below the lower quarter").

#### C6. A second index name: "National Fee Index", and a superlative.
- **Area:** brand. **Severity:** Med. **Class:** (a-copy)
- **File:** `src/app/(public)/guides/[slug]/page.tsx:365` ("Fee data from the Fee Insight National
  Fee Index"); `src/app/(public)/research/national-fee-index/page.tsx:26,28,87,388,399` ("National
  Fee Index", "The definitive national benchmark").
- **URL:** https://feeinsight.com/guides/overdraft-fees and
  https://feeinsight.com/research/national-fee-index
- **What's wrong:** The product is the Bank Fee Index. "Fee Insight National Fee Index" puts the
  company name next to a second index name, which `.agents/product-marketing.md` section 1 rules
  out. "Definitive" is an unsupported superlative.
- **Change:** Use "Bank Fee Index national benchmarks" (or "national view of the {PRODUCT_NAME}")
  and drop "definitive". Keep the URL and add no redirect.

#### C7. A guide promises a search over 8,775 institutions "we monitor".
- **Area:** copy. **Severity:** Med. **Class:** (a-copy). The fix can drop the number.
- **File:** `src/app/(public)/guides/[slug]/page.tsx:282-283` (`summary.monitoredLabel`).
- **URL:** https://feeinsight.com/guides/overdraft-fees. It says "Search the 8,775 banks and credit
  unions we monitor and see your institution's published overdraft". The homepage the same minute
  said 3,887 institutions have published fees.
- **What's wrong:** Most institutions in the 8,775 have no published fee to show.
- **Change:** "Find your bank or credit union and see its published overdraft fee", with no count,
  or with the published-fee count.

#### C8. Guides list named institutions with the highest and lowest fees.
- **Area:** copy, neutrality. **Severity:** Med. **Class:** (a-copy) to remove; (b) if kept, after
  re-verification.
- **File:** `src/app/(public)/guides/[slug]/page.tsx:555-600`.
- **URL:** https://feeinsight.com/guides/overdraft-fees shows "Highest Overdraft (OD) Fees", naming
  five institutions at $50.00. One name is cased "Pwc Employees Federal Credit Union".
- **What's wrong:** Policy is to stay neutral toward every bank and to name markets, not
  institutions, outside a buyer's own report. Each $50.00 row would also need
  `checkFeeAgainstSource` before it is shown.
- **Change:** Remove the highest and lowest lists. Keep the distribution chart.

#### C9. Methodology and pricing make unsourced process claims that also disagree with each other.
- **Area:** copy, editorial policy. **Severity:** High. **Class:** (a-copy)
- **File and URL:**
  - `src/app/(public)/methodology/page.tsx:92` ("Coverage is skewed toward institutions with assets
    above $100 million … below $50 million …"): no source.
  - `methodology/page.tsx:104` ("Institutions whose fees change often are rechecked more often.
    Every schedule is rechecked at least quarterly."), repeated at
    `src/app/subscribe/pricing-sections.tsx:92` and `src/app/for-institutions/compare-table.tsx:52`.
    The state page says "coverage … growing monthly" and "Coverage grows with every monthly pass"
    (`src/app/(public)/research/state/[code]/state-exhibits.tsx:60,201,320`).
  - `methodology/page.tsx:162` ("Our data reflects disclosed rates, which are the standard of
    comparison for regulatory purposes"): a regulatory claim with no source.
  - `methodology/page.tsx:171` ("designed to comply with the terms of service of the financial
    institutions we monitor"): a legal claim James should approve.
  - Shown at https://feeinsight.com/methodology, https://feeinsight.com/subscribe,
    https://feeinsight.com/for-institutions and https://feeinsight.com/research/state/WA.
- **What's wrong:** CLAUDE.md says never to state a result that isn't known. Nothing in this
  review checked the recheck cadence against `source_collection_runs`.
- **Change:** Run a read-only query for the actual recheck age distribution. State only what it
  shows, with one wording across the four pages. Drop the asset-size sentence unless a query backs
  it. Remove or source the regulatory and ToS sentences.

#### C10. `/for-institutions`: an unsourced speed claim and an offer missing from the offer table.
- **Area:** copy. **Severity:** Med. **Class:** (a-copy)
- **File:** `src/app/for-institutions/page.tsx:128` ("Annual pricing studies in hours, not
  months"); `page.tsx:181` ("Fee Insight Advisory is the bespoke tier …"). Advisory also appears on
  `/subscribe`, `/contact` and `/about`.
- **URL:** https://feeinsight.com/for-institutions
- **What's wrong:** "Hours, not months" has no source. "Fee Insight Advisory" is not one of the
  offers in `.agents/product-marketing.md` section 4.
- **Change:** Cut the time claim, or replace it with what the buyer gets ("a current comparison
  instead of last year's survey"). Ask James to confirm Advisory as an offer, then add it to the
  offer table or remove it.

#### C11. `/reports`: an empty-research section, a promise the steps don't keep, and a weak title.
- **Area:** copy. **Severity:** Med. **Class:** (a-copy). The title change is SERP-only (a).
- **File:** `src/app/(public)/reports/page.tsx:431` ("No national or peer reports are published
  yet …"); `:317` ("Three steps, and you don't lift a finger after the first."); `:31` (title "Fee
  Reports"); `:58` ("The revenue lens").
- **URL:** https://feeinsight.com/reports
- **What's wrong:** The sales page shows an empty section that leads with a limitation, which
  `.agents/product-marketing.md` section 6 rules out. Step 3 and the request copy say the buyer
  confirms the peer set and agrees a quote, so "you don't lift a finger" is not true.
- **Change:** Hide the research section when it is empty. Use "Three steps: tell us who you are, we
  confirm your peers and quote, you get the PDF". Title: "Competitive Fee Position Report for Banks
  and Credit Unions". Use plain names for the six sections ("Fee income context").

#### C12. State page: scraped Beige Book boilerplate, and "cheaper"/"pricier" axis words.
- **Area:** copy. **Severity:** Low. **Class:** (a-copy)
- **File:** `src/app/(public)/research/state/[code]/economy-exhibit.tsx:238-242` renders
  `bb.summary` and `bb.banking.text` raw. Axis labels at `state-exhibits.tsx:262` and
  `src/app/(public)/research/exhibits.tsx:121`.
- **URL:** https://feeinsight.com/research/state/WA shows "For more information about District
  economic conditions visit: https://www.frbsf.org/… . Back to Top Last Update: September 02, 2026"
  inside the expanded text, and "← cheaper … pricier →".
- **Change:** Strip the trailing boilerplate (text after "For more information", "Back to Top",
  "Last Update") when the text is stored or rendered. Use "lower" and "higher" on the axes, as
  `.agents/product-marketing.md` section 6 asks. Also reword "what switching charter would
  typically save or cost" to neutral wording.

#### C13. City names in all capitals or cut short.
- **Area:** copy, data hygiene. **Severity:** Low. **Class:** (a-copy)
- **File:** `src/app/(public)/research/state/[code]/state-exhibits.tsx:357` renders `c.city` raw.
- **URL:** https://feeinsight.com/research/state/WA lists "LONGVIEW". The sitemap has
  `/fees/city/co/colorado%20spring`, a city stored cut short.
- **Change:** Title-case the city in the display. File a data issue for cut-short city names in
  `institution_sources.city`.

#### C14. City pages compare a city mean with the national median, and show figures from one institution.
- **Area:** copy and statistics. **Severity:** High. **Class:** (b)
- **File:** `src/lib/data-store/city-fee-aggregation.ts:43-47` (a field named `median` holds
  `sum / count`, a mean); `src/app/(public)/fees/city/[state]/[city]/page.tsx:76-87,141-150,226,234,241-270`
  (no minimum institution count; "Avg" against "National" median; red and green value colors at
  144 and 262). Also at `geographic.ts:192-195`, the Overdraft column uses `MAX` while the other
  columns use a median.
- **URL:** https://feeinsight.com/fees/city/wa/seattle shows "Minimum Balance $3.00 … −55.4% … 1",
  "OD Protection Transfer $0.00 … −100.0% … 1", and the spotlight "Overdraft (OD) $31.00 +3.3% vs
  national, 2 institutions reporting".
- **What's wrong:** `/methodology` says categories with fewer than 5 institutions are "shown but not
  used for medians". The editorial policy's statistics contract asks for the same threshold. The
  comparison also mixes a mean with a median.
- **Change (after #1058):** Use the shared fee-stats median with `MIN_INSTITUTIONS_FOR_MEDIAN`.
  Hide rows below the threshold. Label the column "Median". Use neutral colors.

#### C15. Coverage counts disagree across pages at the same moment.
- **Area:** copy, data consistency. **Severity:** Med. **Class:** (b)
- **Read live at about 02:22 to 02:27 UTC:**
  - `/`, `/for-institutions`, `/methodology`, `/about`, `/subscribe`: "3,887 institutions".
  - `/reports`: "3,874 institutions with verified fees … 76,128 fee lines"
    (`src/app/(public)/reports/page.tsx:365-373`).
  - `/about` and `/research/national-fee-index`: "76,250" fees. The national index page also shows
    "Observations 75,106" on the same page (`national-fee-index/page.tsx:69,188-197`).
  - `/for-institutions` labels 3,887 "with verified fees". The homepage labels it "with published
    fees".
- **Change:** Use one snapshot (`getPublicSnapshot`) everywhere. Where a different definition is
  intended, label it.

#### C16. Two different "all consumer prices" figures for the same month.
- **Area:** copy, third-party data. **Severity:** Med. **Class:** (a-copy). A CPI figure is not a
  fee benchmark.
- **File:** `src/app/(public)/research/national-fee-index/page.tsx:153-163` against
  `src/app/(public)/research/state/[code]/economy-exhibit.tsx:131-141`.
- **URL:** https://feeinsight.com/research/national-fee-index shows "Overall CPI +3.7% YoY … BLS as of
  Aug 2026". https://feeinsight.com/research/state/WA shows "+3.4% for all consumer prices, 12 months
  to Aug 2026". Both show bank services at −1.4%.
- **What's wrong:** Likely cause, not verified: the national page takes the latest all-items reading
  but labels it with the bank-services month. The state page aligns the two dates.
- **Change:** Use the state page's date-aligned `yoyAt` on the national page. Show the month of
  each series.

#### C17. The public sample report leads with a probably misread overdraft fee.
- **Area:** accuracy, copy. **Severity:** High. **Class:** (b)
- **File:** `src/lib/custom-report/sample-report.ts:83` (`loadSampleReport`); the excerpt on
  `/for-institutions` comes from `src/app/for-institutions/report-offer.tsx:46,62-79`.
- **URL:** https://feeinsight.com/reports/sample-competitive-fee-position says "Your overdraft (per
  item) fee ($7) is below the local range: the median is $29". Its own source note says the $7
  comes from "Overdraft Fee on item under $5 | $7".
  https://feeinsight.com/for-institutions repeats "Overdraft (per item) $7 $29 Below local range".
- **What's wrong:** This looks like a small-item variant rather than the standard per-item fee. The
  page's method says the standard consumer version is used, and the highest amount for every fee
  other than monthly maintenance. Nothing here confirms the schedule's standard overdraft amount,
  and this is the first finding a buyer reads. The sample also names a real bank on a public page.
  `.agents/product-marketing.md` section 6 puts named institutions inside a buyer's own report.
- **Change:** Run `checkFeeAgainstSource` (`src/lib/custom-report/source-check.ts`) on this line and
  have a person check it. Then filter conditional-variant lines ("on item under $X") out of report
  selection, or choose another sample market. Ask James whether a real named bank should be the
  public sample. Related: #1066.

#### C18. Institution pages show cut-off fee names.
- **Area:** copy, data. **Severity:** Med. **Class:** (b). The rows carry benchmark comparisons.
- **File:** fee names come from the catalog and are rendered by
  `src/app/(public)/institution/[id]/fee-schedule-table.tsx`.
- **URL:** https://feeinsight.com/institution/1 shows "Chase Mobile to send a wire from your account
  to", "Counter Check: A blank page of 3 personal", "OVERDRAFT FEE", and five "Monthly Service Fee"
  rows (see #1060).
- **Change:** Fall back to the category's display name when the stored fee name is a sentence
  fragment. File the root cause with Rosetta and Knox.

#### C19. The guides hub promises "Free, and always will be."
- **Area:** copy. **Severity:** Low. **Class:** (a-copy)
- **File:** `src/app/(public)/guides/page.tsx:31`.
- **URL:** https://feeinsight.com/guides (meta description).
- **What's wrong:** Pricing promises are James's decision (`.agents/product-marketing.md` section 8).
- **Change:** Drop the sentence.

### Site structure

#### S1. Three overlapping "buy" pages, and no nav entry for the paid report.
- **Area:** information architecture. **Severity:** High. **Class:** (a-copy)
- **What exists:**
  - `/for-institutions` is the audience hub. It holds the free-report form at `#report`, the
    Hamilton views, a compare table and Advisory.
  - `/reports` is the actual Competitive Fee Position Report page. It has its own request form at
    `#request`, the state grid and the empty research list.
  - `/subscribe`, labeled "Pricing" in the nav (`src/components/nav-items.ts:20`), is Hamilton Pro
    pricing. The report appears under "Not ready for a subscription?".
- **URLs:** the three pages above.
- **Change:**
  - Make `/reports` the single home of the report, with one request form.
  - Add "Reports" to the nav (T13b).
  - Make `/for-institutions` a hub that sends to `/reports` (report) and `/subscribe` (Pro).
  - On the Pricing page, show the report and Pro side by side, above the fold.

#### S2. National medians repeat on four pages.
- **Area:** structure, keyword overlap. **Severity:** Low. **Class:** (a-copy)
- **URL:** `/` ("What banks charge"), `/fees`, `/research` ("What banks and credit unions actually
  charge"), `/research/national-fee-index` (a gated preview).
- **Change:** Make `/fees` the topic page for "average bank fees" and `/research/national-fee-index`
  the dataset or download page. Trim the homepage and `/research` to a summary that links to
  `/fees`.

#### S3. Each state has two hubs, and the city directories are never noindexed.
- **Area:** thin and duplicate pages. **Severity:** Low. **Class:** (a). The robots rule is PURE
  TECH; the description edit is (a-copy).
- **File:** `src/app/(public)/fees/city/[state]/page.tsx:14-28` sets no robots threshold. The
  sitemap lists all 51 at `src/app/sitemap.ts:224-226`.
- **URL:** for example https://feeinsight.com/fees/city/wa next to
  https://feeinsight.com/research/state/WA. Its description promises "Find banks and credit unions
  with lower fees in your area".
- **Change:** Noindex directories with no indexable city (matching `MIN_INDEXABLE_CITY_INSTITUTIONS`),
  or fold the city list into the state report. Make the description neutral.

#### S4. Pages a buyer would look for are missing.
- **Area:** structure. **Severity:** Low. **Class:** (a-copy)
- **What's missing:**
  - "How we choose your peers" (the sample's "Sources and method" text, as its own page).
  - A report FAQ (A2).
  - Use-case pages ("overdraft fee benchmarking for credit unions", "fee study for the pricing
    committee") in the buyer's search terms from `.agents/product-marketing.md` section 1.
  - No testimonials or logos exist, and none should be implied.

### Buyer path (land, then request a report)

#### P1. "Request your report" opens the free report, and the paid option looks disabled.
- **Area:** CRO. **Severity:** High. **Class:** (a). The href and styling change; no wording
  changes.
- **File:** `src/components/nav-items.ts:25` (`/for-institutions#report`);
  `src/app/for-institutions/request-report-form.tsx:86-92` (defaults to `"national"`), `:53-56`
  (paid option listed third), `:266-296` (paid option drawn with a dashed border, muted text and a
  `Lock` icon). The correct link already exists as `INSTITUTION_REPORT_HREF` at line 26.
- **URL:** the nav pill on every public page, for example https://feeinsight.com/
- **Change:** Point the nav pill at `/for-institutions?report=institution#report`, or at
  `/reports#request` once S1 lands. Remove the lock icon and the dashed, muted style from the paid
  option. It is purchasable, not locked.

#### P2. Three different request entry points.
- **Area:** CRO. **Severity:** Med. **Class:** (a-copy)
- **What exists:** the `/for-institutions#report` form, the `/reports#request` form
  (`src/app/(public)/reports/page.tsx:36,335`), and `/contact`'s "Competitive Fee Position Report
  (from $300)" inquiry type.
- **Change:** Keep one form, and link to it from every CTA. `/contact` stays for questions.

#### P3. The free report leads every pitch, and the paid report comes second.
- **Area:** CRO, copy. **Severity:** Med. **Class:** (a-copy)
- **What happens:** On `/`, `/for-institutions` and the bank offer, the copy says "Start with a free
  national or Fed district report". The primary button is "Get a free fee report"
  (`REPORT_OFFER.ctaLabel`). For the ~$300 buyer, the institution report is always the second or
  third choice.
- **Change:** On `/reports` and `/for-institutions`, make "Request your institution report"
  (`REPORT_OFFER.institutionCtaLabel`) the primary button, and the free report the secondary link.
  Keep the homepage dual-audience.

#### P4. What works, and should stay.
- The institution profile CTA prefills the institution
  (`/for-institutions?institution=1&name=…&src=profile#report`). It is the best entry point on the
  site.
- The request copy ("We reply within one business day with scope and price. You pay by card once
  you agree to the quote") is clear and matches `REPORT_OFFER.nextStep`.
- Pay and report links are noindexed and blocked in robots.txt.

---

## Ordered build list

One issue and one PR per line. Items 1 to 7 are PURE TECH and can merge on green under the
standing authorization. Items 8 to 15 are customer-facing (a-copy): open each with a copy-review
note, do not merge, and list it for James to check on the Vercel preview. Items 16 to 20 wait on
#1058.

**(a) safe now: pure technical SEO, no visible wording change**
1. **P1:** point the nav "Request your report" at the institution option, and remove the
   lock/disabled styling on the paid option. This is the highest-value fix. If the styling change
   counts as visible, ship it as a preview PR instead.
2. **T1 + T2 + T10:** sitemap dedupe, explicit city canonical, real `lastmod`.
3. **T3:** move the Material Symbols stylesheet to the `/pro` layout.
4. **T7 + T6:** noindex gated research pages and `/guides/pro/*` while gated; return a real 404 for
   missing institution, district and city pages.
5. **T8 + T9 + T11:** `og:url`, shorter titles and descriptions (SERP-only), schema fixes
   (`WebPage` and `about` on institution pages, `Dataset` on data pages, `Article` dates).
6. **T12 + T13a:** `llms.txt` (fix `/districts`, add the report, sample, Hamilton, contact);
   homepage map links to `/research/state/XX`.
7. **T4 + T5 (measure first):** TTFB check, then static or ISR for marketing pages; one request
   form per page; unique IDs. Related: #1153.

**(a-copy) safe now: visible copy with no benchmark number, preview for James**
8. **C4:** remove the live fee-change panel from `/subscribe`; reword the alert CTAs (no "raises").
9. **C2 + C3:** remove the Hamilton picker and "Powered by FeeInsight.com" from the homepage hero.
10. **S1 + T13b + P2 + P3:** `/reports` becomes the report's home with one form; add "Reports" to
    the nav and footer; Pricing shows the report next to Pro; fix the footer labels.
11. **C5a + C7 + C8 + C6 + C19:** guide copy (unsourced claims, regulation links, advice, the
    8,775 promise, highest/lowest lists, the "National Fee Index" name, "always free").
12. **C9:** methodology and cadence claims. Needs one read-only query on recheck age first.
13. **C10 + C11 + A2:** `/for-institutions` and `/reports` copy, plus a report FAQ.
14. **C12 + C13 + C16:** Beige Book boilerplate, neutral axis words, city casing, CPI date alignment.
15. **C1:** Foundation docs PR aligning `.agents/product-marketing.md` with DECISIONS.md, and one
    price label everywhere. **S2–S4** (consolidate the national-median pages, state-hub overlap, new
    buyer pages) come after 10.

**(b) waits on #1058: shows or changes a benchmark number**
16. **C17:** verify the sample report's $7 overdraft line with `checkFeeAgainstSource`; exclude
    conditional variants; decide on a named public sample.
17. **C14:** city pages move to the shared median with the minimum institution threshold.
18. **C15:** one coverage snapshot across pages.
19. **C18:** fee-name fallback on institution pages (and the Rosetta/Knox root cause).
20. **C5b:** reword the guide threshold tables.

Overlaps with open issues: #1153 (T4), #1060 and #1062 (C18), #1066 (C17), #1132 (asterisk
surfaces, related to C14 and C15), #1043 (institution indexing policy, related to T7 and T9).

## Issues

One issue per build-list line, each a sub-issue of #1134: item 1 is #1162, item 2 #1163, and so on
through item 20, #1181. Items 1–7 are #1162–#1168, items 8–15 are #1169–#1176, and items 16–20
(after #1058) are #1177–#1181.
