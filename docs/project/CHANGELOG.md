# Changelog

Merged changes in plain language, newest day first (UTC). Written from `git log` on main.
Started 2026-10-05; for anything earlier, see `git log`.

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
