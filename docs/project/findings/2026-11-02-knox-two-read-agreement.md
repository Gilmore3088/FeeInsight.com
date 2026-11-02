# 2026-11-02: Knox read some texts twice and never compared the two reads

**What happened:** The pipeline wiring audit (Nov 2, gap 4) found that nothing reads a document
twice and sends a disagreement to review. Knox's paid pass (`paid-extract.ts`) buys a model read of
texts the free team (rules and specialists) read thin, and writes its fees as raw rows beside the
free rows of the same text. Its comparison with the free team (`paid-find-misses.ts`, #1101) only
counts what each paid find was to the free team; its own comment says "Nothing here writes a fee,
holds one or changes a read". So when the two readers read one printed line as two different fees,
both rows went to Darwin, and Darwin judged each one alone.

**Cause:** The second read was bought to find fees the free team missed, not to check the free
team's reads, so nothing paired the two reads row by row. A disagreement between two independent
readers is the cheapest signal of a read error the pipeline has, and it was thrown away.

**Fix:** `src/lib/agents/knox/two-read-agreement.ts` (`knox.two_read_agreement` v1). It pairs the
paid and free rows of each current text by their stored line (equal folded excerpts, or a line of
24 characters or more inside the other) and compares category and amount. Agreement is recorded
with `knox_two_read_agreed` on both rows. A disagreement on category (same amount) or on amount
(same category, same account) holds both rows while they wait for Darwin
(`knox_review:two_read_disagreement`, a held shape in `held-queue.ts`); a held row whose
disagreement no longer stands is released back to Darwin. It runs in the paid step, on the documents
it just read and before Darwin's verify step, and in the extract step for a bank or a state lane's
backlog. Holding, releasing and the agreement flag wait for `KNOX_TWO_READ_AGREEMENT_LIVE` (off);
off, each step writes only a `knox.two_read_agreement` event with the counts. No provider call, no
Knox version bump: no read changes.

**Dry run (prod, read-only, Nov 2, `mcp__Supabase__execute_sql`; SQL mirrors
`twoReadRowsSql` and `planTwoReadAgreement`):**
- Current texts with Knox rows: 12,517. With a paid read: 1,702. With filed rows (a category, an
  amount and an excerpt, not retired, not held) from both readers: 1,136, holding 3,514 paid rows.
- Paid rows paired with a free read of the same line: 1,558. Agree: 1,339 (85.9%). Disagree: 184
  (11.8%), in 203 pairs on 144 documents: 197 on category, 6 on amount. The other 35 paired paid rows meet the
  free read only as two fees on one line (another category at another amount, or two accounts'
  prices), which gets no verdict.
- The switch would hold 171 raw rows that are waiting for Darwin. 87 rows in a disagreement are
  already live and 106 are verified but not live; neither is changed (see "Live fees").
- 95 of the 197 category pairs are `minimum_balance` against `monthly_maintenance` (a service charge
  "if the balance falls below $X"); then `monthly_maintenance`/`paper_statement` 16,
  `od_protection_transfer`/`overdraft` 14, `monthly_maintenance`/`other_lending_fee` 9,
  `nsf`/`overdraft` 6.

**Sample (20 disagreements, 14 category and all 6 amount, ordered by md5 of the pair ids):** each read
checked with `checkFeeAgainstSource(text, name, amount, ".", category)` on a 2,600-character window
of its current text around the shared line (a window, not the whole text, so `name_not_in_text` can be
stricter than on the full text):
- Amount (6): the check passed only the free read in 2 (603446/603193 "Fee if closed within 90 days |
  $5.00", paid $25 a threshold; 669179/669168), only the paid read in 2 (609975/108415, 175429/112124:
  the free read took a balance threshold, $50 and $1,000), both in 1 (492170/468759: the free $500 is a
  balance requirement the check does not catch) and neither in 1 (174820/112967).
- Category (14): the check passed both reads in 9 (it confirms the price on the line; it cannot choose
  between two categories that both fit the words), only the free read in 4 (paid names carrying an
  added account or tier the text does not print, or a tier column) and neither in 1.
- So the shared check settled 8 of 20 (6 for the free read, 2 for the paid one). Reading the other 12
  by hand, the paid read is the better category in several (406642 "Outgoing Foreign | $50" is an
  international wire, not legal process; 1141291 is a share transfer for overdraft protection, not a
  monthly fee) and the two categories are a real boundary in the rest (minimum balance against
  monthly maintenance). Neither reader is reliably right, which is why a disagreement holds both rows.

**Live fees:** the decision of 2026-10-15 asks a holding rule for its live re-check. This rule holds
only rows waiting for Darwin. The 87 live rows in a disagreement are counted on every step event
(`live_in_disagreement`), not taken down: on the sample the shared check backs one read or the other
about as often as it backs neither, so a takedown would remove right fees with wrong ones (the
"no takedown" case of that decision). Darwin's live twin, if any, should be the category boundary
fix, not this hold.

**Second read with a paid call (not built):** 10,815 current texts have only the free read. A paid
second read of each, at the last 30 days' average of $0.0279 a paid extract call (4,030 calls,
$112.35), would be about 10,815 calls and $302. Rosetta's PDF reader agreement (#2553) compares two
readings of a PDF's text, not two reads of its fees (253 PDF reads in 30 days, 10 with a
disagreement), so it is not one of the two reads here.

**Lesson:** Two reads of one text are evidence only when something compares them. Pair them by the
printed line, hold what they disagree on before it is published, and record what they agree on.

**Guard:** `src/lib/agents/knox/two-read-agreement.test.ts`

**Agent lesson:** knox/wiring-audit-2026-11-02-two-read-agreement
