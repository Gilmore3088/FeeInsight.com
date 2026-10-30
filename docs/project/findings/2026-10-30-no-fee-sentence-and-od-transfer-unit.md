# 2026-10-30: Hamilton proof run, two Knox misreads (a deposit after a no-fee sentence; an overdraft transfer filed as overdraft)

## (a) ESL FCU's $1 opening deposit live as a $1 monthly fee

**What happened:** Live fee 68597 (ESL FCU, institution 6843, document 21968, text 18587) is a $1
`monthly_maintenance` fee named "It’s easy to open. It makes banking more convenient. There are no
minimum balance requirements or monthly service fees." The page reads: "There are no minimum
balance requirements or monthly service fees. And you can get started with only a $1 deposit."
The $1 is the opening deposit; the page charges no monthly fee.

**Cause (Knox extraction):** The paragraph is under 280 characters, so it is read as one segment.
The rules pass names a price by the nearest fee words before it (`classifyNearest`), which were
"monthly service fees" in the sentence before the price's. The guard that drops a line saying a fee
is not charged (`NEGATIVE_FEE_LANGUAGE`) allows at most two words between "no" and "fee", so "no
minimum balance requirements or monthly service fees" passed. The account family expert's price
windows read it the same way (its `NEGATIVE_NAME` has the same two-word limit). Widening that guard
on the whole line is wrong: it would drop 3 correct live fees whose line also says "no ... or ...
fee" (67404, 77951 "There are no minimum balance requirements and the monthly fee is $3.95", 88733).

**Fix (Knox v141):** `priceAfterNoFeeSentence` (`knox/rules.ts`), asked by the rules pass and the
family experts: a price is not read when its whole sentence, before and after it, names no fee and
an earlier sentence on the line says "no ... fees" with no condition after it. A conditional
no-fee sentence ("No monthly service fee with an average daily balance of $750+. Otherwise, it's
only $9.75/month", live 139379) waives a fee the next sentence prices, and is read as before.

**Live re-check:** `darwin/no-fee-sentence-check.ts`, behind `NO_FEE_SENTENCE_TAKEDOWN_LIVE`
(off). Hamilton's rules re-check would not take 68597 down after the v141 bump: its name and price
still trace in the text, so the second look keeps it as "disputed".

**Dry run (prod, read-only, Oct 30):** the check's SQL pre-filter selects 19 live flat fees whose
stored line has "no ... fee/charge" then a sentence break before a price (fixture
`src/lib/agents/darwin/__fixtures__/no-fee-sentence-live-2026-10-30.json`). 1 matches: 68597. The
other 18 name their fee in the price's own sentence ("If not met $5 Service Charge", "Paper
Statement fee is $3"), state a condition (139379, 140267), or are table rows.
