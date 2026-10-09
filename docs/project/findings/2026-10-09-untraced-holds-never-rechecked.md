# Untraced Knox holds were never re-checked

**Found:** 2026-10-09, Largest banks thread (Arvest run 3366).

## What happened
Knox v62 reads Arvest's (inst 78) "Overdraft (OD) - Paid Item | $17.00 | per item". Its self-check
now traces the line, but the run reported "22 candidates, 22 skipped" and the overdraft stayed
held. The row (raw 449097) had been inserted under an older version and held as
`knox_review:untraced`. Two paths could have released it, and neither did:

- Extract's `ON CONFLICT` promotes a held row only when it is `knox_review:unclassified`.
- The held re-check (`recheckHeldRows`) covers unclassified and range rows only.

So an untraced hold stayed held for good, however many Knox versions later traced its line. On prod
at 08:10 UTC there were 1,568 such rows at 774 banks, 83 of them overdraft.

## Fix
- `recheckUntracedRows` (knox/held-recheck.ts) runs in the extract step. It takes a batch of
  untraced rows that have not reached Darwin, $10B+ banks first, and re-reads each row's own
  stored text with today's free specialists. A row is sent to Darwin only when today's read has
  the same category hint, amount and name. Every other row is marked once per Knox version
  (`knox_untraced_recheck:extract.rules:vN`).
- Extract's `ON CONFLICT` now promotes an untraced hold too.

A promoted row is not published directly. It still goes through Darwin's checks (source check,
category guard, envelopes) before Hamilton can publish it.

## Spot check
I read 45 untraced rows on 10 stored texts against today's rules. Only 1 would be sent to Darwin,
raw 268328, "Monthly service fee" $5, whose text says "Waived $5 monthly service fee when
maintaining a daily balance of $300". That reading is right, so 1 of 1 is correct. The other 44
stay held (safe deposit box size rows, sentence fragments, $0 "None", a misread cash advance), as
they should. The re-check is narrow by design. Five sampled rows could not be checked because
their texts were not exported.
