# Changelog

Merged changes in plain language, newest day first (UTC). Written from `git log` on main.
Started 2026-10-05; for anything earlier, see `git log`.

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
