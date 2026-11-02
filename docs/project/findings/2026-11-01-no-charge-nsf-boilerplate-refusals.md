# 2026-11-01: Agreement boilerplate refused every no-charge NSF sentence it shared a page with

**What happened:** Knox v133 (#2753) reads a bank's own "We do not charge an NSF fee" sentence as the
NSF fee's $0, behind `NO_CHARGE_SENTENCE_READ_LIVE` (off). To stay safe it refuses a page on which any
other sentence names an NSF-family fee (`mentionsNsfFee`: an NSF word and a fee, charge, cost or
penalty word) or any line prices one (`documentPricesNsf`). Long deposit agreements repeat clauses that
pass both tests without pricing anything the bank charges, so the rule refused pages that price no NSF
fee at all. United Bank's consumer terms (institution 67, doc 24430, effective Sept 2026) say "We do not
charge an NSF fee for returned items." and were refused by six such passages: the table of contents
("Overdraft and Nonsufficient Funds (NSF) Fees ���� 7", read as a $7 NSF price), "electronic returned
check charges" in the third-party EFT paragraph, the posting-order paragraph ("returned unpaid ... the
amount of overdraft fees"), the legal-action disclaimer ("dishonoring checks ... any fees, losses, or
damages you may incur ... insufficient available funds") and the substitute-check clause ("fees that were
charged as a result of the withdrawal (for example, bounced check fees)"). Monet Bank (309) and Grand
Bank for Savings (2568) were refused by the same clauses, Grand Bank also by a funds-availability limit
("$6,725 on any one day; (C) You redeposit a check that has been returned unpaid").

**Root cause:** the refusal tested for an NSF word and a fee word, not for a sentence that could be the
bank's price. The clauses are recognisable by fixed wording, and none of them prices the bank's NSF fee.

**Fix (Knox v154, `src/lib/no-charge-statement.ts`, still behind the switch, off):**
- a table of contents' entries are neither an NSF price nor an NSF sentence: four or more leader and
  page-number lines in a row, page numbers never falling, at least three values, fewer than half naming
  a fee (`contentsEntries`); a fee schedule's leader rows keep pricing;
- an amount of $1,000 or more is no NSF price;
- the recoverable-loss clause no longer names an NSF fee (the whole sentence), and the merchant's
  "electronic returned check charge" / "collect a charge in the event a check is returned for
  insufficient funds", the disclaimer's "fees, losses, or damages you may incur" and a posting-order
  sentence's "overdraft fees" are taken out of the sentence before it is read again, so an NSF fee
  beside them still refuses the page.

No Darwin live re-check ships here: the switch stays off, so no fee is read, held, taken down or
re-filed. Turning it on still needs James's yes, with Darwin's live re-check of these $0s, a sample check
and a source check version bump, as #2040 lists.

**Dry run (prod, read-only, current copies, Nov 1, switch on in a test harness):** 58 current texts at
48 institutions carry a "do not charge ... NSF" phrase. The grammar takes a sentence on 9 texts at 9
institutions. Before this change 3 read (Wells Fargo 4, 172, 359); now 4 (plus United Bank 67, "NSF fee",
$0). Each is read by Knox (`runFreeSpecialists`, held `zero`, `nsf`) and traced by
`checkFeeAgainstSource` with the switch on; none is traced with it off. Institutions 4, 359 and 67 have
no NSF row in `published_fee_catalog`, `verified_fee_observations` or Knox's raw reads, so none would be
held as a conflict; 172 already shows NSF $0 (36426). Still refused, by sentences that are not
boilerplate: Grand Bank (2568, a deposited item's "our returned item fee" and a glossary's "Returned Item
Fee — A fee charged ..."), Monet (309, a foreign item's collection fees; already $0 live, 115292), Cape &
Coast (678, posting and merchant re-presentment sentences), Montecito (570, a redeposited item's handling
fee) and HSBC (26, Premier scope; already $0 live, 28130).

**Fails closed (review of #2873):** a run of leader rows counts as contents only under a "Contents"
heading, or when it has 8 or more entries with leaders of 20 characters or more starting at page 10 or
lower; and every run, headed or not, must climb like page numbers (first page 10 or less, no step
above 10, at most 3 pages per entry). So a schedule printing "Returned Item (NSF) ........ 35" stays a
price, under a heading or after a contents page too. The recoverable-loss clause takes out only itself
and a "(for example, ... fees)" list with no charge verb or we/our; the merchant clause only "a merchant
or other payee to ... collect a charge in the event a check is returned for insufficient funds". An NSF
charge anywhere else in the sentence still refuses.

**Conflicts with a live charged NSF (not taken down here):** Montecito Bank & Trust (570): its agreement
(doc 30191) says "We do not currently charge a fee for NSF items returned." while its schedule (doc 18511)
is live with "Returned Item Fee (Check & ACH)" $10 (76520) and "Returned Item Fee (Business Accounts
Only)" $9 (130764). The rule refuses the page, so no $0 is read; the live fees need their own look.

**Lesson:** refusing by default means refusing on a sentence that could be the bank's price, not on
every sentence with an NSF word and a fee word. Set standard clauses aside by their closed wording, take
only those words out and read the rest again.

**Agent lesson:** knox/issue-2040-boilerplate-names-no-price

**Guard:** `src/lib/no-charge-statement.test.ts` (v154 block), `src/lib/agents/knox/no-charge-sentence.test.ts`
(United Bank fixture `src/lib/__fixtures__/no-charge-nsf/united-bank-terms-24430.txt`)
