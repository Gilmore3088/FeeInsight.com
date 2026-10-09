# 2026-10-09: An envelope change never reached the rows held under the old one
**What happened:** Keep 50 (James, 00:02 UTC) pools returned mail, fax and copy fees under
account_research, whose hand-set amount envelope started at $5. At 01:58 UTC 1,380 raw rows at
850 institutions sat held as `outside_envelope` under account_research at $1 to $4.95 (780 fax,
289 returned mail, 236 excessive withdrawal or transaction fees the taxonomy files there, 43
research, 18 copies, 11 per-check research), none verified. Lowering the floor alone would have
changed nothing for them: Darwin's verify selection skips any row with a `verify.rules` v3
attempt, and the paused release path (`release-held.ts`, `DARWIN_RELEASE_ACTS = false`) is the
only reader of held rows.
**Cause:** the selection's only re-check exceptions were a category rejection under an older
guard version and an in-batch duplicate under the old URL key; an amount hold had no "the rule
changed" exception, so a hand-set envelope could only ever affect new reads.
**Fix:** `account_research` floor $1 (`darwin/envelopes.ts`), and verify re-selects a row held
`outside_envelope` whose amount today's hand-set envelope takes (`darwin/verify.ts`). The row then
verifies and goes to Hamilton publish under every publish rule (category guard, three-fee floor,
eval name rules, price-in-name hold); nothing is released on Darwin's say-so. Sample of 20 held
rows read by hand: 19 right on name, amount and category; one cut-off name ("Research Fee (plus"
at the $1 per-copy price). 14 of 20 state "per page" on the line with a blank frequency. This PR.
**Lesson:** every hand-set rule Darwin holds on needs a re-check exception keyed to the rule's
own value, as the guard version has, or a change to the rule is a change for new reads only.
