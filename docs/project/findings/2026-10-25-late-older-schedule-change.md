# 2026-10-25: an older fee schedule read late could be reported as a competitor price change

**What happened:** while building the institution change feed (#1898), a read of the change rule
showed it could confirm a change that is only an old schedule found late. `confirmFeeChange`
(`src/lib/report-assemblers/monthly-pulse.ts`) treats two copies of one fee page as one schedule
(`sameSchedule` returns `same_page`), and the page key (`feePageKey`) ignores dates and version
words in a file name, so `fees-2026.pdf` and `fees-2024.pdf` are one page. When the 2024 copy is
read after the 2026 one, publish closes the 2026 price as "superseded" and records a change in
`fee_change_records`, and the rule then checked only that each text states its own price: it did.
Nothing in `supersedePriorFee` (`src/lib/agents/hamilton/publish.ts`) compares the two schedules'
edition dates.

`confirmFeeChange` has four callers, and each would have read that as the bank cutting its price:
- the competitor alerts (`src/lib/hamilton/competitor-alerts.ts`);
- the Monthly Pulse (`assembleMonthlyPulse`, same file as the rule);
- the movement check behind the fee alert emails and the Pro digest
  (`loadConfirmedMovementPairs`, `src/lib/agents/fee-movement-check.ts`);
- Hamilton publish itself, `src/lib/agents/hamilton/publish.ts:2031`: after a batch publishes, it
  runs each price movement through `confirmFeeChange` to decide whether the movement goes on the
  `hamilton_fee_movement_detected` signal as a confirmed change (which alerts watchers) or stays
  on the publication signal as an unconfirmed movement.

**Cause:** "newer" meant "read later". The rule had no notion of which schedule edition each price
came from, and the alert kept no record of what was on file before.

**Fix:** `judgeFeeChange` (same file, wrapped by `confirmFeeChange`, so every caller above gets it)
reads each schedule's own edition line with `editionStarts` (the reader Darwin, Magellan and
publish use), never any "effective" date in the text: the first version used the loose
`effectiveDate`, which takes the latest "effective" date anywhere, a privacy notice's or a CD rate
table's included, and would have held real changes (review of the first head). It holds a recorded
change when:
- the new price's schedule states an earlier edition than the old one (`older_edition`);
- both prices come from one stored document (`correction`);
- for the competitor alerts only (`holdUndatedEdition`), the old schedule is dated and the new one
  is not (`edition_unknown`). The Monthly Pulse, the movement check and publish do not ask for it,
  so a bank that moves from a dated PDF to an undated web page keeps its real changes there.

Competitor alerts now store a baseline (before and after: price, schedule, edition, the day each
reached the index), and the nightly pass re-checks raised alerts against the rule and withdraws
any that fail. This stops the false alert; it does not stop publish from letting the older copy
replace the live price, which belongs to the publish step and is left open for the Data quality
lane.

**Measured on prod (Oct 25, 2026, SELECT only, with `editionStarts`):** 0 competitor change alerts
have been raised (no institution has a workspace that turns them on yet), so 0 would be withdrawn.
8 recorded changes are like for like, and the corrected rule holds 0 of them on any path:
- NHFCU (2 changes): editions 2024-10-01 then 2026-08-15, a newer edition;
- Jeanne D'Arc (5): neither text states an edition line `editionStarts` reads (the old page's
  "Effective as of 8/1/2026" is its last line; the new one is a changes notice), so no edition hold
  applies, and with the old one undated `edition_unknown` does not apply either;
- Safe 1 (1): both copies state 2026-10-01, so the $34.00 to $25.00 edit made under the same date
  still counts.
No pair shares one document.

**Lesson:** a price read later is not a later price. Compare the schedules' own edition lines
before calling a difference a change, and keep what was on file and when beside every alert so a
reader can check it.

**Guard:** `src/lib/report-assemblers/monthly-pulse.test.ts` ("judgeFeeChange: what we knew and
when", including the privacy notice and CD rate cases and the Pulse keeping an undated new page),
`src/lib/hamilton/competitor-alerts.test.ts` ("never alerts on an older schedule found late or a
corrected reading", "withdraws an earlier alert whose change the rule now holds").
**Agent lesson:** hamilton/issue-1898
