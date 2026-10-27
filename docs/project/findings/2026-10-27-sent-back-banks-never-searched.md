# 2026-10-27: banks Rosetta sent back were never searched again

**What happened:** fix plan step 7 asked why 1,654 documents from older links read as empty
pages. Read-only checks on prod (Oct 27) followed the banks instead of the documents:
- When Rosetta rules a bank's link is not a fee page (or a script-only page, or a dead link), it
  clears the link and sets `rescue_status = 'pending'` with a `rosetta_*` failure reason
  (`sendBackToMagellan`, `rosetta/read.ts`). Discovery is meant to search the bank again.
- 624 active banks with a website were in that state with no discovery search since the send-back.
  608 had waited more than three days; the oldest were sent back on Oct 13. In Kansas, the first
  twelve due banks in discovery's own order were all such banks, with no discover attempt in 7 days.
- Each step's slots went to market leaders and to banks searched before, which every discovery
  method version makes due again.

**Cause:** a send-back only made the bank due. Nothing ranked it, so a bank whose page was just
ruled out (the bank most likely to have a better page one click away) waited behind the whole
dead-bank pool.

**Fix:** `sentBackUnsearchedSql` (`magellan/discovery.ts`): a bank whose `failure_reason` is a
Rosetta send-back and whose `failure_reason_updated_at` is not older than `last_rescue_attempt_at`
is due at once (no 12-hour wait) and ranks right after a person's correction, ahead of the market
leaders. A search stamps both columns in one write, so each send-back buys one search. The same
PR re-fetches a bank whose current copy Rosetta could not match to the bytes the bank now serves
(`readNeedsNewCopySql`, `magellan/fetch.ts`), and cleans a poor scan before free OCR gives up
(`cleanForOcr`, `rosetta/ocr.ts`, `ROSETTA_OCR_VERSION` 3).

**Lesson:** a hand-off between agents is not done when the sender marks the work due: check that
the receiver's order reaches it, by counting what is due and never picked.

**Guard:** `src/lib/agents/magellan/discovery.test.ts` ("searches a bank Rosetta sent back, once") and `src/lib/agents/magellan/fetch.test.ts`.
