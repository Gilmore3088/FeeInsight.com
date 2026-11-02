# 2026-11-02: The live-site audit called right fees "not found"

Of the 8 fees triaged, 7 match the bank's live page; the audit missed them. 1 is stale (the bank
dropped it).

**What happened:** On draw 275762 (`live-source@2`, partial at 15:30 UTC Nov 2), 11 published fees
were "not found" on their cited live page. Eight were triaged here (134861, 54298 and 139172 belong
to other threads). Each one was traced on prod (read-only): `published_fee_records` ->
`verified_fee_observations` -> `raw_fee_observations` (extraction note excerpt), the stored text
(`agent_source_texts`, text hash), and the observation the audit saved
(`live_fee_audit.chunk` events: requested URL, content hash, reason). The live pages were read with
WebFetch; the build container cannot fetch bank sites directly.

| Fee | Bank's live line | Verdict |
|---|---|---|
| 134443 State Bank of Easton, "Fax - Outgoing First Page" $2 | "Fax - Outgoing First Page $2.00" on /services-fees-charges/ | right; audit fetched the wrong page |
| 156716 Tri Counties Bank, "Photocopy" $5 (business) | "Photocopy....... $5.00" in the Business Fee Schedule PDF | right; audit fetched the wrong page |
| 101084 Guaranty Bank, "Dormant Savings Accounts" $15 | "...the balance is $49.99 or less* $15.00/ annually" | right; band price |
| 110459 Welch State Bank, Tiered Interest Checking $6 | "Maintain a minimum balance of $1,500 to avoid a $6.00 monthly service charge" | right; band price |
| 162806 NJFCU, "Escheatment (charged after 3 years of no activity)" $100 | "Escheatment (charged after 3 years of no activity) $100" | right; band price |
| 103097 TruStone, "Inactive Account" $10 | "INACTIVE ACCOUNT ** $10 per month" | right; plain PDF reading lost the line |
| 37214 Salem Five, "Account Reconciliation (per hour)" $25 | "Account Reconciliation (per hour) $25.00" | right; the HTML reader drops the row (see below) |
| 103684 Olympia Federal, "Tax Registration" $81 | not on /rates/ any more | stale: the bank dropped it |

**Causes:**

1. **The audit fetched the document's landing page, not the page the fee cites.** A browser read
   (`read.js_fallback`) follows the landing page Magellan opened to the schedule it links, and
   records the schedule's address on the text (`agent_source_texts.source_url`) and on the published
   fee (`source_url`, the catalog's `document_url`). The audit fetched `source_documents.document_url`:
   Easton's /checking-accounts/ and Tri Counties' /fees. On Nov 2, 3,722 of 88,403 live dollar fees
   in `published_fee_catalog` cite a page other than their document's address (3,444 of them the
   stored text's own address). On this draw 9 observed fees were in that set: 3 still supported, 3
   not found (134443, 156716 and 134861, the fee another thread owns), 3 unknown.
2. **The audit refused a balance-band price that every pipeline gate accepts.** The shared check
   returns `tiered_fee` when the fee's price sits on a line that also prints a balance band. Knox's
   self-check, Darwin and Hamilton's publish re-check (`traceLiveFee`) treat that as traced; the
   audit called it not found. All three fees return `tiered_fee` on the stored text too, so the audit
   disagreed with the rule that published them.
3. **The audit's plain PDF reading lost a line the stored reading has, from the same bytes.** The
   live bytes of TruStone's schedule hash to the stored document's `content_hash` (9af5d6f6...), so
   the bank's document has not changed. The stored reading (a paid transcription) prints "INACTIVE
   ACCOUNT ** | $10 per month"; the plain PDF text did not pair the name with the price. The draw's
   `unsupportedSameBytes` already counted such fees and nothing judged them.

**What changed (verdict version 2, `LIVE_SOURCE_AUDIT_CHECKER` ends `:verdict2`):**

- The audit fetches the page the fee cites (`liveAuditFeeUrl`: the catalog's `document_url`, falling
  back to the document's address). The draw's identity and fingerprints are unchanged.
- A `tiered_fee` trace is supported when one bank line can be quoted for it (`liveAuditBandLine`:
  the one line naming the fee and printing the price, else the one price line that keeps the trace
  alone); with no such line it is unknown (`band_line_unproven`), never not found.
- A fee not found (or a script shell) on a page that served its stored copy's own bytes is judged
  again on the stored reading of those bytes (`readStoredTexts`, one bounded read after the fetches;
  on failure the live verdicts stand and a step warning says why). The chunk receipt lists the fees
  this supported (`storedReadingSupported`).

Nothing here holds, takes down or re-files a live fee: it changes only the audit's verdicts, so no
Darwin re-check or `*_LIVE` switch is added. Replayed through `evaluateLiveAuditFee` on the banks'
own text: Guaranty's Nov 1 copy (the same bytes the audit fetched) and NJFCU's and TruStone's
stored readings (same bytes as the live PDFs) come out supported with the bank's line quoted, as
do Welch's band line and Easton's cited page in the unit tests. Tri Counties (156716) and Matagorda
(134861) now fetch their cited pages; WebFetch shows each line there, but the audit's own reading of
those pages is not yet observed. Salem Five and Olympia Federal stay not found. The real count comes
from the next chunks after deploy.

**Not fixed here:**

- **Salem Five (37214): Rosetta's HTML reader loses table body rows.** The live page prints the row
  (WebFetch shows it in a plain table under "Misc. Account Related Fees | Amount"), and every
  `read.html_dom` reading of /feeschedule/ since Oct 7 (14,8xx characters, against 19,247 from the
  Oct 2 tag-stripping reader) keeps the header row and drops the rows under it, also under "Foreign
  Currency Exchange Related Fee | Amount". `tableRowsOf` in `src/lib/agents/rosetta/html-dom.ts`
  takes only `tr` directly under the table or its `thead`/`tbody`/`tfoot`, so rows wrapped in any
  other element are dropped silently. The raw HTML could not be fetched from the build container to
  confirm the wrapper, so the reader is not changed here. This is a Rosetta reader issue (it also
  hides these rows from Knox on every re-read), for the Data quality lane.
- **Olympia Federal (103684): the bank dropped "Tax Registration: $81.00"** from /rates/ (absent from
  the live page and from Magellan's Nov 2 copy, document 41830). The fee was read from the Oct 9 copy
  (document 23786, now superseded). A refresh issue for Hamilton's current-copy retire, not a
  pipeline rule.

**Guard:** `src/lib/agents/deming/live-source-audit.test.ts` (verdict 2: cited page, band line,
same-bytes stored reading), `src/lib/agents/deming/live-source-audit-run.test.ts` (a same-bytes fee
is re-judged on its stored reading; a failed read keeps the live verdict),
`src/lib/data-store/live-source-audit.db.test.ts` (`readStoredTexts`).

**Agent lesson:** deming/live-audit-judge-by-the-publish-rule
