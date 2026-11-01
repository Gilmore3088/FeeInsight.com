# 2026-10-26: a "free with" note dropped the row's price, and a shifted PDF row lost the left fee's price
**What happened:** Bellco Credit Union (institution 8479, document 15817, text 10122) prints its
money order, official/cashier's check, domestic wire ($20) and international wire ($40) with the note
"(Free with Platinum Checking)". None of the four was ever stored as a raw row, so none could go
live (#1918).

**Cause:** two gaps in Knox's line rules (`knox/rules.ts`).
- Any row whose name held the word "free" was read as "no fee" (`NEGATIVE_FEE_LANGUAGE`) and dropped
  whole. A note that the fee is free with an account or condition ("Bill Pay (Free with E-Statements)
  | $6.00", "Notary Fee (FREE for Members) | $10.00"), or that a few are free ("ATM Withdrawals
  (3 FREE each month) | $3.50"), waives the price for some; everyone else pays it. A second fee on the
  same line ("NSF | $10.00 | Credit Card Replacement Fee (1 Free) | $5.00") was dropped with it.
- The PDF reader keeps only the cells it sees. The wire rows had an empty price cell beside the name,
  so the columns shifted: "Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00" over
  "(Free with Platinum Checking) | $20.00 | (per item returned by payee)". Read as printed, the two
  names glued into one $10 NSF read (raw 175781) that Darwin rightly rejects, and the $20 was lost.

**Fix:** Knox v127.
- `FREE_FOR_NOTE`: a "(free with/for/to ...)" or "(N free ...)" note no longer counts as "no fee". The
  price is read, as waivable, under a name that starts as a name and holds no price. An account's own
  monthly maintenance or minimum balance fee with such a note stays the account expert's read.
- `withShiftedColumnsRebuilt`: on a "name | price | name | price" page, a name line with no price whose
  next line opens with its "(" note and a price is rebuilt as one row per fee before any line is read.
- Dry run (prod, read-only, Oct 26): on 543 current lines at 228 banks with such a note, the v127
  rules read 351 fee prices that v126 drops. 296 are already live from other reads; 45 prices at 37
  banks are new. No price v126 read is lost. Seven current documents carry the shifted-row shape; no
  live fee comes from a glued read on them.
- Reach: the stale-read floor stays at v97. The new rules signature sends every live document through
  Hamilton's rules re-check once, which asks Knox to read again where a fee these rules read is not live.

**Not this cause:** Cascade Community FCU's "NSF Paid/Returned | $29.00" (document 13277) sits under
"Pathfinder & Business Checking Fees"; today's paired-event read holds it as a business row, which is
correct. Bellco's $3.95 and $12 checking fees and SchoolsFirst's $22 overdraft and NSF are live.

**Lesson:** a note that a fee is free for some is a waiver, not "no fee"; read the price everyone else pays.

**Agent lesson:** knox/issue-1918-free-note-is-a-waiver
**Guard:** `src/lib/agents/knox/free-note-prices.test.ts`
