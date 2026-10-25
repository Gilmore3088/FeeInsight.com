# 2026-10-25: an older fee schedule read late could be reported as a competitor price change

**What happened:** while building the institution change feed (#1898), a read of the change rule
showed it could confirm a change that is only an old schedule found late. `confirmFeeChange`
(`src/lib/report-assemblers/monthly-pulse.ts`) treats two copies of one fee page as one schedule
(`sameSchedule` returns `same_page`), and the page key (`feePageKey`) ignores dates and version
words in a file name, so `fees-2026.pdf` and `fees-2024.pdf` are one page. When the 2024 copy is
read after the 2026 one, publish closes the 2026 price as "superseded" and records a change in
`fee_change_records`, and the rule then checked only that each text states its own price: it did.
So the competitor alert, the Monthly Pulse and the movement check behind the fee alert emails
would all have read it as the bank cutting its price. Nothing in `supersedePriorFee`
(`src/lib/agents/hamilton/publish.ts`) compares the two schedules' edition dates.

Prod, Oct 25, 2026 (read only): 0 competitor change alerts have been raised (no institution has
a workspace that turns them on yet), and 8 recorded changes are like for like. None of the 8 is a
late older schedule: NHFCU's pair is Oct 1, 2024 then Aug 15, 2026; Jeanne D'Arc's five and Safe
1's one state the same edition date on both sides. So the new holds take down 0 live alerts and 0
of the 8 recorded changes.

**Cause:** "newer" meant "read later". The rule had no notion of which schedule edition each price
came from, and the alert kept no record of what was on file before.

**Fix:** `judgeFeeChange` (same file, wrapped by `confirmFeeChange`, so every reader gets it)
holds a recorded change when the new price's schedule states an earlier edition than the old one
(`older_edition`), when both prices come from one stored document (`correction`), or when the old
schedule is dated and the new one is not (`edition_unknown`). Competitor alerts now store a
baseline (before and after: price, schedule, edition, the day each reached the index) and the
nightly pass re-checks raised alerts against the rule and withdraws any that fail. This stops the
false alert; it does not stop publish from letting the older copy replace the live price, which
belongs to the publish step and is left open for the Data quality lane.

**Lesson:** a price read later is not a later price. Compare editions before calling a difference
a change, and keep what was on file and when beside every alert so a reader can check it.

**Guard:** `src/lib/report-assemblers/monthly-pulse.test.ts` ("judgeFeeChange: what we knew and
when"), `src/lib/hamilton/competitor-alerts.test.ts` ("never alerts on an older schedule found late
or a corrected reading", "withdraws an earlier alert whose change the rule now holds").
**Agent lesson:** hamilton/issue-1898
