# A re-read of the same document took down fees the bank still charges

**Found:** Oct 9, 2026, while splitting the answer key's missed fees by stage (Agentic OS thread).

## What happened

Hamilton's source check (`src/lib/agents/hamilton/source-check.ts`) takes a live fee down when the
current text of its own document no longer states it. When Rosetta re-reads a document, it rewrites
that document's text in place. Some PDFs come back from `read.pdf_layout` column by column, with
every fee name in one run and every price in another. Then no line pairs a name with its price, and
every fee on the document fails the check with `name_not_in_text` or `amount_not_the_fee`.

The document's bytes did not change, because a changed schedule is stored as a new document. The
failure is the reader's, not the fee's.

## Numbers (prod, 13:50 UTC Oct 9)

- 516 Knox fees at 192 banks were down for those two reasons with no live twin, and in each case
  their document's text had been rewritten after Knox read them. That covers Oct 5 to Oct 9; on
  Oct 9 alone it was 278 fees at 94 banks, all on `read.pdf_layout` texts.
- Georgia United FCU (institution 8565) lost all 20 live fees at 13:40:45 in run 3556. Stop Payment
  $32.00/Request and the safe deposit box sizes are among them, and the answer key lists every one.
- 348 of the 516 still pass `checkFeeAgainstSource` against the line Knox stored (`excerpt=`), with a
  price above $0 and no name rule. Rows whose stored line never stated the fee fail that check, for
  example 48249 (an overdraft fee whose line is the incoming international wire).

## Fix

`readerLostLine` keeps a Knox fee live when four things hold:

- It fails its own document for one of those two text reasons.
- That document's text was rewritten after Knox read the fee.
- The fee's stored line still passes the shared check.
- Its price is above $0.

`traceLiveFee` is unchanged, so Deming, name retidy and account names still measure against the
current text. Fees already down stay down while `READER_LOSS_RESTORES_ON` is false. Restores are
turned on only after UAT passes a 10-row check (9/10 or better), together with
`SOURCE_CHECK_STRATEGY` v17 so that every bank is re-checked.

## Still open

This is PRD section 6.3 ("never overwrite a previously better extraction solely because a new reader
ran"). Rosetta still overwrites a text that traced more live fees with one that traces fewer.
`text-survival.ts` reacts afterwards; nothing compares the two texts before the write.

## Restore checks failed (UAT, Oct 9)

Restores stay off. UAT scored two samples of fees the change would put back: 6/10 at 14:12 and 5/10
whole-row at 14:20 (7/10 on amount and category). The second sample used the clean-name gate from
PR 969. The bar is 9/10, and only one re-score was allowed, so restores are parked.

Lesson: Knox's stored line doesn't prove the price belongs to the name, even when both sit in one
line. In dash and leader-dot lists, the price on a line is often the next item's, printed just
before that item's label. Three of the round-2 misses were this:
- 14461: the $5 is non-member check cashing, and notary is free.
- 28317: key replacement is $15, and the $200 is drilling the box.
- 59618: NSF is $35, and Overdraft Privilege is $30.
The other two misses (14690, 88118) had the right price under a wrong name.

A restore needs more than the stored line. It needs a line that sets the name and the price apart as
one item, or a second reading of the current text. Keeping fees live is narrower: it applies only to
fees that are still up, and since PR 969 a single ` / `-separated line must pass the shared check.
