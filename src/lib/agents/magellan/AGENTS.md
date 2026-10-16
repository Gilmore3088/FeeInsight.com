# Magellan Agent Guide

Magellan owns institution source discovery and source fetching.

## Authority

- Magellan reads `institution_sources`, source submissions, discovery attempts, and source/fetch queue state.
- Magellan writes discovery/fetch evidence and `source_documents`.
- Magellan may record fetch failures, backoff state, source quality, and source-needed reasons.
- Magellan must not extract fee rows or publish conclusions.

## Required Behavior

- Prefer deterministic fetch and source classification before any provider-assisted work.
- Preserve source URL, document path/key, content hash, status code, and institution ID lineage.
- One stored document per (institution, content hash). Content matching the latest copy
  is `unchanged`; content matching an older copy (A, B, A) reuses that document
  (`reused_documents`) instead of inserting a new row. Older duplicates carry
  `duplicate_of_id`, and a unique partial index enforces the rule.
- One current document per page (institution, `document_url`). The copy a fetch stores or
  confirms is current; the page's other successful copies get `superseded_by_id` pointing at
  it (`current-copy.ts`). Current = `status = 'success' AND duplicate_of_id IS NULL AND
  superseded_by_id IS NULL`. Failed fetches never supersede a good copy, nor does a copy Rosetta
  read as a bot check, script shell or bare title (a thin copy, `restoreReadableCopies`);
  nothing is deleted.
  A page is matched by its normalized address (host without www or port, path without trailing
  slash or `#fragment`, query kept; `SAME_PAGE_SUPERSEDE_LIVE`, on since 7 Oct 2026). Each fetch
  step also backfills pages already stored under two spellings (`supersedeSamePageCopies`,
  logged as `magellan.same_page_copies`); a thin copy never takes a readable copy's place.
  A hand-found schedule that moved to a new path on the same host (same file name, bank's current
  `OPERATOR_SCHEDULES` link) supersedes the old link's copy the same way
  (`supersedeMovedHandFoundCopies`, logged as `magellan.moved_hand_found_copies`).
  Superseding moves no fee by itself: Hamilton's refresh moves a live fee to the current copy
  when that copy reads the same line, and nothing is taken down because a spelling changed.
- Treat accepted source submissions as validation-ready or manual-validation-needed when automation is stopped.
- Avoid repeatedly selecting the same failed source without a changed input, backoff expiry, or operator action.
- A fee link found after the bank's last fetch (`rescue_status = 'rescued'` and
  `last_rescue_attempt_at > last_crawl_at`) is fetched first, regardless of the retry
  window. The state's hourly backlog run (`new_links_only`) fetches those links and any
  link last fetched over 30 days ago (`MAGELLAN_STALE_LINK_REFETCH_DAYS`), so a link found
  mid-month is read the same hour and no schedule goes months without a fetch.
- A fetch that finds the link gone (HTTP 404/410, or a deep link whose redirects end on a
  homepage) clears the fee link, records the URL in `rejected_source_urls`, and marks the bank
  `rescue_status = 'pending'` (`failure_reason = 'magellan_dead_link'`) so discovery searches it
  again. A locked correction is kept; a 403 is retried, since a bot block can pass.
- Schedules found by hand (`operator-schedules.ts`, strategy `discover.operator_schedule`): a
  checked-in list of consumer fee schedules James gave for banks Magellan had not found (Chase,
  Citi). Just before companion fetch, each listed schedule the bank does not hold yet is added
  as a `consumer_supplement` companion, once, with an attempt row. Add a bank by adding a line.
- Companion fetch (`companion-fetch.ts`, strategy `fetch.companion`): at the end of every
  fetch step (60 s budget, 10 pages), companion pages from `institution_additional_sources`
  (not `business`) are downloaded when new and again after 30 days, each as its own source
  document with `companion_source_id` set. It never touches the bank's fee link, fetch
  state or profile, and its attempts stay out of the playbook. Two 404/410s in a row, or
  five failures, retire a page (`rejected`). Before fetching, it re-applies today's finder
  rules to the state's stored pages (`reviewStoredCompanions`, up to 500): a page now ruled
  out (loan, HELOC, derivatives notice) is retired with reason `not_consumer_fee_page`, and
  a page named after its link text ("Download", "Product Details") is renamed from its URL.
- The free `discover` step runs in every hourly backlog run, not only the full pass, while
  the state has a bank due a free search; discovery's own backoff decides who is due. The
  paid find (`discover-paid`) stays on the full pass.

## Discovery (the find team)

The `discover` step (`discovery.ts`) searches banks with a website but no fee link.
The state's market leaders (top 15 by deposits or fee income, `loadMarketLeaderIds`) and the
top 100 market gaps (banks with no live fees whose fees would add the most competitor coverage
across every bank's branch counties, `loadMarketGapIds` in `src/lib/data-store/competitor-coverage.ts`)
go first among banks due, after corrections.
For one bank it first repairs the stored website (`website-repair.ts`, below), reads the
homepage once, then calls the specialists in `finders.ts` in order and stops at the first
link that passes the fee-page check. Each specialist
that runs writes one `pipeline_attempts` row (stage `discover`, its own strategy and
version, a typed outcome, the URLs it tried with their verdicts in `detail.trail`,
and `detail.method_version`).

| Pass | Strategy | What it tries |
| --- | --- | --- |
| 1 | `discover.rejected_page_links` | Fee links on pages Rosetta ruled out (newest two), boosted because the page is about fees. Runs before the homepage is read, so a bot-blocking homepage does not stop it; off-site PDFs (CDNs) count. |
| 1 | `discover.known_link` | The bank's previous (unlocked) link. A locked correction is used as is, without a fetch. |
| 1 | `discover.homepage_links` | Fee-like links on the homepage (homepage request logged here). |
| 1 | `discover.sitemap` | robots.txt `Sitemap:` entries, else `/sitemap.xml`, then `/sitemap_index.xml`; an index opens its page/document children. robots.txt Disallow rules for FeeInsightBot are respected for every same-site request. Fee links and PDFs whose name says fee, schedule, disclosure or truth-in-savings are opened (version 2). |
| 1 | `discover.hub_pages` | One hop through Disclosures / Rates & Fees / Documents / Forms pages. |
| 1 | `discover.platform_paths` | Version 2. Paths for the detected platform (`platform-learning.ts`): the registry's seeds plus paths that are the fee link at 2+ banks, each bank's link scored by the outcome ledger (good +2, not judged +1, thin -1, rejected or dead -2). Judged companion schedules (`consumer_supplement`: paid-search, companion-finder and hand-added pages) count the same way, so a page a person adds teaches the free finders and a wrong one counts against its path. A seed whose links keep failing drops out. |
| 1 | `discover.common_paths` | Guessed common paths, last. |
| 2 | `discover.peer_hint` | Version 2. Reusable paths that produced live fees for a bank on the same platform anywhere in the country, not yet in the platform list, most live fees first. (Version 1 copied same-state peers' paths; 205 of 237 tries were 404s.) |
| 2 | `discover.site_crawl` | Same-host crawl, at most 40 requests, one at a time with a pause, robots.txt Disallow rules for FeeInsightBot respected, negative links skipped. |
| 2 | `discover.second_document` | `second-document.ts` (version 4, the companion finder), after the main loop, in the last 25 s each step keeps for it (`COMPANION_RESERVE_MS`; banks stop starting at 50 s): two of each step's six slots go first to a state top-10 bank from any state with no live overdraft fee (`LEADER_SLOTS`); then banks with fewer than 8 published fee categories (none counts), an HTML fee link and no monthly fee, no live monthly maintenance or overdraft item fee (often in a separate account disclosure), or a link that is not the consumer schedule yet (link coverage), get a search of the homepage, the fee page, up to 3 hub pages and the site's own search. Every deposit-account page that lists at least 3 fee lines (`ACCOUNT_PAGE_MIN_FEE_LINES`; pages with 1 or 2 gave live fees about 1 time in 10 on prod) (named after its account, e.g. "Freedom Checking"), every fee document (schedule, disclosure, courtesy pay policy, opaque `/assets/files/` PDFs; checked by the shared fee-page check) and every account, member, membership or deposit agreement (or terms and conditions) whose text lists at least 2 fee lines with a dollar amount (`AGREEMENT_MIN_FEE_LINES`) (role `consumer_supplement`, PDFs read up to 12 pages, at most 3 checked) is stored in `institution_additional_sources`, up to 8 per bank. When the fee link or a hub page is a disclosures index (its address names disclosures, agreements, documents, forms or legal) and links to at least 2 documents (`INDEX_MIN_DOCUMENT_LINKS`), up to 4 of those documents whose link text names no fee (`INDEX_DOCUMENTS_CHECKED`; "Download", "Consumer Information") are checked too, after the named fee documents, by the same fee-page check (version 4, #1051: Jonesboro State Bank's link is its `/agreements-and-disclosures` page). Privacy, loan, business and rates documents are still skipped; the attempt's `index_documents_checked` counts them, and hidden banks whose link is such a page go first after requesters and $10B+ banks. Business, loan, HELOC and line-of-credit pages are skipped, and, while searching, brokerage, investment, wealth and trust-and-investment links with no deposit word (#1442: `brokerageLinkText` and the shared `nonDepositDocumentKind` in `src/lib/non-deposit-document.ts`, which Darwin's live re-check also reads). The stored-companion review (`isNonDepositLink`) keeps its pre-#1442 words, since a companion it retires has its live fees rolled back by Hamilton with no switch; fees already live from such pages are Darwin's switched re-check's, and so are funds-availability notices, overdraft opt-in forms, Zelle terms, rates pages, calculators and join pages. Never replaces the fee link. Each bank at most monthly. Report requesters (`leads.quote_institution_id`) and $10B+ banks go first, then links that are not the schedule, then banks of 8+ categories missing maintenance or overdraft, then the fewest categories. Slots the state's own banks leave free go to hidden banks (fewer than 3 live categories, link a product page or no overdraft price) from any state, in the same order, so a state lane that has checked all its banks this month still works on the 3-fee-rule backlog. |
| 2 | `discover.site_search` | Inside the companion finder: the bank's own site search (a GET search form on its homepage), at most 4 result pages per bank per run. "fee schedule" always runs; the other 3 rotate each recheck window through "account agreement", "schedule of fees", "member agreement", "truth in savings", "deposit agreement", "membership agreement". One attempt row per query (`detail.query`, `candidates`, `kept`; not folded into the playbook): `ok` when a page it found was kept, `rejected` when its hits were all dropped, `no_candidates` when it linked to nothing useful. |
| 3 | `discover.paid_pick` | `paid-find.ts`: one model call, no tools, picks up to 3 of the homepage's links; each pick passes the fee-page check. Off with `MAGELLAN_PAID_PICK=off`. |
| 3 | `discover.paid_web_search` | `paid-find.ts`, the `discover-paid` provider step (below); runs only when the pick found nothing, then waits out the paid cooldown (90 days after a find, 30 after a miss; `cooldowns.ts`). |

- Fee-page check (`find-validate.ts`), shared by every finder and the paid pass: HTML
  must pass `scoreFeePage` and not be a rates page; PDFs are downloaded (up to 8 MB)
  and their first pages read, so a rate sheet or press release is rejected. A PDF with
  no readable text (a scan) is accepted only on a strong fee label. Fee words are counted
  on the page's own content (menus, header and footer stripped). Below the fee-page bar
  (3 fee lines) HTML passes only when its address names the fee page, or its label is
  strong and it lists a fee; an account or product page (`looksLikeProductPage`, the shared
  `isProductPageUrl` rule in `learning/fee-page.ts`) is rejected as `product_page` and belongs
  to the companion finder as an account page. Since #1053 (fee-page check v2) a product
  address is rejected even above the bar unless it lists 10+ fee lines or a schedule title.
  Since #1033 two more checks run in it. An address naming a CRA file, annual report,
  newsletter, achievements piece or flyer, and no fee, schedule or charge, is rejected as
  `non_fee_document` without downloading (`isNonFeeDocumentLink`; brochures pass, since several
  are the bank's fee list). When the finder passes the bank's website (the crawl and the companion
  finder do), an accepted document on another host must name the bank's website or name, or it
  is rejected as `unconfirmed_host` (`unconfirmedDocumentHost` in `other-bank-host.ts`; since #1287
  stricter than Hamilton's `unconfirmed_document_host` takedown, which keeps the older rule). See
  `docs/project/findings/2026-10-12-wrong-host-documents.md`. Since #1287 the website, its name
  and the bank's name must appear as whole words ("t bank" is not in "first bank"); a name
  another institution has (`loadSharedNameIds`: "Peoples Bank", "First National Bank") counts
  only with the bank's city or FDIC certificate / NCUA charter number in the text. Since #1309
  a name is also shared when it sits as whole words inside another institution's name
  ("American National Bank" in "First American National Bank"); the number counts only right
  after "FDIC", "Cert", "Certificate", "Charter" or "NCUA", so "$175.00" is not cert 175; when
  the names cannot be read, every bank in the step is treated as shared and the run gets a
  `magellan.shared_names_unread` event; and the companion finder runs the same check. Since #1320
  "X Credit Union" is shared when "X Federal Credit Union" exists (either way round); a bare
  "FDIC" or "NCUA" needs "#", "No." or "Number" before the number ("Member FDIC 175 Main Street"
  is not cert 175), and a number followed by "-day" or the rest of a phone number never counts. A host
  with the website's name is trusted unread only when that name has 6+ characters
  (`SAME_NAME_MIN_CHARS`), so fnb.bank is read for fnb.com. The institution record holds no
  former names, so a renamed bank's new host still needs its current name in the text.
  A business-only schedule (its address or its own heading names business/commercial and
  nothing names personal or consumer accounts) is rejected as `business_schedule`.
- A found link on another institution's own website (`other-bank-host.ts`: its host is another
  bank's `website_url` host and not this bank's) is never saved. The search is recorded as
  `retry_after` with code `other_bank_host`, and the link joins the bank's rejected sources.
  Peoples Bank of Rock Valley IA had been given Peoples Bank of Bellingham WA's PDF (Oct 8).
- Link coverage (`link-coverage.ts`), one shared rule for "is the stored page the
  consumer fee schedule?": not when the link is business-only, when none of the bank's
  stored texts prices an overdraft or NSF item (`hasOverdraftPrice`: the word, then $10+
  on the same line, not a threshold or limit), or when its text sends the reader to the
  account agreement or another document (`refersElsewhere`), or when its current copy's
  address is dated three or more years back (`isStaleDatedLink`, e.g. a 2019 PDF). Such a bank keeps its link
  and live fees; the companion finder and the paid schedule search keep looking.
- Business-only search (`BUSINESS_SEARCH_VERSION`): before the upgrade searches, banks
  whose link is a business-only schedule are searched once per version for the consumer
  schedule (`detail.business_search`). A find replaces the link and keeps the old one as a
  `business` companion; a miss leaves the link alone, and the paid schedule search then
  takes the bank. Each step keeps `BUSINESS_RESERVED_SLOTS` (3) for these banks even when
  banks without a link fill it.
- Reserved slots: each step searches, right after the cut-off bank resuming its search,
  up to `BUSINESS_RESERVED_SLOTS` (3) business-only links, `UPGRADE_RESERVED_SLOTS` (3)
  product-page links and `FRESHNESS_RESERVED_SLOTS` (2) out-of-date links, then banks
  without a link, then more of each in spare capacity. In spare capacity alone a state
  with many banks without a link never reached them.
- A bank whose latest document answered 404 or 410 and has no live fee is due for a
  search at once, not after the 30-day stale-link wait.
- A state step with slots left over fills them with banks in other states that no finder
  has ever searched (no `discover` attempt), largest first, so a state whose lane runs
  rarely does not hold its never-searched banks back.
- Upgrade search (`UPGRADE_SEARCH_VERSION`): banks whose fee
  link is a product page are searched once per version for the real schedule
  (`detail.upgrade_search`). A find replaces the link and keeps the old page as a
  companion `account_page`; a miss leaves the link and rescue state untouched.
  A re-search (upgrade, business or freshness) never accepts the link it is replacing, from
  the known-link, hub, crawl or any other finder; the page can still be opened as a hub for
  its links (v3, #1326: under v2, 1,406 of 1,745 searches stopped at the product page, the
  known-link finder in 1,247 of its 1,428 finds and the site crawl in 148 of 182).
  Links to an article, blog post, news item or press release (`isArticleLink`, unless the
  path names a fee document such as "/articles/schedule-of-fees/") go to the same search,
  and a find does not keep the article as a companion. Every finder rejects such a
  candidate (`article_page`) before opening it. Links to one deposit product's disclosure
  (`isSingleProductDisclosureLink`: a CD, share certificate or time deposit truth-in-savings
  sheet, unless the name also says fee schedule) are handled the same way
  (`single_product_disclosure`): they state a rate and an early-withdrawal penalty, not the
  account fees.
  A link on another kind of site (`isOtherSiteLink`: a government page, a broker's disclosures,
  a car-price site) is searched the same way and never kept as a companion, unless that host
  is the bank's own website (GSA FCU on gsafcu.gsa.gov).
- Restored fee pages (`restore-fee-page.ts`, `RESTORE_FEE_PAGE_VERSION`): a bank whose page
  named as the fee schedule (`namesFeeSchedulePage`) was set aside by Rosetta for reading no
  amounts or needing JavaScript, and whose link is now a weaker page (not fee-named, not a
  PDF, no live fee, so no live fee depends on the swap), gets the fee page back
  as its main link, up to 25 per step after the companion search. The weaker page stays as a
  companion `account_page` (not an article or a product disclosure). Each bank is checked
  once per version (`discover`/`restore_fee_page` attempt, `ok` or `unchanged` with the
  reason kept); the step's `restored_fee_pages` detail lists the swaps. Rosetta's readers
  (embedded data, linked and embedded PDF viewers) decide whether it now reads.
- Refused paid answers (`refused-answers.ts`, `KEEP_REFUSED_ANSWER_STRATEGY`): a paid web
  search or paid schedule search answer whose fee-page check got HTTP 403 is kept once, free,
  up to 25 per discover step in any state: as the main link when the bank has none, else as a
  `consumer_supplement` companion. Answers off the bank's site, articles, pages it already
  holds and non-schedule pages (CRA file, About, rates page) are logged `unchanged`. Both paid
  searches now keep a 403 answer themselves; this pass recovers the ones dropped before. The
  plain fetch meets the 403 and the paid fetch (`blocked-fetch.ts`) stores the page.
- Freshness search (`FRESHNESS_SEARCH_VERSION`): after the upgrade searches, banks whose
  link looks out of date are searched once per version for a newer schedule
  (`detail.freshness_search`, with `stale_link` and `stale_reason`). Stale means the
  schedule's own "Effective ..." date (first 4,000 characters of its latest stored text),
  or without one a year in its address, is `STALE_AFTER_YEARS` (3) or more years old.
  A state's step checks the whole state; a step without a state checks only the hour's
  slot of banks (id mod 24, `stepSlot`, as the outcome ledger).
  A different page that passes the fee-page check replaces the link (the old one is not
  kept); the same page or a miss changes nothing.
- URLs in `institution_source_profiles.rejected_source_urls` (one entry per URL) are
  not proposed again for that bank for 90 days (`REJECTED_URL_TTL_DAYS`), count against
  their path in per-platform learning, and their links are searched first.
- Platforms (Q2, Banno/Jack Henry, Fiserv, FIS, NCR, WordPress, Drupal, and others)
  are detected from homepage signals (`site-signals.ts`) and stored on
  `institution_source_profiles.platform` (and `institution_sources.cms_platform` when
  empty). Platform paths are `platform_registry.fee_paths` plus reusable paths found
  at two or more banks on the platform, minus paths Rosetta rejected. A find updates
  `platform_registry` (validated count, institution count, promoted paths).
- A redirect to a new domain searches the new site and updates `website_url`.
- Website repair (`website-repair.ts`, a pure function): before the search, obvious typos in
  `website_url` are fixed: a missing dot after `www` ("wwwbank.com") or before the ending
  ("www.bankcom"), scheme typos ("http//"), uppercase, spaces, trailing punctuation and
  misspelled endings (".con"). An unfamiliar ending is flagged (`warnings`), not changed.
  A repair is saved to `website_url` by `recordDiscoveryResult` and logged as its own attempt
  (`discover.website_repair`, `detail.original/repaired/changes/saved`), except when
  `institution_source_profiles.locked_by_correction` is set: then it is used for the search
  but never saved. Adding only a scheme is not saved or logged. A website that still cannot be
  read is `needs_human` (code `website_unrepairable`, outcome `invalid_url`). There is no other
  stored website to fall back on: `registry-fdic-universe` only fills an empty `website_url`
  and the NCUA sync stores none.
- A homepage that blocks bots (HTTP 401/403, or a challenge page served with 200) does not end
  the search: the known link and the site map still run (nothing else needs the homepage).
  Nothing tries to get past the wall: same crawler name, no proxies, no browser. A find is
  code `found_blocked_homepage` (`detail.rescue = 'blocked_homepage'` on the finding attempt),
  every attempt for that bank carries `detail.homepage_blocked = true`, and the step detail
  counts `blocked_homepage_rescues` and `websites_repaired`. A 429 asks us to slow down, so
  nothing more is requested from that site that time (`blocked`).
- Nothing is dead forever: pending/`retry_after` banks are re-checked after 12 hours;
  misses (`dead`) after 30 days, then 90 days after two misses in a row; and every
  miss at once (after 12 hours) when `DISCOVERY_METHOD_VERSION` is newer than its last
  search. Bump that version whenever a specialist changes.
- A search cut short by the per-bank (45 s) or per-step budget is `retry_after`
  (`out_of_time`) and resumes where it stopped. Its last `pipeline_attempts` row carries
  `detail.resume` (`DiscoveryResume`: specialists done, the one the clock stopped inside,
  cut-off searches so far); a search that ends writes `resume: null`. The next search of
  that bank (selected when `rescue_status = 'retry_after'` and the failure note starts
  `out_of_time:`) reads the newest row with a `resume` key, skips the finished
  specialists, and logs `detail.resumed_from`. A specialist the clock stops inside twice
  on a full per-bank budget is skipped (`RESUME_MAX_CUTS_PER_FINDER`); after 12 cut-off
  searches (`RESUME_MAX_TICKS`) the bank is a miss. The first such bank in each step
  (`RESUME_FIRST_PER_STEP`) goes to the front so it gets the whole 45 s; the rest keep
  their place. A resume from another `DISCOVERY_METHOD_VERSION` is ignored. The step's
  `resumed_searches` counts resumed banks. Without the learning schema there is no
  resume, and two cut-offs make a miss as before.
- Pass 3 (`runMagellanPaidFind`): up to `PAID_PASS_ITEMS_PER_RUN` banks in the state
  that are `dead` after a search with the current method version and are off the paid
  cooldown: 90 days after a find, 30 days after a miss, counted from the try, not the
  calendar month (`FOUND_COOLDOWN_DAYS`, `MISS_COOLDOWN_DAYS` in `cooldowns.ts`, #1031).
  The escalation ladder (`escalation.ts`, #1032) picks the ask: with no paid miss since
  the last paid find, the fee schedule (rung `schedule`); after one, a Truth in Savings
  disclosure, deposit account agreement or account terms that state fees (rung
  `disclosure`). After `NOT_ONLINE_AFTER_MISSES` (2) misses on the same website the
  institution is "not published online", dated by the last miss: no pick and no search
  for `NOT_ONLINE_RETRY_DAYS` (120), then the rungs alternate again. The state comes from
  `pipeline_attempts` (no column): misses count only since the last paid find and only on
  the current website (`detail.website_url`, recorded on every paid search; older rows
  count as the current site), so a new website restarts the ladder at once, and a found
  or submitted fee link takes the institution off the paid list. Each attempt records
  `detail.rung`. The institution's admin page shows its place on the ladder and the
  methods tried; the state page and the state-expert step (`not_published_online`) count
  "not published online" by size tier. One `paidModelCall` per bank (agent `magellan`, `PAID_PASS_MODELS.find()`,
  server `web_search` tool from `web-search-tool.ts`, #1035: a bank under $10B is searched on its own
  website host only (`allowed_domains`), at most `OWN_SITE_MAX_USES` (2) searches; a $10B+ bank keeps
  the open web and 3, as the schedule search does) asks for the consumer fee schedule on the bank's
  own domain as JSON. The answer must be on the bank's domain and pass the same
  fee-page check before it is stored. Since #1251 (both paid searches): "its own website" also
  covers the bank's other own hosts (`own-hosts.ts`: a host of the bank's own stored documents that
  no other institution has documents on, that is not another institution's website or a
  subdomain or parent of one, and that has the website's name with another ending, 6+ characters,
  or is a `.bank` domain holding at least 2 of the bank's documents; machiassavings.com and
  machiassavings.bank, cashmerevalleybank.com and cvb.bank), up to 4 sites, and an answer on one
  of them passes the domain check. Both paid searches and the paid pick pass the bank's website
  and name to `validateFeeCandidate`, so an answer on any other host must name the bank (#1033's
  unconfirmed-host rule), and an answer whose host refused our check (HTTP 403) is kept unread only
  on the website's own host, a subdomain, or a host with the website's name. A bank with no asset size on
  file, or whose website host the API may refuse (an IP address, a trailing dot, no dot) or is a
  third-party host (a bot check, a social page), searches the open web. Only an open-web search is
  told about a parent company's domain. The call's usage row records `web_search_domains`, and the
  attempt records `detail.search_domains` and `detail.own_hosts`. Each try is logged with its cost. A budget cap or
  the automation stop ends the step cleanly (`budgetStopped`); the unspent bank stays due.
  $10B+ banks and requesters are picked from any state's paid step, not only their own.
  Order: the state experts' work lists (#1029, below).
- Schedule search (`schedule-search.ts`, `discover.paid_schedule_search`, version 2, #1030), in
  the same paid step, from any state, off the paid cooldown, in two lanes, the uncovered lane first:
  - **Uncovered first:** up to `SCHEDULE_SEARCH_PER_RUN` (10) institutions that hold a fee link but
    have no live fee at all, whose oldest stored copy is at least `UNCOVERED_SETTLE_DAYS` (3) old,
    with no discovery find in those days (a free #1327 re-search or any finder; the free pipeline
    reads a new link first) and no companion still waiting for its first fetch. One search asks for the fee schedule, the Truth in Savings disclosure and the deposit
    account agreement (`UNCOVERED_DOCUMENT_KINDS`); each answer that passes the checks is its own
    `consumer_supplement` companion, its kind named in the companion's reason and the attempt's
    `detail.documents`. Institutions with no fee link at all are the paid web search's
    (above, with its disclosure rung).
  - **Gap-fill, on its own cap:** up to `GAP_FILL_PER_RUN` (3) banks with live fees whose link is
    not the consumer schedule yet (link coverage). First $10B+ banks, report requesters and market
    leaders (top 15 in their state by deposits or fee income, `loadMarketLeaderIds` in
    `src/lib/data-store/market-leaders.ts`) on any gap (business-only, no overdraft price, refers
    elsewhere, stale copy, or hidden: fewer than three live categories); then other banks when
    hidden with a product-page link or no overdraft price, or with a business-only link the free
    business search missed. No gap-fill search once the lane has spent `GAP_FILL_CAP_MICROUSD`
    ($10) in `GAP_FILL_CAP_DAYS` (30), counted from attempts with `detail.lane = 'gap_fill'`,
    checked before each search.
  - **Order inside each lane** is the work lists' (#1029, #1269, below): the pools (`pool_lane`:
    uncovered, gap_priority, gap_other) are each cut at `WORK_LIST_POOL` requesters, Pro
    accounts' institutions and market leaders first, then each state x size cell's first
    institution, then its second; each lane then takes its cap requesters and Pro accounts first,
    then one per state in turn. "No live fees first" is the lane split; it never reorders a lane.
  If the ranking fails the lanes run on size and requests alone. The model (web search, site-limited
  under $10B, #1035/#1251) is told why the held page is not it; every answer must be on the bank's
  own hosts, new to the bank, and pass the fee-page check with the bank's name and the shared-name
  rule. It is stored beside the link, so companion fetch, Rosetta and Knox read it; the link and
  its live fees stay. The bank's own domain includes its corporate domain (`onBankDomain`).
- Work lists (#1029, `state-expert/work-list.ts`): the paid web search, the schedule search
  (each lane) and the website search read up to `WORK_LIST_POOL` (2,000) due institutions,
  then take their unchanged per-step cap in this order: report requesters and Pro accounts'
  own institutions first; then one institution from each state's list in turn, the state with
  the largest coverage gap under $10B first. A state's list puts its size groups furthest below
  James's target first (`coverageGroupsSql`, the scorecard's own groups; short / target), and
  within a group a website on file, then a known platform, then the larger institution.
  Institutions over $10B share one national list that takes its turn, since they are compared
  nationally, never by state. Each result entry records `work_list`, `work_group` and
  `work_group_short`. If the gaps can't be read, the lists keep size order and still rotate.
  The pool is cut in this order (#1269, `workListPoolRankSql`): requesters, Pro accounts'
  institutions (and, in the schedule search, market leaders), then each state × size group
  cell's first institution, then each cell's second, so a cut drops the deepest rows of the
  fullest cells, never a whole small-bank group. Each paid try's `pipeline_attempts.detail`
  records the same three fields, and the `discover-paid` step keeps every work-list entry
  under `work_lists` (with `tries` and `short_group_tries`), not only its 10 sample results.
- Website search (`website-find.ts`, `discover.website_search`), in the same paid step after
  the banks: up to `WEBSITE_FIND_PER_RUN` institutions in the state with no `website_url`
  and no fee link, off the paid cooldown. The model (web search) names the official homepage;
  it is saved only when it is not a directory, social, government or another institution's
  domain, and the homepage names the institution (every distinctive name word) plus its
  city or its FDIC certificate / NCUA charter number. Saving resets the bank's search
  (`rescue_status = 'pending'`) so the free finders search the new site next. Anything
  else stays for a person: `detail.candidate_url`, `needs_human: true`. A one-word stored
  name ("CALIFORNIA") is not searched. It runs at most 2 searches a call (#1035).

## Outcome ledger (`outcomes.ts`)

Every discover step judges its state's banks (a step without a state judges one 24th of
all banks, bank id mod 24 = the UTC hour; `stepSlot`) by what their links produced downstream, and writes the judgement to
the shared learning store (`pipeline_feedback`, `check_name = magellan.link_yield`,
dedupe `magellan.link_yield:doc:<first source_document_id of the link>`). A link is the
bank's main fee link or a companion page; all fetches of the same address count as one. A
companion's documents are also matched by `source_documents.companion_source_id`, since
its stored address often differs from the one fetched (http to https, a redirect).

| Label | Rule | Signal, kind, weight |
|---|---|---|
| wrong_fees | 3 or more fees read from it were taken down and a second look confirmed it (`takedown_confirmed` from the source check, limit guard or business-schedule check, no live twin), and they are at least its live fees | wrong, `confirmed_wrong_fees`, confirmed count |
| good | 3 or more distinct fees from it are live | right, `produced_live_fees`, live fee count |
| dead | last fetch 404/410, or Rosetta's last read was a 404 | wrong, `dead_link`, 1 |
| rejected | Rosetta's last read ruled it the wrong document | wrong, `wrong_document`, 1 |
| thin | Knox extracted it over 24 hours ago, fewer than 3 live fees | wrong, `thin_link`, 1 |
| business | the bank's main link is a business-only schedule (`isBusinessOnlyLink`), whatever it produced | wrong, `business_schedule`, 1 |

First-look takedowns (`not_on_schedule`, `wrong_amount`, `threshold`) never count; only the
second look's verdict does. A main link judged `wrong_fees` goes to the freshness search
(stale reason "fees read from it were confirmed wrong on a second look"), once per judgement,
first among that search's banks; the path's score in platform learning drops by 2.
Anything else (not read or extracted yet, a bot wall) is not judged yet. `about_strategy`
is the Magellan specialist whose attempt found the address (null for links the old
crawler left). Only changed judgements are written; the step's `link_outcomes` detail
reports the counts. Finders, the fee-page classifier and Darwin read these rows.

## Error review per chunk (`batch-review.ts`)

After the ledger, each discover step reviews every full chunk of `BATCH_SIZE` (50) newly
judged links, oldest first, at most 4 chunks a step. A link in the chunk is an error when
the ledger judged it wrong, when Darwin rejected at least 3 of its fees and more than it
passed, or when the bank's confirmed answer key names a different document. One
`pipeline_feedback` row per finder in the chunk (`check_name = magellan.batch_review`,
kind `batch_review`) records links, errors, error kinds, Darwin errors, answer-key matches
and up to 5 sample error links; it is `wrong` when 40% or more of that finder's links (at
least 5) were errors. A finder whose last two such reviews were both wrong runs after the
other finders (`loadDemotedFinders`, `demoteFinders`; the known link still runs first)
until a review comes back right. The step's `batch_review` detail and `finder_order.demoted`
show the result. Nothing here changes a link or a fee.

## Search-miss lessons (`search-misses.ts`)

A bank searched from scratch whose search ends `dead` or `needs_human` gets one
`pipeline_feedback` row (`check_name = magellan.search_miss`, signal `missed`, kind
`search_miss`) per discovery method version, keyed on the bank's website: where the search
stopped, how many addresses it tried, and each finder's outcome. The link ledger only
judges links Magellan handed on, so these are the lessons for banks it gave up on. The
step's `search_miss_lessons` detail counts them.

## Other spellings of an unreachable link (`address-variant-fetch.ts`)

A fee link on the bank's own site whose latest plain fetch could not reach the page
(network error, timeout or HTTP 5xx) at least `ADDRESS_VARIANT_MIN_FAILURES` (2) times in a
row is asked for at the bank's other spellings of the same address, after the fee links in
every `fetch` step (#1051): the path and query on the stored website's host and scheme, the
link's host with or without `www.`, then plain http (at most `MAX_ADDRESS_VARIANTS`, 3).
State Department FCU's `https://www.sdfcu.org/.../fees.pdf` had failed with a network error
since 3 Oct 2026 while its website is stored as `http://www.sdfcu.org`; Great Oaks Bank's link
is on the bare domain and its site on `www.`. Plain GETs with Magellan's crawler identity: no
provider and no budget, so the paid cap never holds it. Up to `ADDRESS_VARIANT_BANKS_PER_STEP`
(3) banks a step within `ADDRESS_VARIANT_BUDGET_MS` (30 s, which also cuts each request and
body read), banks with no live fees first, each at most once per `ADDRESS_VARIANT_RETRY_DAYS`
(7). The document means a 2xx whose final address after redirects is still on the bank's domain
(`onBankDomain`) and is not the homepage or an error page, whose body was read in full within
the 15 MB document cap (`MAX_DOCUMENT_BYTES`; past it the read stops, `too_large`), and, for a
PDF link, whose bytes are a PDF: a parked domain's 200 HTML page is refused (#1306). One timer
covers the headers and the body; when it fires, or the cap is passed, the request is aborted so
the download stops too. A spelling that fails any of these, including a body read that fails
after it answered, is a failed try, so it never becomes the fetch address or moves the failure count. The first
spelling that answers with the document is stored through `fetchAndRecordLink` (attempt strategy `fetch.address_variant`), which makes it the profile's fetch address; when
none answers, one attempt row lists each try and the bank's fetch state is left alone. A 403
is a bot wall on every spelling and stays with the paid fetch below; a person's locked
correction is never re-spelled. The `fetch` step's `address_variants` detail counts banks
selected, tried, recovered and failed.

## Paid fetch for refused links (`blocked-fetch.ts`)

A fee link on the bank's own site whose last plain fetch (`fetch.http`) was refused (HTTP
403), or timed out with at least `BLOCKED_TIMEOUT_MIN_FAILURES` (2) failures in a row (First
Horizon), gets one paid server-side fetch in the `discover-paid` step:
Anthropic's `web_fetch` tool, `max_uses` 1, `allowed_domains` the link's host. Up to
`BLOCKED_FETCH_PER_RUN` (6) pages a step, largest first, each at most once per
`BLOCKED_FETCH_RETRY_DAYS` (7). The page text or PDF it returns goes through the same
fetch path as any fetch (`fetchAndRecordLink`: document row, vault copy, attempt with
strategy `fetch.paid_web_fetch` and its cost), and Rosetta reads it next. A refused link on
another site is a wrong link and is left to discovery. When the paid web search's answer
is refused by the bank's site (HTTP 403), the answer is kept as the bank's link (confidence
0.75) so this fetch reads it. A budget stop ends the step before anything is spent.

The paid fetch runs first in `discover-paid`, before the paid searches: run last, it got only
what the run's provider call cap left. Companion pages blocked the same way get it too
(strategy `fetch.paid_web_fetch_companion`, stored through `fetchAndRecordCompanion`): a page
whose last companion fetch was refused, timed out twice, or was a PDF link answered with a web
page. Two of the six slots are kept for companions. A companion given by hand
(`discover.operator_schedule`) counts on a sister brand's site (Zions' schedule on amegybank.com). The companion fetch no longer stores a
PDF link answered with a web page (outcome `blocked_bot`): 53.com served Fifth Third's fee PDFs
as a "page doesn't exist" page, which Rosetta then set aside as a blank read. Copies stored that
way before the check (a set-aside PDF link whose copy is a web page) are picked as well, and a
fetched PDF puts the page back in use.

## Foreign schedules

A link on another country's domain (`isForeignHostLink`: .bd, .in, .ca, .co.uk and others;
US territories and .us are not foreign) is refused without opening it, unless it is on the
bank's own website's host (Natbank, N.A. publishes from nbc.ca). A page or PDF priced in
another currency (`looksForeignSchedule`: Tk, BDT, Rs, INR, £, € amounts outnumbering
dollar amounts, or a foreign central bank or VAT beside foreign amounts) is refused once
read, verdict `foreign_schedule`. The companion finder skips foreign-domain links. SouthEast
Bank's link led to southeastbank.com.bd and Citi's to Citi Bangladesh's schedule on
citigroup.com (7 Oct 2026).

## Fee-page classifier, in shadow (`page-classifier.ts`)

A learned check on whether an opened page is the bank's fee schedule, trained on the ledger
above: links with 3+ live fees are fee pages, thin and rejected links are not, dead links are
left out. The text is what Rosetta stored (`agent_source_texts`, first 8,000 characters). It is
a naive Bayes over word stems, address words and the rule check's own counts; no model call.
Some bank site platforms print the request they were sent at the top of the page (our user agent,
header names such as x-vercel-id): when our crawler token is on a page, that echo is dropped
before features are read (`withoutRequestEcho`, version 2).

- The discover step retrains it when the newest stored copy is 6+ hours old (up to 300 links of
  each label) and writes one row to `magellan_page_classifier`: weights, label counts and its
  score on every fifth document held out, beside the rule check on the same pages. It needs 30 of
  each label to train. The step's `page_classifier` detail reports what happened.
- SHADOW: each candidate a finder opens gets `page_p` on its trail entry (the probability it is
  a fee page). It changes no decision. Switching `mode` to deciding waits for James's review.

## Boundaries

- Do not call extraction providers from Magellan.
- Do not write `raw_fee_observations`, `verified_fee_observations`, or `published_fee_records`.
- Do not use retired crawler table names in runtime code; use semantic contracts such as `institution_sources` and `source_documents`.

## Regulatory Registry (`registry/`)

Magellan also ingests published regulator data through deterministic
`registry-<source>` steps. Each step processes exactly one partition, records it
in `registry_ingest_partitions`, and keeps lineage (`source_url`, `agent_run_id`).
Steps never call a provider and stay out of `PROVIDER_STEP_KEYS`, with one exception:
`registry-wire-research` (below) is a provider step, listed in `PROVIDER_STEP_KEYS`, so the
global provider stop and the budget caps apply to it; it is off until `REG_WIRE_SUMMARIES_LIVE=true`.
Its calls are logged and budgeted as agent `wire` (`agent:wire`: $25 a month, 30 calls and $1 a run,
James 2026-10-12, #1149), so Magellan's fetching and the Wire never spend each other's budget; they
still bill to Magellan's API key. When a cap stops it, the step summary names the cap and how many
items wait.

| Step | Partition | Writes |
| --- | --- | --- |
| `registry-fdic-universe` | `current` (weekly) | `institution_sources`: identity, holding company, regulator; adds charters, marks closed/merged inactive |
| `registry-fdic-financials` | quarter `2026Q2` | `institution_financial_records` (`fdic`, thousands, quarterly) |
| `registry-ncua-financials` | quarter | `institution_financial_records` (`ncua`, thousands, income YTD); newest quarter also syncs the credit-union universe |
| `registry-fdic-sod` | year | `institution_branch_deposits` |
| `registry-ncua-branches` | newest quarter only | `credit_union_branches` (NCUA branch file: addresses, no coordinates or deposits) |
| `registry-ncua-branch-geocode` | `pending` (hourly while addresses remain) | `credit_union_branches.latitude/longitude` via the free US Census batch geocoder, 1,000 addresses a run |
| `registry-cfpb` | year | `institution_identity_links` (`cfpb_company`), `institution_complaint_records` |
| `registry-sec-links` | `current` | `institution_identity_links` (`sec_cik`), `institution_sources.sec_cik` |
| `registry-sec-filings` | `batch-0`..`batch-7` | `institution_filings`, `holding_company_financials` |
| `registry-beige-book` | release `YYYYMM` | `fed_beige_book` |
| `registry-fred` | `current` | `fed_economic_indicators` (FRED-native series only) |
| `registry-fomc-minutes` | `current` | `fed_fomc_minutes` (full text of each FOMC meeting's minutes linked from the Fed's FOMC calendar page; 8 new meetings per run until the backfill is done) |
| `registry-fed-publications` | `current` (daily) | `fed_publications` (research, regional reports and speeches from the 12 Reserve Banks' RSS feeds, found on the Fed in Print RSS page at fedinprint.org/rss, with a few banks' own feeds as fallback; each bank's count and any failed feed are in the partition detail) |
| `registry-federal-register` | `current` | `reg_tracker_items` (CFPB, FDIC, OCC, Fed and NCUA proposed and final rules from the Federal Register API, last 400 days; shadow mode, nothing stored, until `FEDERAL_REGISTER_TRACKER_LIVE=true`) |
| `registry-federal-bills` | `current` (daily) | `reg_tracker_items` (bank and credit union fee bills in the current Congress from the Congress.gov API, found by title, stage from the latest action; scheduled only when `CONGRESS_GOV_API_KEY` is set; shadow mode, nothing stored, until `FEDERAL_BILLS_TRACKER_LIVE=true`) |
| `registry-state-bills` | `current` (hourly while states are due; each state also gets its own weekly row) | `reg_tracker_items` (12 states a run, bank and credit union fee bills from the Open States API with their stage from the action history, last 400 days; Puerto Rico is searched in Spanish; a state whose searches find nothing is probed once more and, when Open States holds no searchable bill text there in the window, its row and the step detail record `no_source_data`; scheduled only when `OPEN_STATES_API_KEY` is set; shadow mode, nothing stored, until `STATE_BILLS_TRACKER_LIVE=true`) |
| `registry-state-regulators` | `current` | `state_regulators`, credit-union charter agency |
| `registry-state-reg-news` | `current` (daily) | `reg_articles` source `state:XX` (each state banking and credit union regulator's press releases: the feed its home page advertises, else its news page read as article links; each agency's mode, count and fee headlines are in the partition detail; shadow mode, nothing stored, until `STATE_NEWS_TRACKER_LIVE=true`) |
| `registry-state-bill-news` | `current` (daily) | `reg_articles` source `news:XX` (Google News RSS coverage of each fee bill in the `state-bills` partition rows, plus fee legislation news for a quarter of the states each day; shadow mode, nothing stored, until `STATE_NEWS_TRACKER_LIVE=true`) |
| `registry-wire-research` | `current` (every 12 hours) | `reg_wire_research` (Regulatory Wire research notes: the newest federal releases, state regulator banking posts and state fee bills without a note, 20 a run (`REG_WIRE_SUMMARIES_PER_RUN`, at most 30); reads each item's own page with a plain fetch (a PDF's text layer through Rosetta's `layoutDocumentText`, first 8 pages; a scan stays unreadable) and asks `claude-haiku-4-5-20251001` (`REG_WIRE_SUMMARY_MODEL`) for a JSON summary from that text only, through `paidModelCall`; a date the text does not state is dropped in code; press is never summarised. Shadow mode until `REG_WIRE_SUMMARIES_LIVE=true`: picks and reads the items and logs them, no model call, nothing stored) |
| `registry-enforcement` | `current` | `institution_enforcement_actions` (OCC EASearch export and Fed enforcement CSV; institution actions only, matched by name and state or to a holding company) |

- Pure HTTP clients and parsers are in `src/lib/regulatory/` and never write to the DB.
- `src/lib/agents/registry-scheduler.ts` runs from the cron tick and keeps one registry run in flight. It merges candidates round-robin across sources, newest partition first, and backfills to `REGISTRY_BACKFILL_FROM` (default `2010Q1`).
- Identity matching (`registry/identity.ts`) accepts only unambiguous names. Shared names are stored as `needs_review` and never used until a person accepts them. Links with `verified_by` set are never overwritten.
- Operator view: `/admin/magellan/registry`. Manual queue: `POST /api/admin/registry/run` with `{ source, partition_key?, dry_run? }`.
- Add a source: write a client in `regulatory/`, a worker in `registry/`, an entry in `REGISTRY_SOURCES` (`registry/index.ts`), a scheduler partition list, and a `narrate.ts` sentence. `run-store.ts` dispatches every `registry-*` key automatically.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |
| No fee link fails the same way 3+ times a day | `repeatFailures` (fetch: 404, 403, 410, network, timeout, 5xx, 429) | 0 |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `banksSearched`, `linksFound`, `docsFetched`.

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `ADDRESS_VARIANT_FETCH_STRATEGY` | `fetch.address_variant` | v1 | `magellan/address-variant-fetch.ts` |
| `BLOCKED_FETCH_STRATEGY` | `fetch.paid_web_fetch` | v2 | `magellan/blocked-fetch.ts` |
| `BLOCKED_COMPANION_FETCH_STRATEGY` | `fetch.paid_web_fetch_companion` | v1 | `magellan/blocked-fetch.ts` |
| `COMPANION_FETCH_STRATEGY` | `fetch.companion` | v1 | `magellan/companion-fetch.ts` |
| `DISCOVERY_METHOD_VERSION` | — | v5 | `magellan/discovery.ts` |
| `WEBSITE_REPAIR_STRATEGY` | `discover.website_repair` | v1 | `magellan/discovery.ts` |
| `UPGRADE_SEARCH_VERSION` | — | v3 | `magellan/discovery.ts` |
| `BUSINESS_SEARCH_VERSION` | — | v1 | `magellan/discovery.ts` |
| `FRESHNESS_SEARCH_VERSION` | — | v2 | `magellan/discovery.ts` |
| `MAGELLAN_FETCH_STRATEGY` | `fetch.http` | v2 | `magellan/fetch.ts` |
| `OPERATOR_SCHEDULE_STRATEGY` | `discover.operator_schedule` | v1 | `magellan/operator-schedules.ts` |
| `PAGE_CLASSIFIER_VERSION` | — | v2 | `magellan/page-classifier.ts` |
| `PAID_FIND_STRATEGY` | `discover.paid_web_search` | v1 | `magellan/paid-find.ts` |
| `PAID_PICK_STRATEGY` | `discover.paid_pick` | v1 | `magellan/paid-find.ts` |
| `KEEP_REFUSED_ANSWER_STRATEGY` | `discover.keep_refused_answer` | v1 | `magellan/refused-answers.ts` |
| `CENSUS_ACS_PARSER_VERSION` | — | v3 | `magellan/registry/census-acs.ts` |
| `CFPB_PARSER_VERSION` | — | v4 | `magellan/registry/cfpb.ts` |
| `ENFORCEMENT_MATCHER_VERSION` | — | v3 | `magellan/registry/enforcement.ts` |
| `FDIC_UNIVERSE_PARSER_VERSION` | — | v2 | `magellan/registry/fdic-universe.ts` |
| `FFIEC_OVERDRAFT_PARSER_VERSION` | — | v2 | `magellan/registry/ffiec-overdraft.ts` |
| `NCUA_PARSER_VERSION` | — | v3 | `magellan/registry/ncua-financials.ts` |
| `SEC_LINKS_PARSER_VERSION` | — | v2 | `magellan/registry/sec.ts` |
| `STATE_BILLS_TAGGING_VERSION` | — | v5 | `magellan/registry/state-bills.ts` |
| `STATE_ENFORCEMENT_PARSER_VERSION` | — | v5 | `magellan/registry/state-enforcement.ts` |
| `STATE_NEWS_PARSER_VERSION` | — | v2 | `magellan/registry/state-reg-news.ts` |
| `RESTORE_FEE_PAGE_VERSION` | — | v1 | `magellan/restore-fee-page.ts` |
| `SCHEDULE_SEARCH_STRATEGY` | `discover.paid_schedule_search` | v2 | `magellan/schedule-search.ts` |
| `SITE_SEARCH_STRATEGY` | `discover.site_search` | v1 | `magellan/second-document.ts` |
| `WEBSITE_FIND_STRATEGY` | `discover.website_search` | v1 | `magellan/website-find.ts` |
