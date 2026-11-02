# 2026-11-01: live names cut on a comparison were never re-read
**What happened:** #1443 left "13 of the 19 cut live fees get no re-read request" open. A read-only
prod check on Nov 1 of the 90,788 live fees found 66 whose name stops on a comparison with no figure
after it: a closing "<", ">" or "<=" ("Paid NSF Item <" 109755, "Outgoing Wire Fee <" 109781 and ">"
109782, "Loan Processing Fee >" 136523), a closing "under" or "over" ("Courtesy Pay: Over" 98440,
"Coin Machine for Non-Customers – Under" 165061), "not to exceed" (117623, 154081, 161104), or a
sentence cut on "are" ("Overdraft fees are" 62156, "Cashier's checks are" 55653). Knox's live shape
(`liveFragmentName`) reads "below", "than" and "is" as cut words but none of these, so Darwin's live
fragment check never matched them and Knox was never asked to re-read their lines. One of them carries
the wrong amount: 105787 "ATM, POS, ACH, Checks, Debit <=" is live at $5, the line's threshold; the
line prices it at $0.00.
**Cause:** the shape list was built from a hand sample of the cut words seen on Oct 15; comparison
symbols, "under", "over", "exceed" and "are" were never sampled, and publish cut names at a threshold
figure until #2747, which made more of them.
**Fix:** Darwin's fragment check v9 reads these names (`LIVE_FRAGMENT_COMPARATOR_END`; a closing tier
label such as "65 and Over" or "Items 11 and over", an HTML tag and a box size's "=" do not match),
always as a `reread`: kept live, Knox asked to re-read the line, never renamed or taken down from the
name. The threshold gate would have taken down 154081 ("Child Support Freeze Maximum allowed by state
law, not to exceed | $100", a real fee as printed) and the $0 rule 38640 ("First six (6) check copies
per calendar are FREE with First Premier", which traces), so neither gate applies to these names. It is
behind `COMPARATOR_FRAGMENT_REREAD_LIVE` (off at first, on since 2026-11-02; see the follow-up); off, each step reports the matches as
`comparator_shadow`. Dry run on the 4,540 live fees whose name ends on one of these words or carries "min" or
"required" (picked by a SQL prefilter; a name whose comparison sits before a trailing HTML tag or a
no-break space could be missed, and the step's `fragment_full_count` is the exact count): switch off, no verdict changes; switch on, 66 more matches, all `reread`, 0
takedowns, 0 renames by Darwin. Knox's re-read of the 66 on their stored texts (`decideReread`, today's
rules): 6 renamed, each tracing to the bank's line with `checkFeeAgainstSource` (109755 "Paid NSF Item <
$30 (Courtesy Pay)", 136523 "Loan Processing Fee > $5000 unsecured", 98440 "Courtesy Pay (over $5)",
144900, 148477, 165257), 52 `same_name`, 7 `not_found`, 1 `ambiguous`; no takedown. The same version
closes the #1521 floor nits: "min $N or" is floor wording, both floor patterns share one threshold
lookahead, and "$N minimum required to open" is a threshold (0 live names carry either wording, so no
verdict changes).
**Follow-up (2026-11-02, #1443):** as first written, the comparator shape was read ahead of `pronoun`
and its `reread` returned before the takedown rules, so turning the switch on would have kept live two
thresholds the check takes down today ("Coin counting fee: if you deposit over" at $100, "Monthly
Maintenance Fee You will be charged on balances under" at $500) while "... balances less than" at $500
still came down. Now the shapes without the comparator are read first and keep their verdict, takedown
included; the comparator shape is read last and is a `reread` only for a name that would otherwise get
no verdict (still v9). Dry run 2026-11-02 (read-only, 90,936 live fees, the
75 whose name ends on a comparison word read in full): 67 match the shape; switch on, 66 `reread`, 1 kept
as today's `pronoun` `reread` (80370 "A fee will apply if the minimum balance falls under" $25), 0
takedowns. No live fee changes action (live takedown-shaped names are already down), so on that dry run
`COMPARATOR_FRAGMENT_REREAD_LIVE` turned on under the sampled-clean rule; the fix keeps future
takedown-shaped names from slipping through.
**Lesson:** a fragment shape list taken from one hand sample misses the cut words the sample did not
hold; count the words live names actually end on before calling the list complete.
**Guard:** `src/lib/agents/darwin/live-fragment-check.test.ts` ("v9: a name cut on a comparison"), `src/lib/agents/knox/reread-feedback.test.ts` ("a name cut on a comparison").
**Agent lesson:** darwin/issue-1443-a-cut-comparison-is-a-fragment, darwin/issue-1443-a-reread-never-pre-empts-a-takedown
