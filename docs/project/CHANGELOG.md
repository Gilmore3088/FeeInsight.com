# Changelog

Merged changes in plain language, newest day first (UTC). Written from `git log` on main.
Started 2026-10-05; for anything earlier, see `git log`.

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
