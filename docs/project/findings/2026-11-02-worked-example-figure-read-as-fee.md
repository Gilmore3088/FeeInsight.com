# 2026-11-02: a worked example's balance was read and published as a fee (prod sample, fee 89920)
**What happened:** Community Choice Credit Union (institution 7751, communitychoicecu.com
agreements-disclosures page, document 33984, stored text 32044) has a live fee 89920, $10, filed
`od_protection_transfer`, named "If you have also elected Overdraft Privilege, we may elect to transfer
the". The bank's own words explain overdraft protection with an example:

> The following example illustrates how this works if you have elected both Overdraft Protection
> Service and Overdraft Privilege Overdraft Service:
> Assume your actual and available balances in your checking account are both $50, and your available
> balance in your designated linked account is $10. You write a check for $80. ... However, if you have
> also elected Overdraft Privilege, we may elect to transfer the $10 in your designated linked account
> and pay the remaining $20.00 portion of the item using Overdraft Privilege.

The $10 is the example's linked-account balance, not a charge.

**Cause (Knox, extraction):** the rules pass cuts a long paragraph into sentences and reads each alone.
"However, if you have also elected Overdraft Privilege, we may elect to transfer the $10 ..." has
overdraft words and a price, so it took the price and named it by the words before it (raw 680555). The
example's opening ("The following example illustrates", "Assume") is in the sentences before, which
the sentence read never sees; v32's worked-example test (`WORKED_EXAMPLE` in layout.ts) reads only a
name that itself opens the example, and only in a pass 2 specialist. Darwin verified it and Hamilton
published it because the name and price trace to the text: the shared check passes it, and the opening
lies outside Knox's stored excerpt, so no later step read it. This is structural: a read made from one
sentence of a paragraph loses what the paragraph said about it, and the stored excerpt keeps only that
sentence.

**Fix (Knox v160, drop-only):** `inWorkedExample` and `examplePriceNotAFee` in `knox/rules.ts`. A sentence
is in a worked example when its joined paragraph opens one before it or in it ("Assume", "Suppose",
"Imagine", "Let's say", "Example:", "For example, if", "The following example", "the example below")
with no leader or table row in between, or the line above leads into one and ends with a colon. In
such a sentence a price no fee word owns (right before it, or within three words after it) is the
example's figure and is not read (drop reason `worked_example`). An example that quotes the bank's own
price keeps it: "you will be charged an overdraft fee of $25" (135705), "a Courtesy Pay fee of $12 on
the $30 item" (51683), "There is a $5 per month service fee" (130189). The Texas answer-key gate is
unchanged (586 / 11 all, 60 / 4 held out); the rule drops 2 sentences there, both an example's "$40
check".

**Darwin's live re-check:** `darwin/worked-example-check.ts` (`WORKED_EXAMPLE_CHECK_VERSION` v1) reads
the stored text before each live prose fee's excerpt, the note's Rosetta artifact only when its sha256
is the note's `text_hash`, and asks Knox's own test (`workedExampleAmountAt`). Behind
`DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE` (off), it reports; on, a match goes through the 12-hour second
look and is rolled back as `worked_example: ...`.

**Dry run (prod, read-only, Nov 2):** of 31,188 live flat fees above $0 with a prose excerpt (no table
cell), 1,267 have their text proved by hash and an example word in the 3,000 characters before the
excerpt. 1 matches: 89920. In the read before the fee-word rule was added (1,465 windows, text hash not
checked), 16 fees sat in a worked example; the other 15 all print their price after or before a fee word
and stay (142910, 142911, 130189, 147311, 125628, 128118, 166355, 69219, 135705, and 95889 and
51683-51687, a tiered courtesy pay walk-through at 4778). 3,764 live prose fees could not be placed in
their text by their excerpt's first 30 characters and are not read.

**Not fixed here:** the tiered courtesy pay walk-through at institution 4778 (six live overdraft fees
$5 to $35, each "Courtesy Pay fee" read from the example's lines) quotes the bank's tier prices; whether
those six belong live as six overdraft fees is a separate question for the tier rules.

**Agent lesson:** knox/prod-sample-2026-11-02-worked-example-figure
**Guard:** `src/lib/agents/knox/worked-example.test.ts`
