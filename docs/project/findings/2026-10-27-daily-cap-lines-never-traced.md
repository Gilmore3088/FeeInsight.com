# 2026-10-27: daily caps printed on their own line were read, then never traced
**What happened:** the shadow lab (Knox v135) missed 9 daily caps on overdraft and NSF fees, all
`not_read`. Only one daily cap was read in all 291 Texas, seven-state and lab texts (State key 7623,
"Maximum Daily Overdraft Fee Limit | $150.00"). Grouped by the shape of the line, the misses were:
- a cap named after its figure: "Paid Overdraft Charge: $30.00/item ($150.00 max daily)" (State key 10500);
- a cap on its own line under the fee it caps: "Courtesy Pay | $30/item" over "4 item cap per day (max fee
  of $120/day)" (State key 8741, $120 and $140), and in the Texas key, "Limit of $120 per day" (2416) and
  "(Daily limit of $97.50 per" (2425);
- "Daily maximum" after the per-item price: "$32.00 per item/Daily maximum $96.00" (State key 2017);
- a sentence that names the fees it caps: "Total overdraft charges/fees will not exceed $100.00 per day"
  (live audit 2735), "There is a limit of $108 each day in total fees ... for overdrawing your account"
  (live audit 75).

**Cause:** the reader and the shared check disagreed about where a cap can be. The overdraft family
read a cap only when it was worded "Maximum of $X per day" within two lines of its fee. The shared check
(`checkFeeAgainstSource`) traced a cap only on a row that names the fee. So a cap on its own line under
its fee could never trace. Texas key 2416's "Limit of $120 per day" was read on every run and held as
`untraced`. Nothing measured those holds as lost recall.

**Fix (Knox v136, overdraft family v6, admit-only):**
- `daily-fee-cap.ts` reads the four shapes above. The words before the figure must be only cap, count
  and fee words, and nothing in the clause may name an ATM, card, deposit, transfer, wire or loan.
- The cap belongs to the overdraft or NSF fee read on its line or the line right above, with no other
  fee's price between them, and must be larger than that one fee. Otherwise it belongs to the overdraft
  or NSF fees its own clause names.
- The shared check traces a cap on its own short line right under the capped fee's line
  (`capLineUnder`). It also reads "max daily" after the figure, "/day", "will not exceed", and a note
  between the figure and its day. This runs for the cap categories only, and only after the fee fails
  to trace as a price, so it can only gain a trace.
- Read diff over every Texas, seven-state and lab text: 12 caps kept and 2 held as untraced are new,
  and 3 holds are gone, because they are now kept caps (2416's untraced cap and 8741's two unclassified
  "4 item cap" lines). No kept read is removed, and no kept read changes category or price.

**Not measured:** this session had no production access, so live documents were not counted. The
change is admit-only. A live re-read at v136 can add caps, but it cannot hold, reject or re-file a live
fee.

**Lesson:** when a reader emits a shape the shared check cannot trace, the read is silently lost. Write
the trace with the reader, and treat a run of `untraced` holds of one shape as lost recall.

**Agent lesson:** knox/issue-2064-daily-fee-cap-in-every-shape
**Guard:** `src/lib/agents/knox/daily-fee-cap.test.ts`, `src/lib/custom-report/source-check-layout.test.ts`
