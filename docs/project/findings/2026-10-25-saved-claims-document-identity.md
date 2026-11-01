# 2026-10-25: saved claims kept each fact's value but not which document it was read from

**Lesson:** A save that a later re-check or correction reads has to keep the identity the evidence
already carried, not only the value: a record id alone points at today's catalog row, which may
have been re-read from a newer schedule. Keep the source document, content hash and verification
event with each fact, bounded, and let a bound drop the least needed fact first.

**What happened (Cycle A trace, defect #6, #1077):** a written answer saves its claims
(`savedClaimsFrom` in `src/lib/hamilton/saved-claims.ts`) in the analysis row's `response_json`.
Each `SavedClaimFact` held the fact's id, value, unit, scope and `asOf`, but none of
`source.table`, `source.recordId`, `source.sourceDocumentIds`, the URL, `documentContentHash`,
`retrievedAt` or `verificationEventId` that the evidence fact carried. A calculated fact (a peer
median) kept none of its input ids either. So the PDF's Evidence Record and the board brief's
records table (`writtenAnswerSources` in `src/lib/hamilton/board-brief.ts`, from #2627), a
re-check or a correction could not tell which schedule version a figure was read from without
joining today's catalog. The 40-fact bound also took cited facts in sentence order, so a long first
sentence could push a later sentence's only fact out, and that sentence then printed no source line.

**Cause:** the saved shape was written for the board report's sentence outcomes (#1899), which need
values only; the sources section and re-checks came later and read the same shape.

**Fix:**
- `SavedClaimFact` gains an optional `source` on an observed fact: `table`, `recordId`, and when
  present `recordKey`, `evidenceClass`, up to 8 `sourceDocumentIds` (with
  `sourceDocumentIdsTruncated` when more were carried), the first `url`, `documentContentHash`,
  `retrievedAt`, `lastCheckedAt` and `verificationEventId`. Empty values are left out and a text
  over 512 characters is not saved, so a fact stays small. A calculated fact gains up to 8
  `inputFactIds`.
- The bound now takes each supported sentence's first cited fact, then each one's second, and so
  on, so every sentence keeps its first fact before any keeps a second. Inputs of cited calculated
  facts fill the room that is left; dropping one does not set `factsTruncated`.
- `readSavedClaims` reads both fields when present and leaves them out when absent, so claims saved
  before this change read as before (the version stays 1). A malformed source reads as none, not as
  a bad claim set.
- The written answer's source line (PDF and board brief) now names `source document <id>` when the
  saved fact holds one. The URL is still not printed.

**Known limits:**
- Answers saved before this change keep no source identity; nothing is backfilled. Their source
  lines print as before, without a document.
- A written answer's fee facts come from the institution profile, which carries the record id,
  document id and URL but no content hash, retrieval date or verification event, so those fields
  stay absent for them until the profile carries them (as `written-answer-fee-refs` notes).
- The bound is still 40 facts. With more than 40 supported sentences that each cite a fact, the
  later sentences still lose their source line, and `factsTruncated` says so.
- A calculated fact's inputs are saved only while there is room, and only those the evidence held;
  a peer median over many peers may keep its input ids but not every input fact.
- Nothing here re-checks a fact against the bank's current schedule; it only keeps what a re-check
  would need to know which version was read.

**Guard:** `src/lib/hamilton/claim-report-carry.test.ts` ("saved claim facts keep their source
identity", "keep every supported sentence's first fact before any sentence's second"),
`src/lib/hamilton/written-answer-sources.pdf.test.tsx` ("lists the fee record and the filing",
"prints no document for claims saved before they kept the source").
