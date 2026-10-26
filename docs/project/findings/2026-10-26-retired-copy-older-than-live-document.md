# 2026-10-26: the retired-document check judged live fees against copies older than their own document

**What happened:** Hamilton's current-copy check judges a live fee whose document is no longer any
of its bank's sources ("retired", `retiredCopiesSql` in `hamilton/current-copy.ts`) against the
newest read copy at the bank's fetch target or saved link. It never compared dates. "Retired" only
means the document's address is not a source today; many such documents are newer than the copy at
the link: a print view (`?print=1`) or a business schedule read on Oct 20, a PDF found by discovery
on Oct 17, a page whose bank moved domains while the saved link still held a Feb 17 copy. #2689's
dry count found 231 live fees paired with a copy older than their document and set them aside for a
hand check before `CURRENT_COPY_CONFIRM_LIVE` turns on. James's standing rule is no hand checks, so
the pairing itself has to be right.

**Measured (prod, read-only, SELECT only, 2026-10-26):**
- Pairs whose current copy was fetched before the retired document: 241 live fees, 25 documents,
  22 banks.
- Of those, the bank had not been seen serving the copy (`GREATEST(crawled_at, last_checked_at)`)
  since the retired document was fetched for 139 live fees on 19 documents at 16 banks: for
  example Cinfed (print view Oct 20 against the plain page Oct 9), First Federal Bath (ffs.bank,
  Oct 20, against a Feb 17 copy at firstfederalbath.com), Bank of Gloucester (Oct 20 against
  Mar 11), Forbright (business schedule Oct 19 against the consumer page Oct 7).
- The other 102 fees pair with a copy re-checked after their document was fetched, so the bank
  was still serving it; they are judged as before.
- None of the 139 has a pending current-copy flag (69 pending flags in all), so no flag is left
  stranded.
- Copies superseded in place were checked the same way: 358 live fees sit on documents whose
  superseding copy was fetched earlier (the bank served the older bytes again), and every one of
  those copies was re-checked after the live document was fetched. None is affected.

**Fix:** this PR. A copy pairs with a retired document only when it was fetched or re-checked at
or after the retired document was fetched. When Magellan next fetches the address, the copy's
check date moves forward and the pair forms again. Nothing else in the selection changes, and
`CURRENT_COPY_CONFIRM_LIVE` stays off.

**Lesson:** a check that asks "is this fee still on the bank's current copy?" must first know the
copy is newer evidence than the fee. Compare when each was last seen, not which address is a source.

**Agent lesson:** hamilton/issue-1200-current-copy-must-be-newer
**Guard:** `src/lib/agents/hamilton/current-copy.db.test.ts`
