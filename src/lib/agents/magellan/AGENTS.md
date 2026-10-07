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
The state's market leaders (top 15 by deposits or fee income, `loadMarketLeaderIds`) go
first among banks due, after corrections.
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
| 2 | `discover.second_document` | `second-document.ts` (version 3, the companion finder), after the main loop: banks with fewer than 8 published fee categories (none counts), an HTML fee link and no monthly fee, or a link that is not the consumer schedule yet (link coverage), get a search of the homepage, the fee page, up to 3 hub pages and the site's own search. Every deposit-account page that lists a fee (named after its account, e.g. "Freedom Checking"), every fee document (schedule, disclosure, courtesy pay policy, opaque `/assets/files/` PDFs; checked by the shared fee-page check) and every account, member, membership or deposit agreement (or terms and conditions) whose text lists at least one fee with a dollar amount (role `consumer_supplement`, PDFs read up to 12 pages, at most 3 checked) is stored in `institution_additional_sources`, up to 8 per bank. Business, loan, HELOC and line-of-credit pages are skipped. Never replaces the fee link. Each bank at most monthly. Report requesters (`leads.quote_institution_id`) and $10B+ banks go first, then links that are not the schedule, then the fewest categories. Slots the state's own banks leave free go to hidden banks (fewer than 3 live categories, link a product page or no overdraft price) from any state, in the same order, so a state lane that has checked all its banks this month still works on the 3-fee-rule backlog. |
| 2 | `discover.site_search` | Inside the companion finder: the bank's own site search (a GET search form on its homepage), at most 4 result pages per bank per run. "fee schedule" always runs; the other 3 rotate each recheck window through "account agreement", "schedule of fees", "member agreement", "truth in savings", "deposit agreement", "membership agreement". One attempt row per query (`detail.query`, `candidates`, `kept`; not folded into the playbook): `ok` when a page it found was kept, `rejected` when its hits were all dropped, `no_candidates` when it linked to nothing useful. |
| 3 | `discover.paid_pick` | `paid-find.ts`: one model call, no tools, picks up to 3 of the homepage's links; each pick passes the fee-page check. Off with `MAGELLAN_PAID_PICK=off`. |
| 3 | `discover.paid_web_search` | `paid-find.ts`, the `discover-paid` provider step (below); runs only when the pick found nothing, once a month per bank. |

- Fee-page check (`find-validate.ts`), shared by every finder and the paid pass: HTML
  must pass `scoreFeePage` and not be a rates page; PDFs are downloaded (up to 8 MB)
  and their first pages read, so a rate sheet or press release is rejected. A PDF with
  no readable text (a scan) is accepted only on a strong fee label. Fee words are counted
  on the page's own content (menus, header and footer stripped). Below the fee-page bar
  (3 fee lines) HTML passes only when its address names the fee page, or its label is
  strong and it lists a fee; an account or product page (`looksLikeProductPage`) is
  rejected as `product_page` and belongs to the companion finder as an account page.
  A business-only schedule (its address or its own heading names business/commercial and
  nothing names personal or consumer accounts) is rejected as `business_schedule`.
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
- Upgrade search (`UPGRADE_SEARCH_VERSION`): in spare discovery capacity, banks whose fee
  link is a product page are searched once per version for the real schedule
  (`detail.upgrade_search`). A find replaces the link and keeps the old page as a
  companion `account_page`; a miss leaves the link and rescue state untouched.
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
  that are `dead` after a search with the current method version and had no paid try
  this month. One `paidModelCall` per bank (agent `magellan`, `PAID_PASS_MODELS.find()`,
  server `web_search` tool, max 3 uses) asks for the consumer fee schedule on the bank's
  own domain as JSON. The answer must be on the bank's domain and pass the same
  fee-page check before it is stored. Each try is logged with its cost. A budget cap or
  the automation stop ends the step cleanly (`budgetStopped`); the unspent bank stays due.
  Report requesters go first, then the largest banks; $10B+ banks and requesters are
  picked from any state's paid step, not only their own.
- Schedule search (`schedule-search.ts`, `discover.paid_schedule_search`), in the same paid
  step: up to `SCHEDULE_SEARCH_PER_RUN` $10B+ banks, report requesters or market leaders
  (top 15 in their state by deposits or fee income, `loadMarketLeaderIds` in
  `src/lib/data-store/market-leaders.ts`), from any state, whose link is not the consumer
  schedule (link coverage) or who are hidden (fewer than three live fee categories), once a
  month each, requesters then leaders then largest first. If the ranking fails the lane runs
  on size and requests alone. The model (web search) is told why the held page is not it; the
  answer must be on the bank's domain, new to the bank, and pass the fee-page check. It is
  stored as a `consumer_supplement` companion beside the link, so companion fetch, Rosetta
  and Knox read it; the link and its live fees stay. A second lane takes up to
  `HIDDEN_BANK_SEARCH_PER_RUN` banks of any size that the catalog hides (fewer than three
  live fee categories) whose link is an account product page or prices no overdraft,
  largest first. The bank's own domain includes its corporate domain (`onBankDomain`).
- Website search (`website-find.ts`, `discover.website_search`), in the same paid step after
  the banks: up to `WEBSITE_FIND_PER_RUN` institutions in the state with no `website_url`
  and no fee link, once a month each. The model (web search) names the official homepage;
  it is saved only when it is not a directory, social, government or another institution's
  domain, and the homepage names the institution (every distinctive name word) plus its
  city or its FDIC certificate / NCUA charter number. Saving resets the bank's search
  (`rescue_status = 'pending'`) so the free finders search the new site next. Anything
  else stays for a person: `detail.candidate_url`, `needs_human: true`. A one-word stored
  name ("CALIFORNIA") is not searched.

## Outcome ledger (`outcomes.ts`)

Every discover step judges its state's banks (a step without a state judges one 24th of
all banks, bank id mod 24 = the UTC hour; `stepSlot`) by what their links produced downstream, and writes the judgement to
the shared learning store (`pipeline_feedback`, `check_name = magellan.link_yield`,
dedupe `magellan.link_yield:doc:<first source_document_id of the link>`). A link is the
bank's main fee link or a companion page; all fetches of the same address count as one.

| Label | Rule | Signal, kind, weight |
|---|---|---|
| good | 3 or more distinct fees from it are live | right, `produced_live_fees`, live fee count |
| dead | last fetch 404/410, or Rosetta's last read was a 404 | wrong, `dead_link`, 1 |
| rejected | Rosetta's last read ruled it the wrong document | wrong, `wrong_document`, 1 |
| thin | Knox extracted it over 24 hours ago, fewer than 3 live fees | wrong, `thin_link`, 1 |
| business | the bank's main link is a business-only schedule (`isBusinessOnlyLink`), whatever it produced | wrong, `business_schedule`, 1 |

Anything else (not read or extracted yet, a bot wall) is not judged yet. `about_strategy`
is the Magellan specialist whose attempt found the address (null for links the old
crawler left). Only changed judgements are written; the step's `link_outcomes` detail
reports the counts. Finders, the fee-page classifier and Darwin read these rows.

## Fee-page classifier, in shadow (`page-classifier.ts`)

A learned check on whether an opened page is the bank's fee schedule, trained on the ledger
above: links with 3+ live fees are fee pages, thin and rejected links are not, dead links are
left out. The text is what Rosetta stored (`agent_source_texts`, first 8,000 characters). It is
a naive Bayes over word stems, address words and the rule check's own counts; no model call.

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
Steps never call a provider and stay out of `PROVIDER_STEP_KEYS`.

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
| `registry-state-bills` | `current` (hourly while states are due; each state also gets its own weekly row) | `reg_tracker_items` (12 states a run, bank and credit union fee bills from the Open States API with their stage from the action history, last 400 days; scheduled only when `OPEN_STATES_API_KEY` is set; shadow mode, nothing stored, until `STATE_BILLS_TRACKER_LIVE=true`) |
| `registry-state-regulators` | `current` | `state_regulators`, credit-union charter agency |
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
