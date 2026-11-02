# Changelog

Merged changes in plain language, newest day first (UTC). Written from `git log` on main.
Started 2026-10-05; for anything earlier, see `git log`.

## 2026-11-02 (from 2026-11-02 00:11 UTC)
**Accuracy and data quality**
- **Shadow lab, on the frozen cases (`npm run test:shadow-lab`):**
  - Answer-key fees published 956 / 1,312 at the start of Nov 1 (#2872 receipt). The lab then
    charged each miss to the key's own line and left 10 keys the fold gives no home out, so the
    base became 956 / 1,302 (#2883). Turning on daily-cap lines and dash-list rows made it 964 /
    1,302 (#2885; the 964 is the base in #2888). Knox v161 made it 972 / 1,302, or 74.7% (#2888).
  - False publication stayed 33 / 160 through all three.
  - Seven-state gate 915 / 30 -> 910 / 29 after #2883 (lost reads were all retired-category reads
    Darwin refuses), then 918 / 29 -> 926 / 29 with #2888.
- **Switches turned on** (James's "why isn't everything on" of Nov 2; the sampled-clean rule,
  DECISIONS 2026-10-20):
  - Knox: `DASH_LIST_ROWS_LIVE` and `DAILY_CAP_LINES_LIVE`, golden set better (#2885). The no-charge
    NSF read, Knox v155 and source check v30 (#2884).
  - Darwin: `LINE_CONFLICT_OWN_UNIT_LIVE`, 20 of 20 restores sampled (#2874);
    `ESCHEAT_HOLD_REREAD_LIVE`, 20 of 20 (#2880); five live-fee re-checks (no-fee sentence, overdraft
    transfer, loan NSF, protection item, maintenance frequency) (#2879); `DARWIN_RECHECK_TIER_RULE_LIVE`
    and `TRANSLATED_COPY_RESTORE_LIVE` (#2886); `OWN_UNIT_REFILE_LIVE` and `ACCOUNT_OWNER_REFILE_LIVE`
    (#2881, #2893); the undirected-wire takedown, 6 sampled clean (#2890); left-behind fee link
    release, 20 loan and card documents back to discovery (#2891); the stale-copy twin retire (#2914);
    the comparator re-read (#2889); vendor-folder links (#2875).
  - Rosetta: same-text reopen v2, 20 of 20 sampled (#2887). Magellan: stated-date backfill v2 (#2917).
- **Switches merged off** (each waits on a count or a sample; see the checkpoint):
  - `SECTION_PATH_LIVE` (#2872), `FOOTNOTED_ATM_HEADING_LIVE` (#2892), `HELD_VOCABULARY_RELABEL_LIVE`
    (#2888), `AUDIENCE_V5_LIVE` (#2843).
  - `HOLD_SOURCE_REREAD_LIVE` (#2905), `KNOX_REREAD_BACKLOG_LIVE` (#2913), `DARWIN_HISTORY_CHECK_LIVE`
    (#2915, #2924), `REDIRECT_WEBSITE_PROOF_LIVE` (#2897).
  - Environment switches, prod value not read: `KNOX_FREE_PATH_LESSONS_LIVE` (#2911),
    `KNOX_TWO_READ_AGREEMENT_LIVE` (#2909), `DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE` (#2928),
    `DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE` (#2871), `KNOX_SINGLE_ACCOUNT_OWNER_LIVE` (#2870),
    `DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE` (#2894).
- **Knox:**
  - v150 a bare "Overdraft Protection" per-item line (#2857); v151 a reimbursement is paid to the
    customer, not the fee (#2868); v152 a price per half hour is a part-hour charge (#2869); v153 a
    loan's payment example is never a charge (#2871); v154 agreement boilerplate no longer refuses a
    no-charge NSF sentence (#2873).
  - v156 one account's free-services list is no bank-wide $0 fee (#2894); v158 wires sent outside the
    U.S. without "international" (#2926); v159 an ATM label that opens with the bank's own
    abbreviation (#2927); v160 a worked example's figure is never a charge (#2928); v161 held names
    the taxonomy already places (#2888).
  - A single-account disclosure's fees are that account's (#2870). Free and paid reads of one text
    are compared (#2909), with a two-read check v2 behind a switch (#2918). Lessons that carry a rule run on every free read (#2911). A bounded
    re-read backlog for texts read under older rules (#2913, #2921).
- **Darwin:**
  - Hold re-read v2 (#2923). History check v2 (#2924).
  - Fragment check v9 (#2867). A non-deposit takedown hands the fee link back to Magellan (#2864).
  - Hourly frequency check skips admin-corrected fees (#2859). Pending flags settle (#2861).
  - Release review settled in a transaction (#2856). Stale-copy retire (#2906). Range and peer
    holds re-read from the bank's page (#2905).
  - Tier $0 check v3; international wire check v2 (#2886); international direction check v4 (#2890).
  - Maintenance per-item test: a period right after the fee's own price wins (#2920).
- **Magellan and Rosetta:**
  - A redirect's landing replaces the stored website only on proof (#2897); live-source v2 (#2901);
    barren re-search keeps going (#2908); stated-date reader v2 (#2904); document-owner site rule
    (#2900); refetch requests keep no-copy pages first (#2921).
  - Rosetta kind v2: a fee name with its amount on the next line (#2907). Rosetta records where each
    PDF page starts, so fee citations name the page (#2930, with the schema change in #2929).
- **Deming:**
  - The golden set gates every pipeline PR (#2899); every `*_LIVE` switch replays on it before it
    turns on (#2845). The live-site audit scores each fee against its live page and survives
    version bumps (#2898); the daily redraw cap counts per series family (#2912).
  - The shadow lab charges each miss to the key's own line (#2883).
  - The switch inventory is printed with `npm run switch-inventory`, not committed (#2922).
- **Atlas and tick:** parked publish lanes take at most two of three lane slots (#2865); a run whose
  next step keeps deferring ranks ahead of lanes (#2877); the audience relabel batch is priced at its
  measured 45 s (#2882).

**Public site**
- Fixes from the Nov 1 site check: histogram cents, benchmark 404, future dates, demo preview bank
  (#2931). Which institution the sample report is for is cached (#2933). Peer membership comes from
  the cached fee-publisher list (#2849).

**Hamilton**
- Current-copy re-point v2 switched on (#2925), and a switch-off re-point of live fees to the current copy publish skipped as identical (#2916); Ask answers fee-share screens from filed call-report
  revenue (#2903); only published fees reach the model, briefings, reports and alerts (#2910);
  cites the page and line where each fee is printed (#2919); the writer sees call-report money in
  dollars (#2895); withdrawn CFPB and FDIC guidance shown as history (#2866); competitor alerts
  withdrawn when the competitor goes inactive (#2848); the answer check reads "$35 and 50 cents"
  as $35.50 (#2862).

**Hoovie and data loaders**
- Z.1 commercial mortgages (#2876), CRA ratings (#2878), FDIC national rates and household survey
  (#2896, #2902).

**Project and tooling**
- LESSONS.md keeps no hand counts (#2858).

## 2026-11-01 (from 2026-11-01 16:54 UTC)
**Accuracy and data quality**
- **Knox:** v146 a dollar daily cap on overdraft and NSF fees in every printed shape (#2768); v147
  the price after a counted free allowance (#2831); v148 a dash price-first list adds its label rows,
  behind `DASH_LIST_ROWS_LIVE` (#2834); only a fee schedule's yield sets the expected fee count
  (#2530); v149 and guard v102, a service's own monthly charge is not monthly maintenance (#2855).
- **Darwin:** line conflict v2 stops retiring the read that carries the line's own unit (#2835); the
  ~83 held fees never reviewed are reviewed, releasing none (#2846); audience relabel v5 reads the
  waiting backlog, behind `AUDIENCE_V5_LIVE` (#2843); keeps the line behind every live fee, with a
  "line-traced" scorecard (#2837); a shared host that spells its owner, and a branch city on another
  bank's site, no longer keep another bank's schedule (#2852, with Magellan).
- **Deming:**
  - Live-source audit fits its chunk in the tick (#2836); fresh audit v10 scores the unit, period,
    condition and tier a person reads and measures agreement with James's W43 check (#2840).
  - Five answer-key false exclusions repaired, and a golden set with recall and precision frozen
    (#2838). Answer-key re-key: two independent reads of the 62 confirmed banks, $15 dry run, no key
    writes (#2832).
  - One read-only audit prints every pending switch dry-run count, `npm run audit:switch-dry-runs`
    (#2842).
- **Hamilton publish:** frequency fill v16 stops blanking per-item maintenance fees and the hourly
  flip (#2853).
- **Magellan:** the browser ships `playwright-core`; a browser that cannot start tries no bank (#2830).

**Public site and security**
- Security review fixes: no bulk fee download on Pro keys, buyer's own bank on Plans to check, revalidate
  token is not a cron secret (#2844). Pro is sold annually at today's prices; the monthly plan is
  off sale (#2687). Amazonbot kept off institution pages (#2847). Test lead requests stop raising
  overdue alerts (#2839).

**Project and tooling**
- One slow agent-health read no longer drops every agent (#2841). One-off paid batches get a fresh
  tick (#2851). Hoovie restores the SBA and GLEIF loaders (#2850).

## 2026-10-31 (from 2026-10-31 00:31 UTC)
**Accuracy and data quality**
- **Switches turned on:** six sampled-clean switches from #2072 (James's yes, 2026-10-31) (#2819); the
  hourly catalog sweep (#1070) (#2822); the page-layout $0 evidence with a narrow re-read (#2826).
- **Knox:** v141 numbered account headings (#2812); v142 monthly maintenance is never per item, with a
  Darwin live re-check behind a switch (#2814); v143 no fee from a "no ... fees" sentence (#2816); v144
  a bounced loan or mortgage payment's NSF charge is the loan's fee (#2818).

**Hamilton**
- Answer check reads figures written in words (#2821), counts like "42 banks" (#2827) and "1 point 5
  percent" (#2828); reports, admin chat and the on-screen check read every step's text (#2823, #2820);
  saved answers get a notice when the pipeline takes a fee they used down (#2817). Local report picks
  the same sister-charter representative as the workspace and leaves out inactive competitors (#2824,
  #2825). Gate G7: the paid report and local answers count a shared fee schedule once (#2815);
  gate G9: the PDF claims only what was checked (#2813). Two tests stop timing out (#2829).

## 2026-10-30 (from 2026-10-30 19:07 UTC)
No merges on Oct 28 or 29.

**Accuracy and data quality**
- **Knox:** v138 a declined wire direction line holds each price under its own clause (#2801); v139 a
  fee's own page unit survives a dash, emphasis, its own minimum or a slashed label (#2804).
- **Darwin:** re-reads held escheat processing, behind a switch (#2798); re-files live flat fees to the
  unit their own line proves, behind a switch (#2806); dead same-step takedown and adjudicator
  switches deleted (#2790); current-copy check v4 and v5 read the copy's layout before flagging (#2792,
  #2809).
- **Learning store:** sync-only feedback kinds read on the takedown sync's own key (#2795).

**Hamilton**
- Gates for the written answer and board brief: state fee trend answers fit the note limits (#2793);
  saved answers record the fee rows behind the structure table (#2794); in-app links keep the
  reader's institution (#2796); coverage line says what each screen's fees rest on (#2797); economic
  figures named by their original publisher, never FRED (#2799); each fee in the landscape gets its
  own scale (#2800); board brief prints its answer and exhibits (#2802); Fee categories stamped with
  the national snapshot (#2803); a shared fee schedule counts once in the local market (#2805);
  a combined overdraft and NSF income line names both fees (#2807); regulator enforcement before M&A
  (#2808); this year's complaint count labeled as to date (#2810); shown quarterly financials checked
  against the FFIEC and NCUA files (#2811).

## 2026-10-27 (from 2026-10-27 00:10 UTC)
**Accuracy and data quality**
- **Pipeline wiring ("fix plan"):**
  - Magellan: JavaScript fee pages in slim Chromium, off by default (#2765); replaces links that gave no
    live fee (#2771); site search for missing fee types (#2773); dead-bank link-set memory and a first
    paid try (#2774); refused banks go on the hand-download list automatically (#2777); acts on each
    audit miss once, against its own document (#2764).
  - Rosetta hand-offs: sent-back banks searched first, re-fetch on byte mismatch, clean scans before
    OCR (#2776). Legacy pages and tables caught before reading (#2784). Learning page and outcome
    ledger of live fees per discovery method (#2778).
- **Error loop:** re-runs read, verify and publish fixes and judges each fee on its own document
  (#2775); weekly check's uncaught misses planted, and a miss counts as routed only when its own
  reader reads it (#2781); amount errors judged at the read they flagged (#2783); duplicate and
  wrong-document errors replayed (#2779).
- **Knox:** v133 a plain "we do not charge an NSF fee" sentence, behind an off switch (#2753); v134 and
  wire channel v2 (#2761); read lessons from other checks, behind a switch (#2780); paid reads carry
  the document's lessons (#2782); a percentage charge's minimum or maximum is not a flat fee (#2785);
  business address teaches only fees under a business heading (#2786); a reward paid to the customer is
  not a fee (#2788).
- **Darwin and checks:** layout evidence holds a fee's item price (#2751); fragment check v8 (#2752);
  international wires re-checked against the direction review, switch off (#2762); box late fee judged the
  same everywhere (#2760); card disclosures are not the schedule (#2754); full read clears stale pending
  flags (#2756); category guard v101 (#2759); current-copy check stops reading glued columns as a fee
  gone (#2787).
- **Learning store:** takedowns file under the check that made them (#2772); live name refresh (#2766).

**Hamilton and Foundation**
- Paid gate replay batch of 50 written answers at $25 (#2755); its 10-minute cron removed (#2770); health
  check probes run after the brief's other reads (#2758).
- Storage canary: HMDA sort timeout fixed (#2789); approved storage rollout continued (#2791).
- Oct 22 later checkpoint and changelog (#2763). Diagnosing-bugs, tdd and domain-modeling skills
  added (#2767).

## 2026-10-26 (from 2026-10-26 00:09 UTC)
**Accuracy and data quality**
- **Nine fee fixes James approved (2026-10-26) turned on** (#2715). Darwin opening-document takedown
  turned on (#2683).
- **Knox:** v120 abbreviated international wires (#2677); v121 account-per-column tables (#2678); v123 a
  loan section's rows are loan fees (#2703); v124 "or an" fees (#2711); v125 prices beside a schedule
  heading (#2725); v127 "free with" is a waiver and shifted PDF columns are rebuilt (#2729); v128
  glued two-column prices (#2733); v129 the fee's own line decides its account (#2734); v130 a centred
  heading cell names its whole block (#2741); v131 a payee-returned bill payment is bill pay (#2743); v132
  a commercial lockbox is not a safe deposit box (#2748). Untraced held lines go back to Rosetta (#2728); 'varies' gets an honest owner and the held pile is on the scorecard (#2731); error loop judges a re-run by its extract attempt (#2722).
- **Category guard:** v93 (#2688), v94 (#2709), v97 home equity line NSF is the loan's fee (#2721), v98
  (#2733), v99 (#2743), v100 (#2748).
- **Statistics:** a bank's general price sets its value, a named account's exception stays beside it
  (#2670); a savings or money market account's maintenance fee stops setting checking's value (#2726);
  rule 11 for channel and repetitive wires (#2730); a checking-named fee stays in the checking value
  (#2736).
- **Darwin:** conditional $0 reads page layout, behind a switch (#2676); peer v1/v2 holds stay held
  (#2679); reads holds and corrections filed against verify (#2716); re-check of fees Knox's re-read left
  other_category (#2750); tier disclosures named TIS or T&Cs are tier schedules (#2744); a Spanish-copy fee
  restored when its English twin comes down, switch off (#2707); source check: a price labelled for another
  account is not this fee's (#2739); restore bar reads the same stored-text context (#2745, #2746).
- **Knox learning:** learns from holds, corrections and audit misses filed against extract (#2717);
  answer-key scoring against 85% found / 90% right, each specialist scored on its own (#2732); each paid
  find names what the free team did with its line (#2735).
- **Magellan:** asks whose website a stored website is (#2674); a vendor file folder is one bank's file
  (#2749); learns from stale-price, schedule-conflict and search-miss reports (#2719); a rejected address is
  never the current source (#2740).
- **Rosetta:** restores ligatures a PDF font drops (#2692); an empty HTML table cell keeps its column
  (#2737).
- **Deming:** replays confirmed audience mix-ups (#2720); error classes group by name family (#2724);
  learned answer-key row follows its current key line (#2704).
- **Other:** names rules v9 (#2681); publish keeps a fee's threshold in its name (#2747); a closing note no
  longer hides a cut (#2675); frequency rule treats "per item" and "Per_Item" the same (#2712);
  publish sweeps at most hourly (#2727); one printed line read twice is one fee (#2698); current-copy
  check never judges a fee against an older copy (#2742); a small-overdraft $0 band is not the fee's price
  (#2702); relabel of old hold-release rows, switch off (#2705); Knox product recovery on live fees read
  before ancillary ownership, switch off (#2723).

**Public site**
- Crawlers kept out of the /fees explorer's filter views; they starved institution pages (#2684).
  Institution pages stop waiting on stale site-wide summaries (#2694). README replaced (#2685).

**Hamilton**
- Try a price chart labels on phones and peer group names (#2686, #2690); board brief records table
  (#2693); asset-tier bounds (#2696); interpretation rules cut the sentence they fire on (#2699);
  call-report money in whole dollars (#2700); per-$10,000-of-assets denominator in any wording (#2701);
  per-1,000 income figure dropped (#2697); counted market lines stay within 20 words (#2713); paid replay
  never drops a question it has read (#2714); 10-minute replay cron added and removed (#2680, #2708);
  retired documents matched at the fetch target (#2689); journey test (#2695).

**Foundation**
- Bounded database growth with compact public-data storage and verified archival (#2668), executed with
  exact archive restore checks (#2682) and drained jobs (#2691). CI runs every DB test suite (#2718).
  Hoovie prices heavy registry steps from measured runtime (#2706). Darwin verify-paid is a free step while
  no verdict can act (#2738).

## 2026-10-25 (from 2026-10-25 00:38 UTC)
**Accuracy and data quality**
- **The error loop (Deming, plan steps):** a process fix names its errors and their banks re-run
  (#2561); every error kind names the agent that reads it (#2574); errors grouped into classes (#2576);
  confirmed category-guard takedowns replayed as regression cases (#2578); error classes planted and
  walked through the loop (#2579); every live-check miss traced to the loop that should have caught
  it (#2581); wrong amounts grouped by layout (#2582); holds and corrections name their cause (#2560);
  Deming's audit misses reach their owner (#2558); Magellan, Knox and Darwin learning paths (#2587,
  #2588, #2585).
- **Knox:** v105 and shared check v21, a fee whose own name says FREE never takes the next column's price
  (#2564); footnote glued to a $0 price (#2584); closing parenthetical (#2589); source check keeps a described row whole (#2590); a name cut before its noun is a fragment (#2591); v114 priced noun phrase
  names and files its fee, network-table columns (#2637, #2648); v117 paper statement price (#2655); rate floor is not a flat fee (#2673); short all-caps names (#2597); returned
  payment under a loan title (#2599); a checking account's own named fee is its monthly fee (#2618);
  Draft Protection Fee is overdraft (#2630); fee for an account the bank no longer offers is not current
  (#2634); card sections read as the card's fees (#2653).
- **Category guard:** v85 refundable box key deposit (#2603); v90 (#2639); generic monthly charge (#2601);
  book transfer is not a domestic wire (#2628); non-network ATM refusals (#2595); night deposit exemptions
  (#2592).
- **Darwin and publish:** product page NSF or OD shorthand repeats the schedule's fee (#2600); non-customer
  price (#2645); latest dated edition takes over (#2667); same-line restore follows the replacement
  (#2672); a skipped-lines republish (#2614); restore treats a held twin as present (#2593); account type
  hold records a release as a restore (#2594); opening documents (#2671); box late fees re-filed live (#2622);
  hand takedowns charge a wrong page to Magellan, not Knox (#2588).
- **Magellan and Rosetta:** never takes an article page as a fee source (#2596); saved fee link fetched
  (#2610); stated dates stored, old schedules to the freshness search (#2615); past quarters from the
  certificate that filed them (#2629); reader upgrades re-read every older text (#2620); a reader version
  bump re-reads read errors (#2565); newer copy with the same text keeps its verdict (#2643); unknown glyph
  letters restored (#2649); record-only layout recheck of older-layout PDF texts (#2559).
- **Atlas:** read-now runs carry merged fee fixes to the 30 banks they change (#2638).
- **Other:** edition line read past a web page's menu, switched on (#2573, #2605); Deming V5 retrieval
  pilot shows no holdout lift, so no embeddings (#2641).

**Hamilton**
- **Claim contract, steps 0 to 7 (#1077):** held-out golden set (#2567); fact IDs (#2569); filing figures
  bound to facts (#2571); premises and causes checked (#2572); one answer gate in shadow (#2577); one
  bounded rewrite behind an off switch (#2580); saved claims reach reports (#2583); paid eval scores with
  the one gate (#2586); one switch lets the gate decide on every surface, off by default (#2647), with
  resumed reports re-checked first (#2664); paid replay batch of about 200 samples, hard cap $40 (#2666).
- **Workspace:** peer minimum 5 local competitors, 10 peers elsewhere (#2568); no median below 10 institutions
  (5 local) on My fees and Try a price (#2658); one saved peer group on every screen (#2631); institution
  command center (#2652); monthly briefing a team can edit (#2646); change feed by schedule edition
  (#2650); Ask research workbench (#2654); financial performance over 8 to 12 filed quarters (#2611,
  #2617); daily health check and incident process (#1921) (#2602), per-request limits on paid work (#2660),
  rollback rehearsal (#2662), release proof (#2651); Try a price fee income from the bank's own volume
  (#2636, #2665); persona golden set (#2642) and question replay (#2644, #2656); a filed fee-income change is a claim fact from two filed quarters (#2663).
- **Honest answers:** saved answers keep sources through save and compaction (#2635, #2623, #2627, #2633,
  #2640, #2659, #2563, #2566); omitted text never sent (#2604, #2612, #2609); Ask says it cannot answer
  instead of answering another subject (#2575); a local competitor's price never binds to the subject
  bank (#2621); fee figures need a record of the fee named (#2616); breadcrumb or menu lines never name a
  fee's account (#2626); the daily paid eval feeds the shadow gate (#2619).

**Public site and Foundation**
- Filings reconcile names refiled call reports
  (#2624); financials reconciled with stored filings (#2608); BankFind merger-adjusted quarter shown (#2607);
  one charging basis per benchmark (#2606). Database tests declare custom-typed handles so Vercel builds
  stop failing (#2661). Dead peer brief branch removed (#2562).

## 2026-10-24 (from 2026-10-24 22:34 UTC)
No merges between #2550 (Oct 22, 18:49 UTC) and #2551. The Oct 22 checkpoint and changelog merged as
#2540 (Oct 22, 07:39 UTC). Merged in this window: the migration lock check closes
four gaps (#2551) and catches numbers an earlier open PR claims (#2554); Rosetta records where a PDF's
layout reading and drawing order price a fee differently (#2553); answer-key lines compare as fee content
(#2552); Deming pages corrective replay by key (#2555); hand re-files only touch a fee whose name is
still listed (#2556); Regulatory Wire Refresh queues the loader's run (#2557).

## 2026-10-22, later (from 2026-10-22 07:40 UTC)
**Accuracy and data quality**
- **Shadow lab, on the frozen cases:** answer-key fees published 916 -> 946 of 1,312; names that
  match the schedule 287 / 317 -> 315 / 319; seven-state gate 877 -> 909 right, 34 wrong. False
  publication started the window at 25 / 127; the base widened to 160 when #2544 added the live
  audit, and it stayed at 34 / 160 after that. The ratchet lost nothing.
- **Deming:** James's W43 live audit replays as a shadow-lab scenario, with a name score (#2544).
- **Knox:**
  - Second wave: every stored copy last read before v97 is read once more (#2542).
  - v98 drops a condition glued before a fee's name (#2543).
  - v99 names a bare box size as a safe deposit box (#2545).
  - v100 reads every priced tier of a relationship-tier row (#2546).
  - v101 files held names read at the right price (#2547).
  - v102 reads a two-column line's fee that its column heading names (#2548).
  - v103 reads stacked sibling names at their stacked prices (#2549).
  - v104 cuts a sentence glued onto a fee's name (#2550).
- **Darwin:** guard v81 verifies returned check deposits and escheat processing (#2541).

## 2026-10-22 (from 2026-10-20 07:47 UTC)
**Accuracy and data quality**
- **A loop that only moves one way:**
  - The shadow lab replays frozen sources stage by stage (#2536).
  - The ratchet gate stops any change that loses a correct fee or lets a refused wrong one back
    (#2537).
  - First round, on the frozen cases: answer-key fees published 902 -> 916 of 1,312, and
    known-wrong fees published 34 -> 25 of 127.
- **Knox:**
  - v97 reads schedules flattened to one line to their end (#2538).
  - v92 reads rows priced in words (#2467).
  - Re-tidy v26 cases all-caps names; rules v96 reads marked account headings (#2529).
  - NSF Paid/Returned pairs (#2476).
  - Never takes a neighbour's or the other column's price (#2465, #2522).
  - Re-tidies marked names (#2524).
- **Darwin:**
  - Reads an hourly price at verify (#2539) and bare hour units in the live check (#2526).
  - Takes down product-page repeats of a schedule line (#2527).
- **Other checks:**
  - Category guard v80 (#2528).
  - Fees from schedules not yet in effect are held (#2523).
  - Fax and cut stop payment filing (#2470).
  - Duplicates graded on the closed line (#2479).
  - Answer-key scoring restored (#2468).
  - Newer-copy v2 merged and reverted (#2478, #2489), then #2496.

**Public site**
- Price check tool (#1587), peer-set explorer (#1779, #2509, #2510), institution market position (#1887).
- Thin institution pages stay out of search (#2517). Freshness and build fixes (#2480, #2491, #2502, #2507).

**Hamilton**
- Review lines (#2484, #2485, #2486, #2490, #2492, #2493, #2497, #2500, #2501, #2504, #2505,
  #2506, #2512).
- Billing and report access (#2518, #2520, #2521). Hosted report tokens from env (#2519).
- Revenue API v1 restored (#2488, #2499). PDF attribution without the em dash (#2483).

**Project and tooling**
- One lessons index (#2471, #2475). Roadmap handoff files reverted (#2472).
- Vercel preview and build-skip fixes (#2494, #2503, #2508).
- Precomputed call-report readers (#2514, #2515). Atlas wake budget (#2487, #2498). Hoovie UBPR file (#2474). Foundation fixes (#2511).
- Migrations: search_path pinning (#2513) and redundant index drops (#2516).

## 2026-10-20 (from 2026-10-19 20:00 UTC)
**Accuracy and data quality**
- Switches on after a clean sample: Darwin's take-over proof and Knox's range-band set-aside (#2442), Knox's held-name rules (#2445), the hourly line check and hand-takedown returns (#2436), product-page conflict takedowns (#2456).
- Knox scores promoted held rates from their line (#2432), files returned statements as returned mail (#2454), and reads stale pages before a large bank's repeat (#2423). Category guard v77 and v78: credit-card-only card fees and account verification (#2389, #2449).
- Restores need a name-first line, the bank's current document and the name and price on one row (#2443, #2457, #2462); product-page conflicts judge the same item and only lines that can speak against the page (#2440, #2447).
- Admin-corrected fees stay live against agent takedowns and frequency fill (#2433, #2435).
- Magellan stops accepting product pages as schedules (#2438); accepted links join the bank's documents (#2427); saved-link fetch keeps only real fee pages (#2446); live fees' pages are re-fetched oldest first and moved off pages the bank moved away from (#2460, #2463).
- Rosetta gives every stored text a document kind and verifies captured bytes (#2428, #2401); Darwin recheck decisions are atomic (#2372); corrective cases bind to retained evidence (#2414); international wires need own-source direction (#2386); exclusive audience from the fee's own price clause (#2374); publication waits for required evidence (#2352).
- Agent lessons: fixed issues become lessons (#2431, #2437); every finding names its guard or lesson (#2439, #2444, #2448, #2455, #2458); a monthly agent health report (#2441).

**Public site**
- Reports pages, cached /about, /guides and /contact, site audit fixes, the research-brief template, the market report layout and the institution page overview with one connected panel (#1935, #1936, #1960, #1732, #1736, #1864).
- Public counts leave out inactive institutions (#2390); one address per city (#2396).

**Hamilton**
- Saved simulations keep their institution and fee (#2413); bank and credit-union comparisons are separate (#2353); income peers use filed financials without inactive institutions (#2391, #2398); historical peer cohorts (#2411); source-qualified research (#2422); #2426, #2384, #2385, #2399, #2402, #2452, #1762, #1771.

**Project and tooling**
- Migrations 069 to 074: legacy event-log RLS (#2377), two indexes (#2450, #2451), legacy partition drops (#2453), call-report summaries (#2459), FDIC identity holds and HMDA repair with release flags off (#2253).
- Unreferenced code and runtime schema creation removed (#2403, #2434, #2387, #2394); vault measurement, deletion off (#2430); paid items stay open on a billing refusal and settle only after calls finish (#2464, #2400); CFPB and SEC identity review (#2425); NCUA merger lists (#2307); Hoovie fetch is not load (#2412); roadmap (#1597).
- Also merged: #2308, #2357, #2383, #2395, #2421, #2376, #2378, #2429, #2461.

## 2026-10-14
**Accuracy and data quality**
- Knox no longer shows its internal extraction note in a fee's conditions on any customer page, API or report (#1278).
- Fee audience: Knox suggests and Darwin decides each fee's audience (#1253); the classifier leaves a fee unknown rather than guess from a one-audience heading in a mixed schedule, reads "Non-Personal" as business, and never gives a business schedule the consumer default (#1281, #1288, #1292). Stored audiences change only after James's migration and relabel.
- Knox keeps a dropped decimal point's cents ("$15 00", "$1 50*", "$29. 95") (#1307, #1310); a re-read that changes a fee's category drops the old one (#1291).
- Hamilton keeps "ACH Stop Payment" and "Stop Payment" apart when the page prints both (#1314); a near-name duplicate collapse is built, switched off (#1316).
- Darwin: a Knox category change is a reason to judge a row again, switched off (#1296); rows due again after a rule change wake their state's lane (#1313).

**Discovery**
- Magellan's bank-name check matches whole words and needs the city for a shared name (#1298); paid searches cover the bank's other own hosts and paid answers must name the bank (#1282); disclosure index pages have their documents checked, and unreachable links are retried at other spellings, on the bank's own domain only, real PDFs only, with a hard timeout and size cap (#1293, #1308, #1311).
- On another bank's host, a cert number counts only next to FDIC/Cert/Charter/NCUA, and a name inside another bank's name counts as shared (#1315). New credit unions keep their full city instead of NCUA's 15-character cut (#1317).
- The coverage-gaps query runs in 0.3 s instead of 3.9 s (#1277).

**Project and tooling**
- CI: every test runs once in parallel jobs, about half the wait (#1300); a hard-document gate every taxonomy, guard or same-line change must pass (#1290); a merge needs a submitted review of its exact head (#1241).
- Build plan: data quality before the Hamilton redesign (#1276).
- Also merged today (earlier lanes): #1233, #1235, #1237, #1239, #1240, #1243, #1244, #1246, #1247, #1248, #1252, #1257, #1258, #1261, #1263, #1262, #1265, #1270, #1272.

## 2026-10-11
**Accuracy and data quality**
- Fee 92156 re-filed as a safe deposit box fee, and escheat fee 59791 hand-checked for takedown (#1020, port of #973).

**Public site and Hamilton**
- Hamilton H01 and H02: the researched institution stays separate from the account's own institution across Ask, saved answers and PDFs; peer lists carry dated assets and can be saved and reopened (#985).
- Hamilton H06: saved storyline answers keep record-bound evidence, and figure-only checks no longer rate an answer high confidence (#995).
- The public institution directory binds its fee-category filter correctly again, fixing a 22P02 error (#1017).

**Revenue and leads**
- Payment reliability: billing reconciliation, persisted checkout intents (migration 42) and a durable payment email outbox (migration 43) (#991).

**Project and tooling**
- Report templates and Atlas crew no longer import each other in a cycle (#1009); pipeline acceptance fails on missing-object errors instead of passing (#1015); run parameter parsing moves out of the agent ledger (#1013); Hamilton release evidence matrix and fixtures (#996); Checkpoints 2026-10-09 and 2026-10-10 (#1019).

## 2026-10-10
**Accuracy and data quality**
- Pinnacle fee audience integrity: consumer and business fees kept apart, with migrations 40 and 41 (#986); a source-reviewed second look for Pinnacle's duplicate overdraft rows (#998).

**Pipeline**
- Crew runs execute again, and Hamilton publishing can be scoped (#994).

**Project and tooling**
- Branch preview builds are skipped (#972); clean, merge-ready PRs get standing merge authorization (#992).

## 2026-10-09
**Accuracy and data quality**
- Category guard v47 to v60: Darwin's Oct 8 eval misreads (#740), treasury, merchant and sweep charges leave monthly maintenance (#745, #824, #922), business wire prices leave consumer wires (#792), price ceilings catch dropped decimals (#786), free own-ATM lines and box late fees (#805), cross-page price rule (#845), returned bonds and coupons (#898), optional add-ons are not monthly maintenance (#919); the guard re-files a misfiled fee in place instead of taking it down (#954) and brings a takedown back under its fold type (#863); the limit guard ignores a check's amount and cut conditions (#949); Knox gate floors follow fax moving types (#817).
- Fold rules v4 to v14 move fees to their right types: mortgage subordination, money order copies, domestic ATM lines, night drop keys, box late fees, IRA transfers, lien releases, prepaid cards, returned statements, fax and copy fees, checkbook reconciliation, ATM adjustments, cross-border bundles (#741, #749, #779, #783, #794, #809, #818, #828, #833, #843, #848); express cards come back as rush card fees (#870).
- Knox v49 to v64: the account each monthly fee belongs to, with its balance to avoid, waiver and opening deposit (#747, #765), per-item-paid rows (#750), long table rows (#838), thresholds kept and column labels dropped (#842), wrapped leader names, per-wire lines and former-fee columns (#861), box sizes are not prices (#872), sideways box tables (#892), lineups never read from a neighbour (#827); retired lines a re-read lost are read again (#882, #918, #927, #953, #964); $10B+ banks with no overdraft fee are re-read once per rules version (#846, #876).
- Fee names: retidy v6 to v17 (#790, #851, #862, #868, #888, #903, #911, #924, #933, #946, #955, #961, #965), the tidied name publishes when only the raw name fails (#753), publish keeps thresholds and conditions (#797, #862, #952), and a rate fee's minimum or maximum is not the fee (#869).
- Frequency fill v3 to v10 (#742, #773, #786, #801, #805, #840, #845, #880); every live fee is re-checked on the first tick after a guard or frequency bump (#801).
- Darwin: release review v17 (#790), account research floor and frequency from the fee's line (#803), not-in-source rejections re-read once (#883), conditional $0 fees held and rechecked (#928, #944, #951), holdout misses never become lessons (#871).
- Hamilton: current-copy check reads renamed fees and waivers (#767, #793), takes down fees whose name states another price (#814), keeps the clear line of a repeat (#930), same-priced lines told apart (#887, #895, #902, #920), rules re-check takedowns wait 12 hours (#897), never restores outside the top 50 (#925), product-page $0 benefits taken down (#835, #859, #866), older editions give way to newer ones (#865, #867); whole-record misses fixed for page-text product names and mixed schedules (#841); the rules re-check walks the oldest-checked documents first (#916).
- Second looks: a flagged fee's page is re-fetched first (#808); an audit row per event and 378 first looks rebuilt (#830); a second restore is its own feedback row (#884); a fee pending takedown hides once a newer read replaces it (#777).
- Eval verdict v2 to v7 (#752, #771, #823, #886, #891); hand re-files and takedowns of misread live fees (#935, #943, #947, #950, #956, #957, #966, #967); source check keeps a fee whose line a re-read lost (#968, #969); fold clears the re-check flag on hand-fixed fees (#970).
- Quality agents: Deming test cases, severity scale and takedown-to-regression gate (#875, #881), a daily fresh audit of 200 live fees against the banks' own schedules scored on the whole record (#937, #948, #960); Bayes ledger of what each rule change still has to reach (#885, #899); Agents > Quality page (#912); six PRD evaluation skills (#900).

**Pipeline**
- Magellan: companion search and classifier training get their own time each step (#748, #754, #778); hand-found pages first in the paid queue, refused and timed-out links go to the paid fetch, same-name bank links refused (#795, #812, #821, #831, #860); hand-found links for Bridgewater, Dacotah, First United, Regions, Arvest, Old National, First Mid and $10B+ banks (#746, #763, #766, #807, #821, #826, #849, #850, #856, #874).
- PDF layout v4 reads a dot-leader list beside a table (#858); SCCU's dropped fees recovered (#892); First Mid recorded as a coverage gap because its host refuses every fetch path (#894).
- Recovery reruns priority bank runs that failed on a fixed break (#762); the provider stop trips on the Console usage limit (#906); Atlas truth, roster and schedule checks (#890, #926, #932).

**Data coming in**
- State bills: logged rejected hits, tax penalties kept off fee tags, latest committee date (#764, #837, #917); Congress bills shadow reasons logged (#836); mortgage escrow rules kept off Federal Register fee topics (#825).
- Sent email logged in Postgres with Resend delivery events (#857).

**Database and speed**
- Faster reads: business-schedule check, revenue trend, fee categories, coverage cache, public counts, directory search, peer ranks per peer group (#770, #804, #815, #822, #829, #844, #915, #940, #942, #958); consumer guides no longer prerender at build time (#839).

**Public site and Hamilton**
- Regulatory Wire stages 1 to 3: one Wire for Federal and States, research panels, fee data links, watched states and a weekly digest (#633, #644, #651, #879, #901).
- Pro: Ask box in the page and the full width (#854, #904, #907), checking lineup beside peers (#751, #941), compare fees only with peers charged the same way (#873), "This month" and "Try a price" (#877, #921), paused-answer wording on a provider limit (#908, #938), grouped money figures (#769), shorter and neutral answers (#756, #776, #816, #834).
- Site: one 1,600px container (#914), paragraphs capped near 75 characters (#931), sign out that always works and a reworked account page (#889, #923), the six public-site audit fixes (#759), price check page with a county map (#743, #896, #910, #929), subscribe page with Hamilton examples (#878, #945), sample report fixes (#785), display names (#781, #772, #787, #820, #847).
- Benchmark export and API list rate fees (#758, #819); excess withdrawal fees in account research (#800); competitor alerts withdraw an alert whose change no longer stands (#832).

**Revenue and leads**
- Pro checkout asks for a card only when money is due (#852); Pro stays on while another subscription is live (#757); a refunded report closes its link (#959); revenue snapshot counts by institution id (#739); Stripe webhook check judges enabled endpoints only (#934).
- Marketing: daily dry run and EDISON's price check (#707), BERNAYS press pitches (#775), DRAPER's Monday plan (#789), quote drafts for qualified leads (#782), credit union campaign (#774), stale drafts withdrawn by the tick (#913), contacts confidence, splitting and ranking (#744, #768, #962), daily contact finder (#893), Search Console in the growth score (#791), SHERLOCK script fix (#971), outreach summary and market links (#799, #813).
- Market coverage: competitor coverage, market gaps and covered markets (#788, #796, #798, #802, #806).

**Admin**
- Admin audit fixes (#755), top-10-per-state hit list (#761), phone review of Knox, Data and Customers (#853, #855, #905), City National two-column flag (#864).

**Project and tooling**
- Checkpoint 2026-10-08 (#721); findings move to one file each so parallel PRs stop conflicting (#780, #784); backlog control: inventory, duplicate-work checks and shared agent rules (#987).

## 2026-10-08
**Accuracy and data quality**
- Darwin's held-fee release turned on with review v11 (#472), tightened in v12 to v16 (#479, #562, #683, #688), then paused while it publishes its RDI re-files (#677). Hamilton archives the 11 critical fees from the 211-fee eval, plus rebates and "no fee for" sentences published as fees (#714).
- Category guard v21 to v44: small returned checks are RDIs, not NSF (#479, #538, #542); statement, photocopy, notary, card, ATM card, rebate and savings-limit lines leave the fees they were misfiled under (#547, #565, #600, #659); overdraft worked examples, waiver thresholds, page text, protection transfers and per-item notes are not the overdraft fee (#580, #640, #662); a combined or paid NSF price is the overdraft price (#663, #684); daily-cap notes, rush cards, early-closure and module fees (#668, #665, #670, #673, #676); more misfiles (#679, #682); an add-on rate is not the price (#678).
- Knox v34 to v46: footnote numbers and wrapped names (#545, #563, #630, #643), one-time sentences with a daily cap (#648), threshold cells and Privilege Pay (#650), "Paid Item Fee" and state leaders with no overdraft fee (#653, #661, #666), held lines not renamed onto existing rows (#672), wrapped fee paragraphs (#705); its lessons query runs in 4 s instead of 53 s (#704).
- Accuracy fixes: sustained overdraft charges, bare card names and filler lines (#583); Hamilton repairs cut-off and doubled names (#598), drops leftover footnote numbers (#641), supersedes a fee only by a newer copy of the same page (#591), and counts fees the current page states in another layout (#471).
- Frequency fill for live fees and Knox v44 frequency (#686).
- Taxonomy: the top 50 fee types with every fee folded in (#560, fix #569); the 248 fees with no home archived after their second look (#624); Collection Items gets its own type and International ATM & Card merges two (#701).
- Never publish another bank's fee schedule; the 308 fees from another bank's document come down (#691).
- Fee changes count only changes that compare one schedule with itself (#700, finding #581), and drop a change once its new price is taken down (#718); competitor alerts read the change pair publish recorded (#716).
- Answer key admin shows the person-checked count (#634); the gold standard queue shows hand-given schedules (#575).

**Pipeline**
- Hand-found fee schedules for top-10-by-state institutions and $10B+ banks (#473, #586, #609, #611, #626, #628, #638, #715), fetched on the next lane of any state (#695).
- Rosetta re-reads one-line PDF texts (#615) and reads PDFs whose embedded text is noise (#657).
- Overdue state lanes run longest overdue first (#570); lanes woken by a recovery rerun go first (#587).
- Recovery: alert on a failure streak and rerun failed lanes once a fix deploys (#572); a lane is starved only past its freshness target (#660); alerts keep flagging a break after one lone success (#711).

**Data coming in**
- Census vintages load as soon as a key is set (#573), and a no-key vintage shows as skipped (#561); CPI relabels every row of a mapped series (#480); the CFPB loader retries 403 and 429 (#559).
- CFPB and SEC identity review: auto-accept clear bank names, reject non-banks, bulk decide (#578, #594).
- Regulation tracker: state regulators' news and state fee bills (#568, #574, #579), read again once live (#625); groundwater and non-banking bills dropped (#656, #667); overdraft wording judged per sentence (#674).
- Account lineup comparison read model (#699).

**Database and speed**
- The 6543 pooler accepts connections once `idle_session_timeout` is skipped (#632).
- Sitemap served from cache and city pages in one query (#576); local competitors answer reads at once (#571).

**Public site and Hamilton**
- One shared report look across every report, plus state visuals, market study and merger screen (#447); competitor alerts, regulatory watch and Pro answers moved onto it (#474, #475, #478).
- Pro redesign: Ask Hamilton as a conversation, Reference pages on the memo look (#649); Pro bug fixes, header search, account menu and the nav on first paint (#622, #639, #645); Regulatory Wire in the Pro nav and lined up with the other Pro pages (#618, #623, #687, #690); state news on the Pro news page and State report (#596); wording that names the institution (#582, #606).
- Hamilton: memo room and the PDF on Ask answers (#620); a studies page with a fee dependence chart (#592); every bank placed in its studies on the briefing (#588); stored studies rebuilt when data moves (#593); the quality bar runs daily on live institutions (#642); live answer eval fixes and shorter storyline lines (#654, #664, #675); fee complaints in regulation answers (#697); every Pro question kept and replayed in the eval (#706); whole-schedule and income questions answered (#709).
- Pro recurring features (alerts, briefing refresh, Monday digest) reach the bank a reader saved (#702).
- SEO: Search Console tag (#564), llms.txt and link previews (#577), bank pages link city, state and district pages (#584), IndexNow (#613, #646), lowercase redirects and state share images (#698); research articles render lists and tables (#601); the sample report drops a stale count (#689).
- Fee Insight LLC (Washington) named as the legal entity, with a trademark notice (#536).

**Revenue and leads**
- Pro in three tiers by institution size (#566), one plan for up to 5 people (#543), tier follows the organization in the terms (#607); report "from $300" with an invoice option and buyer-picked Pro band (#621); /pricing redirects to /subscribe (#712).
- Checkout and billing: visible errors, prefilled paid bank, owner seat at payment (#585, #589, #590, #605, #614); password reset, plan details on /account, 14-day annual refund (#602); plain-language account page (#617); free reports lead to the paid offers (#567); Pro copy matches the live offer (#595).
- Stripe: webhook records events (#541); admin checks for the customer portal, Privacy/Terms links and webhook events (#612, #616, #627); a $0 checkout with a 100%-off code activates Pro (#693).
- Marketing loop (GrowthOS): skills and product context (#476), phase 0 and 1 (#537, #539, #540), /admin/growth approvals (#544), contact finder and weekly growth schedules (#619), outreach plumbing (#636), decision-maker contacts (#652, #655, #658, #671), quoted fee lines (#681), small-metro comparisons (#680), the A/B/C pilot that withdraws 21 held drafts (#692), a real dry run with day 6 and 13 follow-ups (#708), and drafts only for campaigns James approves (#717).
- Marketing agents: ERNEST weekly fee articles (#603, #610), fee-depth posts (#599), article previews (#608), SHERLOCK market brief and NORMAN funnel check (#703), SHERLOCK files only recent releases (#710), MURROW skips subjects James skipped (#713).

**Admin**
- Simpler admin: short Today page, More fold, working Health and Learning (#546); Market folded into the Fee catalog, then the local-market screen (#597, #604).
- Hit list of the largest institutions not shown, with a paste-a-link box (#477); email check shows the From address, domain status and send error (#631); confirmation email fix (#647).

## 2026-10-07
**Accuracy and data quality**
- Takedowns get a second look, a decision log and a way back; nothing is deleted (#324, #320); Knox holds re-reads of fees a second look confirmed taken down (#393).
- Knox rules v23 to v33: labeled fee cards, two-column headings, one-line PDF schedules kept whole, limits and rebates are not prices, run-on names tidied, plural wires, overdraft fees named from their heading (#307, #304, #318, #326, #332, #342, #350, #358, #404, #455); held fee groups fold into existing categories and are set aside, never deleted (#321, #336).
- Knox learning: the lessons query loads again (#327), calibration learns only from real misreads (#337), lessons learn from restores (#353), error reviews every 500 reads (#418), answer-key gate floors raised (#346); live run-on names re-tidied with the old name kept (#402); 44 Tennessee banks below the 3-fee bar re-read (#423).
- Source check v5 to v12: stops taking down real prices, refuses "per $100" flat fees, reads two-column pages, box-size grids, wrapped prices, semicolon splits and "up to $X" maximums, and restores wrong takedowns (#309, #341, #367, #379, #381, #387, #412, #428, #458, #466).
- Category guard v13 to v19: loan late fees and overdraft-protection transfers aren't overdraft, a stop-payment removal isn't a stop-payment fee, only inactivity fees count as dormant (#304, #309, #361, #417, #457, #464).
- Darwin verifies current-copy fees with two looks before a reject (#316); its held-fee release review goes from v5 to v10, learns from takedowns and restores, reads the schedule rows around a fee, scores itself against the answer keys and fills short lists from other states (#338, #347, #351, #354, #360, #392, #406, #419, #439, #448, #462, #465, #467); its paid pass runs in hourly backlog runs (#469).
- Hamilton moves live fees to the current copy of their page (#311) and gives stale-copy fees, article pages and unchecked restores a second look (#403); pages keep their readable copy when a newer one is a bot check (#315).
- Business-only fee schedules are left out of benchmark statistics (#366); the hand-keyed answer keys are loaded on prod (#415).

**Pipeline**
- Magellan: knows "Schedule of Charges" and a bank's corporate domain (#310); reads hand-found schedules for the largest banks (#312, #363, #365, #414, #443); paid schedule search and a paid fetch for blocked sites and timeouts (#314, #323, #444, #454); one current copy per page across address spellings (#323, #340); learns from every link and stops treating business schedules as consumer links (#348); stops re-paying for schedules that never open (#362); searches weak links sooner and reviews its errors every 50 links (#395); refuses foreign schedules (#426); seeds hidden banks (#319).
- Each state's top 15 market leaders: a shared ranking (#355) that Magellan searches first (#356) and Atlas runs first (#359).
- Rosetta: text PDFs to the paid pass (#331), OCR reads scanned pages upright (#371), follows schedule links without a .pdf ending (#398), reads embedded PDF viewers (#409), reviews every 50 reads (#413, #432).
- Atlas: lane priority scores fixed (#308); queued lane runs capped and run by priority (#344); daily passes only for real backlog (#397); a direct path for hand-found schedules and big-bank overdraft gaps (#378, #408, #421, #429, #434, #438); Tennessee's lane runs next and holds its place (#431, #446, #456, #460); paid-fetch documents read without waiting for their state (#463).
- The agents tick starts steps whenever they fit and retries failed lanes first (#368); registry loaders retry once a fix ships (#445).

**Data coming in**
- Bank overdraft and NSF income from the FFIEC call report (#369, #386, #399); readers use only FDIC and NCUA financial rows, and the real CPI bank services series (#440).
- Census household income and IRS ZIP income (#377); FOMC minutes and the 12 Reserve Banks' publications (#380, #382).
- Credit union branches from the NCUA file with Census geocoding (#313); Fed districts taken from FDIC, with credit unions given nearby banks' district (#330).
- Regulation tracker in shadow mode: Federal Register rules, Open States bills and Congress.gov bills (#352, #374, #376, #384, #437); OCC and Fed enforcement actions (#372, #401, #410, #420) and state enforcement orders (#427, #449, #453, #459, #461).
- Checking account lineups: product, balance to avoid the fee, opening deposit, waiver (#433).

**Public site and Hamilton**
- The Pro page is reworked into a neutral decision-support workspace (#89), with custom peer groups, team seats and a charted competitor answer (#435); the engine follows the bank's own peer group (#452).
- Hamilton engine 1.8.0 to 1.10.0: fee positions and option prices (#317), regulators (#333), a missing fee never reads as no fee (#349), "Where do we stand on every fee?" (#375, #390, #394, #400), why fee income sits where it does (#385), FOMC and district Fed citations (#396), chart-ready figures (#411); voice 3.5.1 says lower/higher, never cheapest (#373).
- Hamilton studies layer: fee dependence, price studies, inferred items paid (#388, #407, #468); a 30-question quality bar scored in CI (#383).
- Hamilton answers: whole-sentence titles and clean Evidence rows (#389), designed visuals (#416), a multi-page briefing PDF with charts, economy and local market (#391, #405, #424); written answers cached and saved on the server (#442, #450, #451).
- Hamilton reports: answer first, local competitors, regulation, dollar sensitivity (#93); audit fixes for advice, units and wording (#329).
- Free-to-paid path: live sample report, peer rank, branch footprint and fee income (#306, #328); branch card with credit union offices, a map and nearby competitors (#335); the report rule falls back to Fed district peers (#302).
- API and connector: branch locations and local market competitors (#305).

**Revenue and leads**
- Pro watchlist fee alerts and Monday digest, sending off (#325); fee alerts and the digest count only real price changes (#334); in-app competitor change alerts and quarterly briefing snapshots (#364, #422, #430).
- CFPB fee complaints benchmarked against peers (#425); content queue with weekly and fortnightly drafts (#345).
- Market report title-cases city names (#343); the scoreboard records the report-ready count (#322).

**Admin**
- Admin Today stops false "overdue" cards (#357); Generate is never silently off (#370).

**Project and tooling**
- Checkpoint for 2026-10-06 (#303).

## 2026-10-06
**Accuracy and data quality**
- Knox rules v9 to v22: prose monthly charges, caps after a price, item-amount overdraft tiers, price-first rows, free allowances not read as $0, held lines re-read with today's rules, low-balance fees, wire directions, large banks' overdraft layouts (#184, #188, #190, #207, #224, #236, #251, #256, #258, #260, #270, #297); footnote numbers dropped from fee names (#162).
- Knox learns: a learning reader from its corrections (#286), per-bank memory, weekly labels and shadow calibrated confidence (#300), and it reads only the current copy of a page and retires older-copy rows (#294).
- Darwin checks each fee against the bank's schedule (#200), re-files fees named for the neighbouring category (#205), adds a learned category check in shadow (#216), learned price ceilings and a peer check (#259), a Claude review layer in shadow (#234), and a held-fee pass that acts on rejects only (#281, #287).
- Source check v3 re-checks every institution with the current reader, runs in every publish step and reads more layouts (#195, #208); an alert fires when a state's live fees go unchecked (#202).
- Category guard v8, v10, v11 and v12 (#197, #272, #280, #301), and every Hamilton publish step runs it (#290).
- Percentage fees publish and show as rates, never pooled with dollar medians (#278, #283, #284, #285).
- Daily overdraft caps are read (#271); fees a bank removed from a newer copy of its page are retired (#264).
- Other fees kept out of overdraft and NSF (#179, #181); deposit bag prices kept out of night deposit (#165); false price changes from fees listed twice stopped (#197).
- Banks with fewer than 3 live fees are hidden until they have 3 again (#215).

**Pipeline**
- Magellan: real fee links, site search, a paid pick and an outcome ledger (#221); learned paths and a fee-page classifier in shadow (#231, #240); dead links back to discovery (#203); websites for institutions with none (#261); one current document per page (#265); keeps searching past non-consumer pages (#274) and re-searches documents dated years ago (#299).
- Rosetta: free JavaScript fallbacks for script-loaded fee pages (#206, #253), Word schedules read for free (#243), capped repeat download failures (#242), and it learns from whether its texts' fees stay live (#257).
- Fees spread over several pages per bank are found and read (#196); companion pages skip HELOC and derivatives documents (#223).
- Atlas schedules by where the work is and closes its audit gaps (#262); lanes stop looping and idle lanes re-check within 12 hours (#204); queued report runs go before the pipeline backlog (#192); month-old fee links re-fetch hourly (#193).
- One shared learning store for every agent (#213, #228); a daily health check for every agent, compared with yesterday (#210); each agent gets its own Anthropic API key (#209).
- False Crew alarms stopped (#174); the live board shows real counts and Knox's free fees (#155, #180).

**Database and speed**
- Hamilton workspace and NSF income migrations renumbered above prod's latest (#186); the already-applied 20270108000000 file added so Supabase deploys run (#189).
- NCUA overdraft and NSF income read (#173) and stored as null, not zero, when no credit union reports it (#250); single-quarter income uses each credit union's own quarter (#232).
- State, district, directory and benchmark medians and API fee summaries read the shared public snapshot (#167, #176).

**Public site and Hamilton**
- Hamilton engine: observations, scenarios and plans (#170), every market layer and the bank's own filings (#199), peer income medians (#211), versions 1.3.0 and 1.4.0 with four roles in every answer (#226, #238); "consultant, not restatement" (#164).
- Hamilton Ask: one question in, one answer out (#244), segment answers with named institutions (#263), answers as a storyline (#266, #267, #275), a checked memo (#277), saved analyses (#282), short copy said once (#298); bank uploads, watch conditions and the ledger (#247); "Turn this into" deliverables (#248); Pro reports lay out decision points, never a raise/hold/lower move (#246).
- Reports: the State Index PDF and a deeper National Fee Index (#220, #254); the state's own figures (#219); regulation, enforcement and complaints (#225); reports state only what the data shows (#194), and the briefing and Monthly Pulse count only confirmed fee changes (#235); one report rule shared by the grid, quote check and admin count (#182).
- Paid institution report: a source for every figure (#269), keeps the numbers the buyer paid for (#273), and opens with an at-a-glance view (#291).
- Institution pages: growth, peer rank, outliers and hidden call-report figures for Pro (#157); credit union net worth shown as a percent (#156).
- Public pages: accurate privacy policy and no brand pairing (#245); methodology drops claims the code doesn't back (#249); Pro shows no made-up figures (#288); funnel copy fixes (#171, #178, #201); fee catalog bars open the banks behind them (#181, #191).
- API and MCP connector so AI assistants can query the API (#169), then ranking, size and city filters, revenue trends and fee changes (#292).

**Revenue and leads**
- Institution report paid by card through Stripe (#239); request form takes optional state and competitors, with an unpaid-quote reminder (#255); requests record their institution on arrival (#276) and store their ready-to-quote line (#212); James is told whether a report can be built, and nothing sends automatically (#107).
- Monthly marketing agent with state editions and MailerLite unsubscribe sync (#230), matching the site's medians (#268), one email a month per reader (#296); email program reads the live national index (#177); branded email layout (#218); confirmed readers get free reports without retyping their email (#279); signups never touch request rows (#175).

**Admin**
- One console with six rooms, a Needs-you home and a 7am morning brief (#214); Learning screen, Pro accounts, sent-email log and search (#217); works on a phone (#229); one menu per screen (#237); Hamilton reports and articles pages no longer crash (#185).

**Project and tooling**
- Checkpoint for 2026-10-05 (#168); project notes on report pricing, district format and paid tools (#172, #183); NCUA zeros finding (#252).

## 2026-10-05
**Accuracy and data quality**
- The source check reads each price on a multi-fee line as its own fee and restores correct fees version 1 took down; a tiered overdraft counts at its highest tier (#132).
- The rules re-check re-extracts fees the new rules read and keeps one copy per fee (#125).
- Institutions are no longer labeled "verified"; the directory and profiles show "N of 15 headline fees published" (#126, #131), from a per-institution headline coverage count (#129).
- Knox: a declined debit-card overdraft is not an overdraft fee (#121).
- Live fees the bank's own schedule doesn't state are taken down; imported fees are relinked to their stored schedule first (#119).
- The category guard stops hiding real paper-statement and ACH stop-payment fees (#118).
- Knox never takes a tier threshold in a label cell as the fee (#114, the Texar $50.01 error).
- Hamilton re-checks live Knox fees against today's rules (#103).
- Live fees whose category isn't in the fee taxonomy are rolled back (#94).
- Transfer, per-day and threshold rows are kept off the overdraft and NSF pages (#99).
- Knox fixes for category mistakes found on Texas holdouts; 96.5% offline on a fresh set (#91).
- Hamilton records a price change only when the price really changed (#78).

**Pipeline**
- Bulk fill: free discovery runs every hour and every state with many missing links runs daily full passes (#154).
- Each pipeline tick uses its full time budget (#149).
- A failed run's queued steps are cancelled instead of left queued (#133).
- Newly found fee links are fetched in the next hourly pass, not next month (#130).
- Texas lane reads and extracts 100 documents per pass and sends dead links back to discovery (#124).
- Completed runs show their real result instead of a stock footer (#120).
- Discovery follows fee links on ruled-out pages, such as SoFi's "Fee Sheet" (#116).
- Texas and California run daily full passes while many links are missing (#117).
- Only full passes with a state-expert step count toward a state's monthly cadence; Hamilton publishes 500 fees per pass (#84).
- The state lane button shows the real run status (#111).
- Darwin verifies 500 fees per pass in state lanes (#82); the nationwide lane sync runs hourly (#81).
- Production OCR fixed; failing agents flagged on the admin home page (#79).
- Complete pipeline: free pass, harder free pass, then a capped paid step for each stage; 55 state experts; answer key and scoreboard (#75).

**Database and speed**
- Migration file numbers match prod's history; `migration-version-kill` guard added (#112).
- The database closes app sessions idle over 60 seconds (#109).
- Builds no longer prerender data pages against the live database (#101).
- The public fees API and Pro categories read cached fee summaries (#102).
- Publishes no longer expire every public cache (#77); the pipeline tick no longer jams the database (#76).

**Public site and Hamilton**
- Every public page states the same counts and medians (#135).
- Public reports: the National Index and Monthly Pulse are rendered, stored and scheduled again (#143).
- Hamilton Analyze gives customer answers with a short lead and no FFIEC duplicate rows (#139); Hamilton reports use customer wording, dollars and percents (#140).
- State reports gain an economy and regulation exhibit (#108); economy charts treat a stored 0 as a missing month (#159).
- Funnel fixes: upgrade prompts say what is locked, /districts lands on the grid (#128).
- Seven years of BLS CPI so 5-year charts are complete (#127).
- Admin crew home shows each data feed's newest period and each report's last run (#146).
- Homepage: two clear journeys and the real sample report (#92).
- State fee reports redesigned in the research consulting format (#106); /research redesigned as a visual research hub (#86).
- No heading line wraps a single word, site-wide and in reports (#105).
- Made-up figures removed from public pages (#98, #88); a failed homepage count shows as unavailable, not 0 (#87).
- Federal series kept fresh: BLS bank-fee CPI, GDP price index, state labor data (#110).
- Regulator news and the latest Beige Book kept current; invented Hamilton prompt examples removed (#104).
- A budget refusal is named as the reason a Hamilton thesis failed (#83).
- Partner API: brainstorm notes, call report quarters, CFPB complaints, CSV for paid keys (#90).
- API spec: `/fees?category` and `/institutions?id` are now query parameters on `/fees` and `/institutions`, so code generators and Postman import the spec cleanly.
- The Live page became a visual flow board (#80).

**Project and tooling**
- CLAUDE.md cleaned up; `docs/project/` added for checkpoints, findings, decisions and this changelog (#122).
- The Firecrawl connector is blocked for Claude sessions in this repo (#137); docs use the feeinsight.com repo name after the GitHub rename (#145).

**Revenue and leads**
- Free national and Fed district fee reports open instantly from an email; the institution report is the paid step, and no page or email promises "48 hours" (#150).
- Clicks, checkout and sign-ups are sent to Vercel Analytics (#147); Plausible removed (#151).
- Every report request gets its own lead row, so a repeat email (the First National Bank Alaska request) shows in /admin/leads (#148).
- Lead loop with statuses, 24-hour due times and failed-email alerts (#136); spam guards on forms (#138).
- Pro welcome email (#141); hosted report next steps (#142); For Institutions buttons and tracking (#144).
- New /reports page (#85); the sample is offline and "$300 value" is gone (#123).

## 2026-10-04 (from 19:56 UTC)
- Rosetta read fixed: every read had failed with "bigint < text[]" (#72).
- The end-to-end pipeline test runs in CI; computed SQL placeholders are blocked (#74, #71); hourly backlog lane runs stay off bank websites (#73).
- Hamilton Pro quality series, including the payment grace window and reference page fixes (#57-#62).
- Admin display accuracy (#60) and the category guard checking names (#55).
