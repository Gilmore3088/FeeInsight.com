# Wrong-bank and non-fee documents reached publishing (2026-10-12)

Issue: #1033. Read-only production queries, 2026-10-12 around 23:50 UTC.

## What was measured
- In the 7 days to 2026-10-12, Hamilton took down **836 live fees**: 415 as `other_bank_document` (18
  institutions) and 421 as `unconfirmed_document_host` (20 institutions).
- **Most came from older documents.** Documents stored before Oct 9, when Hamilton's host checks began,
  account for about 677 of the 836 fees. Documents stored on or after Oct 9 account for 159: 128
  `unconfirmed_document_host` fees from 12 documents and 31 `other_bank_document` fees from 1 companion
  document.
- **Strategy behind the 53 taken-down documents** (from `institution_additional_sources.found_by_strategy`,
  else the matching `discover` attempt):

| Strategy | Reason | Documents | Stored on or after Oct 9 |
|---|---|---|---|
| unknown (stored before the attempt log named it) | unconfirmed_document_host | 29 | 10 |
| unknown (stored before the attempt log named it) | other_bank_document | 13 | 0 |
| discover.known_link | other_bank_document | 4 | 0 |
| discover.known_link | unconfirmed_document_host | 2 | 0 |
| discover.paid_schedule_search | other_bank_document | 1 | 0 |
| discover.paid_schedule_search | unconfirmed_document_host | 1 | 0 |
| discover.rejected_page_links | unconfirmed_document_host | 1 | 1 |
| discover.second_document | unconfirmed_document_host | 1 | 1 |
| discover.operator_schedule | other_bank_document | 1 | 1 |

- **Most of the 10 "unknown" documents stored after Oct 9 are re-fetches of one address**, such as USF FCU's
  `usfcu.com/schedule-of-fees`, fetched 4 times on Oct 9–10. Each re-fetch stopped once Hamilton's
  second look cleared the bank's link. No `discover` attempt re-proposed the address after that.

## The gap
- **Other banks' websites.** `recordDiscoveryResult` refuses a fee link on another institution's website
  (since Oct 8). The paid finders require the bank's own domain.
- **Other hosts.** Nothing before storage checked a host that belongs to no institution. The free finders
  (`rejected_page_links`, the crawl) and the companion finder (`second_document`) stored such documents
  when they passed the fee-page check, and Hamilton then took the fees down after publishing.
- **Non-fee documents.** The companion finder also stored CRA public files, CRA performance evaluations,
  CRA disclosure statements, flyers and similar files (109 current documents; the largest stored files were a
  13.6 MB CRA public file and an 8.7 MB achievements flyer).

## The fix (#1033)
- **Host check.** The shared link check (`validateFeeCandidate`) now applies Hamilton's unconfirmed-host rule
  (`unconfirmedDocumentHost`, `magellan/other-bank-host.ts`) before a link is stored. A document on another
  host must name the bank's website or name. The bank's subdomains, shared file hosts and same-name hosts pass.
- **Non-fee documents.** Before any download, it refuses addresses that name a CRA file, annual report,
  newsletter, achievements piece or flyer and no fee, schedule or charge (`isNonFeeDocumentLink`).
- **Brochures pass.** Several banks' services brochures are their fee list: 21–24 live fees each at First
  Federal Middletown, VFCU and CBSM.
