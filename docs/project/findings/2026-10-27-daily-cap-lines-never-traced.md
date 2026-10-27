# 2026-10-27: daily caps printed on their own line were never read or traced
**What happened:** the shadow lab (Knox v135) missed 9 daily caps on overdraft and NSF fees, all
`not_read`. Only one daily cap was read in all 291 Texas, seven-state and lab texts (State key 7623,
"Maximum Daily Overdraft Fee Limit | $150.00"). Grouped by the shape of the line, the misses were:
- a cap named after its figure: "Paid Overdraft Charge: $30.00/item ($150.00 max daily)" (State key 10500);
- a cap on its own line under the fee it caps: "Courtesy Pay | $30/item" over "4 item cap per day (max fee
  of $120/day)" (State key 8741, $120 and $140);
- "Daily maximum" after the per-item price: "$32.00 per item/Daily maximum $96.00" (State key 2017);
- a sentence that names the fees it caps: "Total overdraft charges/fees will not exceed $100.00 per day"
  (live audit 2735), "There is a limit of $108 each day in total fees ... for overdrawing your account"
  (live audit 75).

**Cause:** the reader and the shared check disagreed about where a cap can be. The overdraft family
read a cap only when it was worded "Maximum of $X per day" within two lines of its fee. The shared check
(`checkFeeAgainstSource`) traced a cap only on a row that names the fee, and only after cap wording
before the figure.

**First cut, and what the review found:** #2768's first head (1d60951) widened both, and the review
found it published wrong caps that main never published:
- overdraft and coverage limits ("Overdraft Limit $500 per day", "Total limit of $750 per day");
- caps on returned deposited items;
- a cap placed under an overdraft fee that shares its line with another fee ("Overdraft Fee $35 Stop
  Payment Fee $30" over "Limit of $120 per day");
- per-item prices ("Daily maximum $35 per item");
- sustained charges ("after 5 days");
- caps smaller than the fee.

The widened shared check runs on live paths too: Darwin's live re-check, release-held, the
lost-recheck restore and the rules re-check. So it could also have kept or restored live cap rows that
are rightly untraced.

**Fix (Knox v136, overdraft family v6, admit-only):**
- `src/lib/daily-cap-wording.ts` holds the refusals that Knox's reader and the shared check share
  (`refusesDailyCap`). A figure is refused when it is:
  - another service's limit (ATM, POS, card, deposit or deposited item, transfer, wire, loan);
  - a sustained, extended or "after N days" charge;
  - a per-item price;
  - a limit that no fee or charge word governs.

  `capFitsFee` keeps a cap between two and twelve times the fee it caps.
- `knox/daily-fee-cap.ts` reads the four shapes when:
  - the words before the figure are only cap, count and fee words;
  - the overdraft or NSF fee is on the cap's line or the line right above;
  - no other price sits between them, counting the fee's own line, unless the cap prints a count (4 × $30
    = $120).

  When the clause itself names the fees it caps, an overdraft or NSF fee must be priced within three
  lines above it.
- The shared check's wider cap trace (`statesDailyCap` wide, `capLineUnder`) is behind
  `DAILY_CAP_LINES_LIVE`, which is off. With it off, every path traces a cap row exactly as main does:
  `src/lib/custom-report/daily-cap-lines.test.ts` checks 39 cap row shapes, for three categories each,
  against main's recorded results. Switched on, it only adds traces, and of those 39 shapes it changes
  only the three real caps (10500, 2735, 8741). The shadow lab's `daily-cap-lines` experiment measures
  it switched on.

**Measured:**

| Measure | Main | v136, switch off (today) | v136, switch on (lab experiment) |
|---|---|---|---|
| Lab answer-key recall | 951 / 1,312 | 952 | 955 |
| Lab, all expected fees | 1,315 / 1,766 | 1,318 | 1,322 |
| Lab false publication | 34 / 160 | 34 | 34 |
| Seven-state gate | 910 | 911 (MN 125) | 914 (IL 117, MN 127) |
| Texas gate | 589 | 589 | 589 |

Texas keys 2416 ("Limit of $120 per day") and 2425 ("(Daily limit of $97.50 per") are not read: a limit
with no fee word is now refused, because it reads the same as an overdraft coverage limit.

**Not measured:** this session had no production access. Before the switch is turned on, James runs
the live dry run: od_daily_cap and nsf_daily_cap rows (live, held, rejected and removed) whose
`checkFeeAgainstSource` result moves from not-ok to ok with the switch on, each with its traced line
(#1092).

**Lesson:** when a reader emits a shape the shared check cannot trace, the read is silently lost. When
the check is widened to trace it, test the near-miss lines through the check as well, because the check
also runs on live paths. Put the widening behind a switch until a live dry run counts what it would change.

**Agent lesson:** knox/issue-2064-daily-fee-cap-in-every-shape
**Guard:** `src/lib/agents/knox/daily-fee-cap.test.ts`, `src/lib/custom-report/daily-cap-lines.test.ts`
