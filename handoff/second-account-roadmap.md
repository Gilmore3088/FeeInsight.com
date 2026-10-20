# Second-account roadmap (all remaining Fee Insight work)

Written 2026-10-16 from the open issues and PRs in Gilmore3088/FeeInsight.com, project memory, the two earlier punch lists and the four lane handoff notes (Hamilton, Data quality, Page templates, Website). This project's threads have stopped. Everything left is here, in order, for James's second account.

## How to run

1. Open a fresh Claude Code session on the repo for each item. Paste the item's prompt as written.
2. **Branches start `acct2/`, PR titles start `[acct2]`.** Existing PRs keep their branch; the second account pushes to them.
3. **Review and merge happen on the second account.** After a PR is up and green, open a second fresh session and paste the **Review-and-merge prompt** (Phase 0) with the PR number. It reviews the exact head, fixes what it finds, and merges when the PR is clean. James's standing authorization in `CLAUDE.md` covers that merge.
4. **Items marked DECISION wait for James.** The question, options and a recommended default sit at the top of the item. When he says yes (or picks an option) in that session, the same agent does all the work. Nothing that moves live fees, adds a migration, or changes a setting runs before that yes.
5. Order: Phase 1 first (it unblocks everything), then phases 2 to 6 in any order with up to three sessions at once, one per lane (Data, Hamilton, Site). Phase 7 is James's own list.

The full file and the two half-done patches live in the repo on branch `claude/project-thread-awcc9c`, folder `handoff/`, so a session with only the repo can read them:

```
git fetch origin claude/project-thread-awcc9c
git show FETCH_HEAD:handoff/second-account-roadmap.md
```

## Rules for every session

Every prompt below starts by telling the session to read this section.

- **Repo rules.** Read `CLAUDE.md`, `AGENTS.md`, the agent's own `src/lib/agents/<agent>/AGENTS.md` where one applies, and the latest file in `docs/project/checkpoints/`. One outcome, one branch, one PR; small related fixes may ride along. Before writing code, search open PRs and `main` for the same work and reuse it. Never batch different lanes, approval-needed with no-approval work, or a database change with unrelated code. Rule changes that bump the same version ship together.
- **Checks and CI.** Run `npm run guard:legacy`, eslint, `tsc --noEmit` and the changed files' vitest tests one at a time (together they run out of memory). Push only when the PR is ready and these pass; every push costs CI minutes. Merge `main` in only for a conflict, a dependency or a new migration. Keep tests lean: extend the module's existing test file. Never skip or disable a test.
- **Never** force-push, push to `main`, delete a branch, add a scheduled routine, make paid model calls, use the Firecrawl connector, or send outreach. A migration, a production data change, a switch-on of a shadow flag, or a settings change happens only after James's explicit yes in this session. Never invent a number: if a count needs production data you can't read, say it's unknown.
- **Accuracy.** The target is 99.5% of a dated random sample of live fees matching the bank's own document on amount and category. The one shared check is `checkFeeAgainstSource` in `src/lib/custom-report/source-check.ts`. A rule that holds, rejects or re-files a fee ships with its Darwin live re-check and a dry-run count of the live fees it would take down, in the same PR. Fee reads use `published_fee_catalog` (rates from `published_fee_rate_catalog`, never pooled with dollars); never read `extracted_fees`.
- **Brand.** Fee Insight is the company, the site and the header/footer brand. Bank Fee Index is the dataset, named only where its data is. Hamilton is the Pro workspace and never appears in the site header or footer. Customer-facing text never names the pipeline agents (Atlas, Magellan, Rosetta, Knox, Darwin, Deming, Gutenberg).
- **Demos.** Never use Frost Bank in any demo, fixture, screenshot, video or copy (a client of James's employer). The demo cast: Capital City Bank (id 323, lead), U.S. Bank (5), M&T Bank (21), Navy Federal (4956), SchoolsFirst FCU (6741).
- **Site and Hamilton UX.** Build from the growthOS site brief, issue #1294, and the `growth-os/` folder. The bar: minimal copy, never verbose; rich, real exhibits, not wireframe boxes or walls of numbers; charts and maps interactive (click a bar or state and the page updates); visible video placeholders integrated into the page; lead with a few sourced findings; one next action per band; the Pro pitch never outshines the findings; small footers; no em-dashes; never hard-code a fee number or count. Headings never wrap a single word (`text-wrap: balance` is global; don't override it). Visitor-facing words go through the `copywriting` and `copy-editing` skills, follow `growth-os/context/editorial-policy.md` (every number has a source), and get a short copy-review note in the PR. Every site or Hamilton UX change gets a growthOS review (run the `ux-ui-auditor` agent against the brief) and desktop and phone screenshots in the PR, made with the pre-installed Playwright Chromium. The funnel's goal is a Hamilton Pro subscription; the $300 report is a lead, not the goal.
- **The PR.** Branch `acct2/<issue>-<slug>`, title `[acct2] ...`, body starting "Second-account roadmap, item N", then the issues it closes, what changed, how it was verified, and the one number it should move. Then hand it to the Review-and-merge prompt.
- **Gotchas.** The Supabase MCP may fail in the cloud (ERR_PROXY_TUNNEL); then production counts are "unknown" and the PR says which query James should run. `expectedHeadSha` on a merge is the full 40-character sha. Docs-only PRs don't run test.yml, so wait for the Vercel status. A cancelled `app-tests` on an old head is from a newer push, not a failure. Vercel previews can queue for 30 minutes and James can't log in to them, so send screenshots or `?_vercel_share=` links. The local `next build` fails on an existing `admin/verify` page-export error; for screenshots only, set `typescript.ignoreBuildErrors` temporarily and never commit it. A patch with wrong hunk counts applies with `git apply --recount`.

## Decisions for James, all in one place

Say yes (or pick) in the session for that item. The recommended default is in bold.

| # | Item | Question | Default |
|---|---|---|---|
| D1 | 1.2 | Merge the page-template PRs on the approval list (#1464, #1470, #1471, #1476, #1477, #1481, #1488, #1491, #1500, #1503, #1532, #1535, #1564)? | **Yes, each after a clean review** |
| D2 | 3.1 | Switch on wrong-bank documents (#1455, PR #1489): 234 live fees down, 3 website fixes | **Yes** |
| D3 | 3.2 | Switch on the account-research split (#1398, PR #1486) after its exact count | **Yes, after the count** |
| D4 | 3.3 | Sister charters count once (#1441, PR #1475) after the readers are fixed | **Yes** |
| D5 | 3.4 | Fragment check + Knox re-read pickup + its index migration together (#1443, #1499, #1511): 11 down, 28 renamed | **Yes** |
| D6 | 3.5 | Hourly frequency for 794 live fees (#1456, PR #1507) | **Yes** |
| D7 | 3.6 | Loan and card fees out of the deposit index (#1442, #1518): 92 down; brokerage (7 U.S. Bank rows) separately | **Yes to both** |
| D8 | 3.7 | Release repair (#1367, PR #1474) after its count | **Decide on the count** |
| D9 | 3.8 | Fix or re-read 9 joined or misfiled single fees (#1512, #1513) | **Yes** |
| D10 | 3.9 | Tier-perk $0s: 14 Frost premium-schedule $0s + Gate City BankOn $0 down (#1397, #1568) | **Yes** |
| D11 | 3.10 | Page-copy collapse (#1439, #1348, PR #1570): 437 down, after the safeguard and a fresh count | **Decide on the count** |
| D12 | 3.11 | Second look for `tier_perk_zero` only (`DARWIN_RECHECK_SECOND_LOOK_LIVE`) | **Yes, tier-perk only** |
| D13 | 4.9 | #978's four correction-lifecycle questions | Agent states them with defaults |
| D14 | 4.10 | #982 B4, B8, B9 (incl. a branch-protection plan, a settings change) | Agent states them with defaults |
| D15 | 4.11 | A second linked Pro login for #976's two-user checks | James creates it |
| D16 | 6.12 | Homepage cold cache (#1572): keep the last good page, or a short revalidate? | **Keep the last good page** |
| D17 | 7 | "Fee Insight Advisory" on /subscribe, /about, /contact, /api-docs (#1174) | **Drop** |
| D18 | 7 | Free visitors see each fee's range on the national index (#1449) | **Keep** |
| D19 | 7 | Close #1289 (no homepage-directions preview needed) | **Close** |
| D20 | 7 | Index institution pages with financial data but no fees (#1043) | **No index until they have fees** |
| D21 | 7 | Old drafts #1016, #1011, #810, #811 | **Leave open; close only on his word** |

---

## Phase 0: the Review-and-merge prompt (reuse for every PR)

```text
Review and, if clean, merge PR #<N> in Gilmore3088/FeeInsight.com.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it.

1. Read the PR, its linked issues and every review thread. Note the exact head sha.
2. Review the diff of that head yourself as an independent reviewer: correctness, the repo rules, tests that prove the change, no fake numbers, no Frost Bank, brand rules, no pipeline names in customer text. For site or Hamilton UX, run the ux-ui-auditor agent against issue #1294 and look at the screenshots; for data rules, check the dry-run count is in the PR.
3. Fix every blocker and every small, correct nit on the PR's branch (merge main in only for a conflict or dependency; never rebase or force-push someone else's branch). Run the local checks before each push.
4. The PR is clean when: your review of the exact current head finds no blockers, required CI and the Vercel status are green on that head, there's no conflict, and no review thread waits on you. If it adds a migration, it must merge main and re-run `scripts/ci-guards.sh migration-version-kill` first.
5. Gated: do NOT merge if the PR adds a migration, changes production data or switches on a shadow flag, unless James said yes to it in this session. Stop and ask him with the question, the count, and your recommendation.
6. Otherwise merge (squash) with expectedHeadSha set to the full head sha, post a short receipt comment on the PR (what merged, the review verdict, the CI run), and add one line to issue #1026.
```

## Phase 1: land what is already built

### 1.1 Finish the PRs that are ready (no decision needed)

```text
Work through these open PRs in Gilmore3088/FeeInsight.com, one at a time, using the review-and-merge steps below. They were left by the lane threads, mostly reviewed and green.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it. Then read its "Phase 0" prompt: those are the review-and-merge steps.

- #1569 Hamilton "compare with us" with no linked institution (#1536). Head e7b4dfac was reviewed with no blockers and all checks green except Vercel pending. Merge when Vercel is green.
- #1590 Pro pages polish (#1515, #1578). Head e6aa933f is green; the earlier review covered edf16872, so review e6aa933f fresh, plus a growthOS re-check that the closing heading changes once a price shows. Also fold in this review note: the homepage sourced-fee exhibit should use the ladder's fee names (`lineName` in src/app/for-institutions/board-math.ts) instead of `getDisplayName` ("Overdraft (OD)").
- #1589 [acct2] unstated-audience asterisk (#1132). Its review follow-ups are #1595; do those in the same PR if small.
- #1582 [acct2] page speed findings (#1168), a draft: finish it or mark it ready, per its own body.
- #1550 answer key: night deposit bag and key purchases leave scoring (#1099). Pair with #1577 (28 learning rows still teach the old reading) if it is the same change.
- #1497 Magellan second-document search (#1494). Magellan discovery is parked until Nov 1, but this is a bug fix in existing code; merge if clean, otherwise leave it open with a note.
- #1566 Hamilton holds non-checking accounts' monthly fees as verified (#1100 gap 1).
- #1594 Gutenberg writes the publisher's runs (#1075 step 2). It needs migration 051 (PR #1458, closed) to be on prod: check `supabase/migrations/` on main for 20270110000051_gutenberg_agent.sql and the PR's own notes. If the migration isn't applied, stop and ask James.
- #1567 takes down 5 confirmed-wrong live fees (#1370). That is a production data change: it falls under James's Oct 16 small-takedown rule (25 rows or fewer, each checked against the bank's text), but confirm with James in this session before merging.

Done when each PR is merged with a receipt, or left open with one comment saying exactly what blocks it. Report the list back.
```

### 1.2 DECISION D1: the page-template PRs on the approval list

> **Question:** merge the 13 page PRs James has been shown (screenshots in the project's approval list)? **Options:** merge all after a clean review / merge only the ones he names / hold. **Default: merge all after a clean review**, fixing his feedback first.

```text
James's page-template PRs in Gilmore3088/FeeInsight.com are waiting for his yes. Ask him first: "Merge all 13 page PRs after a clean review, only the ones you name, or hold?" Recommend merging all. Do nothing until he answers.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and its "Phase 0" review-and-merge steps, and follow them.

The PRs, oldest first (merge in this order; each later one may need main merged in for a conflict):
#1464 /reports (James: "looks better"; nit: on desktop, vertically center the left side of the state bar under the map), #1470 city pages, #1471 benchmark and published reports, #1476 sample report, #1477 guides, #1481 contact, #1488 research article, #1491 /fees hub, #1500 report PDFs rebrand (#1284 report stage), #1503 institution search, #1532 methodology, #1535 about, #1564 data sources (the Federal Register row stays hidden until `FEDERAL_REGISTER_TRACKER_LIVE` is confirmed).

Do not touch #1575 (API docs) or #1587 (price check): James is handling those himself.

For each: review the exact head, run the ux-ui-auditor agent against #1294, check the screenshots in the PR (retake desktop and phone shots if main changed the page), fix blockers, merge clean, post a receipt. Done when each is merged or has one comment saying what blocks it.
```

## Phase 2: finish the half-done work

### 2.1 Hamilton peer-list wording (#1537, #1538 routing, #1539)

```text
Open the PR for a finished Hamilton patch in Gilmore3088/FeeInsight.com. Do this after PR #1569 has merged.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it.

The patch is `handoff/hamilton-peer-wording-1537-1538-1539.patch` on that branch (`git show FETCH_HEAD:handoff/hamilton-peer-wording-1537-1538-1539.patch > /tmp/peer.patch`). Create branch acct2/1537-peer-wording from fresh main and `git am /tmp/peer.patch` (or `git apply --recount` and commit). Expect a small conflict with #1569 near the shortage note in src/lib/hamilton/peer-list-service.ts; keep both changes.

What it does: "similarly sized ... to SchoolsFirst" becomes the half-to-double asset band around the research institution (a different named institution is refused with a clear message); "$5B", "5 billion", "$5,000M" and "5000 million" give the same list and the verb is optional; `parseMarketQuestion` no longer turns peer-list questions or their follow-ups ("Only show the California ones") into a market brief; the shortage note says "No institution meets..." or "Only 1 institution meets...".

Done when: the 1,700 Hamilton tests, tsc, eslint and guards pass; the PR closes #1537 and #1539 and references #1538 (its live B9/B10 re-run is item 4.1); the copy-review note covers the two new visitor strings; then run the Phase 0 review-and-merge steps.
```

### 2.2 Darwin conditional-$0 and "Premier Checking" fix (#1571, #1574)

```text
Open and land the Darwin fix already pushed on branch claude/project-thread-hqsa20 (head bff6af65) in Gilmore3088/FeeInsight.com. It is main plus the fix; no PR exists yet.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it.

The change: src/lib/agents/darwin/verify.ts (`ownRow`, `nextRow`, `namesOtherFee`, `LABELLED_CELL`, `ownPart`), darwin/tier-perk.ts (`ACCOUNT_OWN_KEYS`), the re-check bumped to v4 in verified-recheck.ts, AGENTS.md and the Bayes manifest. Text after a $0 counts as the next fee only if its label has a fee noun, no condition word and no word of the fee's own name. Four review rounds are fixed; the rule fails safe. Known cautious misses are fixtures: 89048 (two-column page) and 47583.

Prod dry run at 069f196a (one step before the final tightening): of 3,017 live $0 fees, 15 would no longer be flagged, all hand-checked as real; pass-to-fail 0; held conditional_zero rows newly verified 0. Two stricter changes followed, so a recount on bff6af65 is owed (expect about 14 cleared). If you can read prod, rerun the dry run; if not, say the recount is owed and give James the query.

Steps: review the exact head bff6af65 once more as an independent reviewer; open the PR from that branch (title "[acct2] Darwin: conditional $0 reads its own line; product names aren't tier perks (#1571, #1574)", closes #1574 and the code half of #1571) with the dry-run numbers above in the body (the Darwin re-check rule requires them); run the Darwin tests (1,492), tsc and guard:legacy; then the Phase 0 review-and-merge steps. It is code-only and moves no live fees until its re-check runs.
```

### 2.3 Hand takedown of 15 confirmed-wrong live $0s (#1571)

> **Question:** take down 15 live $0 fees, each re-read against the bank's stored text? **Default: yes** (under James's Oct 16 small-takedown rule: 25 rows or fewer, each hand-checked).

```text
Ask James first: "Take down these 15 confirmed-wrong live $0 fees (#1571)? Each was re-read against the bank's stored text." Recommend yes. Do nothing to production until he says yes.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it.

The patch is `handoff/hand-takedowns-1571.patch` on that branch (made with git format-patch on main 9443288c). It adds 15 entries to src/lib/agents/hamilton/hand-takedowns.ts and updates its test. Fee ids: 43512, 54014, 61335, 68893, 70121, 73737, 77121, 77122, 77618, 84553, 87079, 87461, 88213, 91505, 120559. Three were dropped as real $0s traced to the wrong line: 48061, 76234, 83391; don't add them.

Steps: branch acct2/1571-hand-takedowns from fresh main, apply the patch, run the test. As an independent reviewer, check each entry against the bank's stored text (agent_source_texts for the fee's source_document_id) and drop any you can't confirm. Post a comment on #1571 listing each id with its excerpt, and one ledger line on #1026. Open the PR, then the Phase 0 review-and-merge steps (gated: merge only with James's yes).
```

### 2.4 District hub (#1467)

```text
Finish PR #1467 in Gilmore3088/FeeInsight.com, the Fed district hub at /research/district/[id] (branch claude/page-templates-fwbeti-district, head 4a368d0).

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it.

James called the old page "horrible thin". He wants a district hub with a wealth of aggregated data, presented beautifully and not word-heavy. It was rebuilt with: a state map and table, service charges, who serves the district, CFPB complaints, jobs and prices, and fee changes.

1. The new SQL in src/lib/data-store/district-hub.ts has never run on prod data. Run each query read-only against prod if you can (otherwise check it on the Vercel preview with the Vercel MCP web_fetch_vercel_url), fix anything that errors or returns nonsense, and measure the cache-miss read time (cache key district-hub-v1).
2. Keep these defaults: the free report button keeps the report=district link; fees use each institution's Fed district while branches, Census (ACS) and jobs cover whole states, and the page says so; Frost Bank stays filtered out of the deposit leaders list.
3. ux-ui-auditor review against #1294; desktop and phone screenshots of districts 6 and 11 in the PR; send James the shots or a ?_vercel_share= link.

Done when James has seen the shots and says yes, then the Phase 0 review-and-merge steps.
```

## Phase 3: data switch-ons (each waits for James's yes)

Each is built and merged in shadow; nothing has moved live fees. Use one prompt per item, with the item's details filled in from the table below.

```text
Switch-on for Gilmore3088/FeeInsight.com: <ITEM>.

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it. Then read the item <ITEM NUMBER> row in its Phase 3 table.

1. Read the issue(s) and the merged PR(s) named there, and find the exact switch (env var or constant) and any prerequisite listed.
2. Do the prerequisite work first (code, in its own PR if it is unrelated), and refresh the dry-run count read-only on prod if you can; otherwise give James the query and say the count is owed.
3. Ask James: "<the question>, with today's count of N live fees and the hand-check result." Recommend the default. Stop until he answers.
4. On yes: one small PR that flips the switch (and the migration or website fix where listed), with the count, the samples and the undo path in the body. Phase 0 review-and-merge steps; it is gated, so it merges only on his yes. After it runs, recount and post the before/after on the issue and one line on #1026.
```

| Item | What | Issues / PRs | Count and evidence | Prerequisite | Default |
|---|---|---|---|---|---|
| 3.1 (D2) | Documents filed under the wrong bank | #1455, PR #1489 | 234 live fees down across 20 document/bank pairs; 19 pairs (219 fees) right by hand, the wrong pair (1248, 15 fees) fixed. New find: Healthplus 5009's doc 18927 is Lakehurst's. Reads 25 pairs an hour (5 to 6 days) unless the limit is raised. | Correct stored websites for Bluegrass 5756, Metrowest 4884, FNB Oldham 1903 (a data change, in the same yes) | Yes |
| 3.2 (D3) | Account research holding other fees | #1398, PR #1486 | Exact count from a `research_split_full_count` run, not yet taken. Check: a checking "Excessive transaction fee" charged per check would move by name. Also hand re-file 28554 (empty ATM envelope fee). | Take the count | Yes after the count |
| 3.3 (D4) | Sister charters share one schedule and count once | #1441, PR #1475 | IBC (5 charters) and Wells Fargo (3), about 260 rows | Fix the readers listed in the switch comment in `fee-stats.ts` | Yes |
| 3.4 (D5) | Fragment names + Knox re-read pickup + index migration | #1443, #1499, #1511, #1521; PRs #1522, #1527 | 642 live cut-off names: 11 down, 28 renamed, 585 stay live for a Knox re-read; all 39 changes right by hand. Keep live on purpose: a line giving both a minimum and a maximum, and "$500 minimum balance" wording. Close #1521's remaining gaps first if the issue lists any not covered by #1527. | The small index migration (new number one above the highest file; merge main; migration-version-kill) | Yes, all three together |
| 3.5 (D6) | Hourly frequency | #1456, PR #1507 | 794 live hourly fees get "hourly" (788 have none); 17 exempt; 40 of 40 right | none | Yes |
| 3.6 (D7) | Loan and card fees out of the deposit index | #1442, #1518; PRs #1517, #1547 | 92 down (87 lending fees on 42 loan, HELOC, card and rate-sheet pages at 36 banks, plus 5 lending fees under deposit categories); 116 deposit fees on those pages stay live, as does Siouxland's safe deposit "Late Fee". U.S. Bank's 7 brokerage-page fees are a separate switch. | none | Yes to both switches |
| 3.7 (D8) | Release repair: the release step's source check checks category | #1367, PR #1474 | Full count and false-positive sample from a `release_repair_full_count` run, not yet taken | Take the count | Decide on the count |
| 3.8 (D9) | Nine joined or misfiled single fees | #1512, #1513 | Joined rows: 142965, 139453, 61871, 73876, 14294, 70046, 139131 (45619 already handled by PR #1551 with Flagstar's $20 overdraft from #1549; check #1551 merged). Misfiled: 43277 "Undeliverable Mail" (research), 63055 international wire filed as domestic. No automatic rule: detectors were only 15 to 40% precise. | Check #1551 | Yes (fix by hand under the small-takedown rule, or send for a Knox re-read) |
| 3.9 (D10) | Tier-perk $0s still live | #1397, #1568 | 14 $0s on Frost's premium-account page (overdraft, NSF, stop payment, wires and others) + Gate City's "BankOn Checking Account Overdraft Fee" $0; all confirmed wrong | none (hand takedown, like item 2.3) | Yes |
| 3.10 (D11) | One schedule stored as several copies | #1439, #1348, PR #1570 (`PAGE_COPY_COLLAPSE_LIVE`) | 437 live duplicates would close (322 under a different name, 115 same or near name); 10 of 10 renamed checked as the same fee | Build #1439 item 3 first (a closed copy comes back if the copy it was kept for later comes down), in its own PR, then a fresh count | Decide on the count |
| 3.11 (D12) | Darwin re-checks older live rows / second look | #1568, #1397, #1593; PR #1576 (`DARWIN_RECHECK_OLDER_LIVE`, `DARWIN_RECHECK_SECOND_LOOK_LIVE`) | 55 flags due at 069f196a: 10 clear, 45 confirm. Of 31 conditional_zero confirms, 15 right, 11 wrong, 3 debatable (#1593), 2 deliberate holds, so the conditional_zero side stays off. | Item 2.2 merged and a fresh count. For the second look, add a check-code filter so only `tier_perk_zero` goes live. Turn on `DARWIN_RECHECK_OLDER_LIVE` only after 2.2 lands and the recount is clean. | Yes, tier-perk only |
| 3.12 | Audience relabel (#1059) | #1059, #1037 | About 99.7% of live fees have unknown audience; the relabel is merged but off until its dry run passes | Run the dry run; report opposite-audience errors on a hand sample | Yes when the dry run shows 0 opposite-audience errors |

## Phase 4: Hamilton

Use this prompt shape for each item, with the issue's details:

```text
Work on GitHub issue #<N> in Gilmore3088/FeeInsight.com: "<title>".

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it. Then read its Phase 4 row for #<N>.

Read the issue and its comments, docs/plans/hamilton-product-review-2026-10-12.md and docs/plans/hamilton-h07-acceptance-matrix.md. Hamilton lives at /pro/hamilton, built on #1011's design and left nav; don't rebuild what exists. Data quality must not block the experience. Use only the demo cast in tests and screenshots (Capital City Bank 323, U.S. Bank 5, M&T 21, Navy Federal 4956, SchoolsFirst 6741). Hamilton tests live in src/lib/hamilton/*.test.ts.

Done when: the issue's failing case has a test that now passes; for anything a Pro user sees, desktop and phone screenshots and a ux-ui-auditor review against the growthOS goals are in the PR; then the Phase 0 review-and-merge steps.
```

| Item | Issue | What done looks like |
|---|---|---|
| 4.1 | #1538 | After 2.1 merges: re-run B9 and B10 from the acceptance matrix live (James's admin login opens Pro on the live site; ask him to run it if you can't) and record the result on the issue. |
| 4.2 | #1540 | "10 of 16" says which institutions were left out and why, or includes the largest. |
| 4.3 | #1544 | One institution gets one peer group across fees, or the answer says why it differs. |
| 4.4 | #1543 | RIAD H032 is labeled as combined overdraft and NSF income everywhere it shows. |
| 4.5 | #1541 | No React hydration error #418 on Pro pages (find the server/client mismatch, often dates or locale). |
| 4.6 | #1542 | Saved follow-up titles name the institution, dates show in the user's time zone, peer lists save. |
| 4.7 | #1545 | Institution search finds "M&T" (and other names with &, apostrophes and periods). |
| 4.8 | #1546 | Institution links inside Hamilton open a Hamilton view, not the public consumer page. |
| 4.9 (D13) | #978 | DECISION: state the issue's four correction-lifecycle questions to James, each with options and a default, then build admin hold, correct and publish with durable audit history. Any migration waits for his yes. |
| 4.10 (D14) | #982 | DECISION: the acceptance matrix merged (#1548). Ask James about B4 (#979 closed with tasks open), B8 (main has no branch protection; propose a plan, which is a settings change he applies) and B9 (how H07-T08/T09 apply now). Then work the matrix's remaining rows. |
| 4.11 (D15) | #976 | Needs a second linked Pro login from James for the two-user checks; then separate account institution, research subject and peer context per the issue. |
| 4.12 | #977, #981, #980 | #977 peer lists with assets, reporting dates and explicit criteria; #981 evidence-bound research facts; #980 consistent typography and answer-first output (send James the design screenshots for his review). One PR each. |
| 4.13 | #1076, #1077, #1078 | The five standard questions answer at every demo-cast institution; answer the question asked, not an overdraft fallback; a Pro account's own institution comes first in the data layer. |
| 4.14 | #1414 | Hamilton paid eval follow-ups: code only, no paid calls; any eval run waits for James. |
| 4.15 | #1086 | Parked: state fee law data needs legal review, a migration and paid calls. Don't start without James. |

## Phase 5: page templates and site pages

Use this prompt for each page. One PR per page.

```text
Build the <PAGE> page template in Gilmore3088/FeeInsight.com (routes: <ROUTES>).

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it, especially the site design bar. Then read its Phase 5 row for this page.

Start from the merged templates and copy their patterns: T1 institution profile (#1395), T2 fee category (#1429), T3 state report (#1446), plus whatever of #1464, #1491, #1503 and #1532 has merged. Search open PRs first so you don't redo a page someone has open. Report pictures come from src/lib/report-showcase.ts. Read live data only through src/lib/data-store; never hard-code a fee number or count. Phone first. Sections: a few sourced findings first, a real interactive exhibit, a compact table with expandable evidence, one next action leading toward the free sample report and Pro.

Done when: the page is built; the ux-ui-auditor review against #1294 passes; desktop (1440) and phone (390) full-page screenshots are in the PR; the copy-review note is in the PR; then send James the screenshots and, on his yes, the Phase 0 review-and-merge steps.
```

| Item | Page | Routes and notes |
|---|---|---|
| 5.1 | Districts index | /districts or /research/districts (check the route): all 12 Fed districts on one clickable map with each district's headline fee read; links to the #1467 hub. After 2.4. |
| 5.2 | Guides hub | /guides: the guides as a visual index, each led by its live median; the free alert card. |
| 5.3 | Research hub | /research: articles, reports, district hubs and data sources as one index; lead with the newest sourced finding. |
| 5.4 | Consumer tools | /consumer, /check and the submit-fees page, one PR each: a single input, an instant live answer, one next step. Don't touch /price-check (#1587) or /api-docs (#1575). |
| 5.5 | Utility pages | Sign in, register, password, account, billing, welcome, legal, email and invite: one shared form style in the Fee Insight design system, one PR for the shared style, then small PRs. Hamilton's mark only inside Pro. |
| 5.6 | Emails | The email stage of #1284 (rebrand): Fee Insight colors and Geist in every transactional email template; no sending. Also fix the old report link at src/lib/agents/marketing/email.ts:125 (#1171). |
| 5.7 | /reports leftovers | #1171 and #1174: after D1 merges, check the issues' checklist comments and finish what's left (a report FAQ, Reports in the nav and footer). D17 decides "Fee Insight Advisory". |
| 5.8 | Sample market | #552 and #1177: the sample report's market stays James's pick. Ask him, defaulting to Capital City Bank's market (Tallahassee). |

## Phase 6: smaller fixes (no decision unless marked)

Use this prompt:

```text
Work on GitHub issue #<N> in Gilmore3088/FeeInsight.com: "<title>".

First: git fetch origin claude/project-thread-awcc9c, then read the "Rules for every session" section of `git show FETCH_HEAD:handoff/second-account-roadmap.md` and follow it. Then read its Phase 6 row for #<N>.

Read the issue and its comments; they are the spec. Build the fix with a test in the module's existing test file. If the fix would hold, reject or re-file a live fee, include the Darwin re-check and a dry-run count, and treat any switch-on as gated. Done when the issue's case is covered by a passing test and the PR is through the Phase 0 review-and-merge steps.
```

| Item | Issue | Notes |
|---|---|---|
| 6.1 | #1180 | Cut-off public names such as "Counter Check: A blank page of 3 personal". Display-only fix in src/lib/fee-display-name.ts: fall back to the category name when a name ends on a dangling adjective (personal, business, consumer). Route `toRateDisplayFees` (src/app/(public)/institution/[id]/profile-data.ts:42) through `feeDisplayName`. Patterns live in src/lib/fee-name-fragments.ts. |
| 6.2 | #1593 | Real free fees still held: two-column pages, `sourceLineFor` tracing the wrong line, price before the name; also miscategorised 47440 (Zelle) and 85790 (CO-OP). After 2.2. |
| 6.3 | #1302 | Leftovers: the 13188 duplicate, the 55401 audience, the 144352 floor. |
| 6.4 | #1549 | Follow-ups: the Flagstar overdraft conflict and Pinnacle NSF filed as overdraft (the $0 NSFs at Pinnacle, Flagstar, PNC and Fifth Third are right). |
| 6.5 | #1069, #1100 | Hamilton refuses at publish what a later sweep would take down; the 16 monthly_maintenance excess fees. |
| 6.6 | #1580 | Provider stop: guide-draft makes a paid call but isn't a provider step; an empty step list passes dispatch. |
| 6.7 | #1579, #1581 | Deming daily step at its step ceiling, noisy share alarm, no-source threshold; scorecard reader undercounts two remedies, UTC window, partial week. |
| 6.8 | #1584, #1585, #1583, #1586 | Review follow-ups from the first second-account batch: enforcement subject labels; Open States probe and Puerto Rico (after a live run); API fee_name docs; the small list in #1586. |
| 6.9 | #1595, #1592, #1591 | Unstated-audience count on cached national reads; Personal/Business tab follow-ups (#1588); /reports reads the shared coverage snapshot (#1179). |
| 6.10 | #1484, #1495 | City page uses the shared `cityMedian` helper; one shared read for report and article slugs and the /reports skeleton. Check the page PRs from D1 first; they may already cover these. |
| 6.11 | #1179, #1180 checks | Site punch list items 4 and 5 (check only): do coverage counts agree across pages, and is the cut-off name fix live? Post findings on the issues. |
| 6.12 (D16) | #1572 | DECISION: homepage cold cache returns a 500 when a read fails. Options: keep the last good page / short revalidate. Default: keep the last good page. |
| 6.13 | #1573 | State experts' dated notes need a migration: build it, but the merge waits for James's yes. |
| 6.14 | Data backlog | In this order, one PR each, with dry-run counts: #1102 (Knox's 40k held lines get an owner and a way out; the largest recall lever), #1295, #1440, #1342, #1347, #1339, #1360, #1196, #1450, #1436, #1496, #1479, #1213, #1200, #1269, #1304, #1303, #1335, #1389, #1025, #1472. Magellan issues (#1027, #1030, #1034, #1036, #1051) stay parked until Nov 1. |
| 6.15 | Foundation | #1122 admin redesign, #1049 branch cleanup (a list for James only; deleting branches needs his explicit yes), #1104 Sunday email, #54 registry identity links. |

## Phase 7: James's own list (no agent work until he answers)

- D17: "Fee Insight Advisory" on /subscribe, /about, /contact and /api-docs (#1174): keep or drop. Default drop.
- D18: free visitors see each fee's range on the national index (#1449): keep or hide. Default keep.
- D19: close #1289. Default close.
- D20: index institution pages that have financial data but no fees (#1043). Default no.
- D21: old drafts #1016, #1011, #810, #811. Default leave open.
- Also yours: pricing (#549), Search Console (#484), the sample market (#552), confirming answer keys (#629, 0 of 117 checked by a person), the three Pro users with Stripe test-mode IDs (#1186), Supabase access (#1228), the business to-dos (#637, #722 to #738), API docs (#1575) and the price check (#1587). Growth and outreach (#497 to #555, #1121) stay parked.
- Defaults kept unless you say otherwise: the sample report stays out of the footer; the /for-institutions primary button stays "See where your fees stand"; Pro guides stay gated.
