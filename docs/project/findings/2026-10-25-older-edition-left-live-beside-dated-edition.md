# 2026-10-25: an older schedule kept feeding live fees after the bank linked a newer one

**Lesson:** For one institution, audience and fee, at most one edition of a schedule is live: the
latest one in force today, dated by the date its own text states, whatever its address and whenever
it was read. Take down an older edition's line only where the newer edition states the same fee,
and only between two documents that are one schedule, never one account's or product's schedule.

**Agent lesson:** darwin/issue-1945-latest-edition-in-force

**Guard:** `src/lib/agents/darwin/dated-edition.test.ts` (Cedar Falls' two schedules, the
renamed and dropped lines kept, product-schedule and low-overlap near-misses),
`src/lib/agents/hamilton/publish.test.ts` and `src/lib/agents/hamilton/publish-selection.db.test.ts`
(`olderEditionTwin` selected again, `olderEditionOtherCopy` left decided).

**What happened (#1945):** Cedar Falls Community CU (7833) links its 2026 schedule (doc 31873,
"Revised 03/2026", first read Oct 13) from its homepage. 21 live fees still came from its 2024
schedule (doc 2671, "Revised: 4/30/2024"), and 15 lines of the 2026 schedule had been skipped at
publish as "Identical fee already published" behind them, so the old PDF stayed the cited source.
Darwin's edition re-check (`editionTakesOver`) retires an older edition only when both headings
state an "Effective" date and the newer copy was read before its date (an edition announced ahead,
#1915). Cedar's 2024 PDF prints "Eff ective: 5/1/2024" (a broken ligature), the 2026 one prints its
date only at its foot, and it was read seven months after it took effect, so nothing paired them.
When a bank changes a price in its new edition, the old price stays live beside the new one.

**Fix:** `src/lib/agents/darwin/dated-edition.ts`, run by Darwin's edition step (v3). Each document
is dated by Magellan's stored stated date (`source_documents.stated_date`, text-stated bases only).
The older line comes down as `older_edition: #<doc> dated <date>` when the newer date is later and
in force, both addresses name the same audience, neither names one product, the two share at least
half of the larger one's fee names (at least 3), and the newer document states the same line, live
or skipped behind this very line. Hamilton then decides that skipped copy again
(`OLDER_EDITION_RESELECT_SQL`), so the fee stays live from the current schedule. A line only the
older edition lists (Cedar's $112 daily cap, the renamed "Expedited" card) stays live.

**Dry run (prod, read-only, Oct 25):** 701 documents carry a text-stated date so far (Magellan
dates 200 a step); 124 are at banks with another dated document live. 35 live fees at 4
institutions would retire; each line is printed on the newer schedule's own stored text, and 5
were at a price the newer schedule changed (a $1 money order beside $2, a $15 stop payment beside
$32). Without the product and overlap guards, one bank's HSA, money market and premium account
schedules and KCB's money market and savings disclosures paired too. Cedar's two documents are not
dated yet; with the dates their texts state, 12 of its 21 old lines retire.
