# 2026-10-17: fees paid for, published, then taken down

**What happened:** James: "Pissed we continue to pay for fees then take them down." Read-only
queries on prod (`published_fee_records.rolled_back_reason`, 14 days to Oct 17 10:00 UTC) show
about 59,300 takedowns: 57,177 of rows Knox read and 2,115 of `migration_v10` rows.

| Cause | Takedowns | First stage that could catch it |
|---|---:|---|
| `refreshed by #N` (a re-read republished the same fee) | 33,477 | Not a wrong fee. Stopped after Oct 13 |
| `duplicate of #N` (an older page copy republished) | 11,677 | Publish. Refused since #1737 (Oct 17 08:00 UTC) |
| `rules_recheck_unreproduced` | 4,811 | Knox, at a rules bump. 38 in the last 48 h |
| `source_check_untraceable` | 2,387 | Darwin, `checkFeeAgainstSource`. About 10 in the last 48 h |
| `category_guard` | 1,739 | Knox/Darwin, at a guard bump |
| `account_type_hold` | 770 | A new rule on Oct 16 (historical rows) |
| `product_page` | 747 | Publish (on since Oct 9) |
| `amount_outside_category_range` | 705 | Oct 4-5 only |
| `closed_institution` | 533 | Publish already skips closed banks |
| `unconfirmed_document_host` / `other_bank_document` / `business_schedule` | 440 / 424 / 398 | Publish. Refused since #1737 |
| `taxonomy_fold` / `same_line_duplicate` / near-name duplicate | 252 / 153 / 126 | Re-file and collapse rules |
| `non_deposit_document`, brokerage, lending wording | 100 | **Publish** (this PR). The verdict needs only the URL, category and name |
| `document_owner` (another bank's schedule, #1741) | 0 so far; 246 fees on 20 pairs judged `other_bank` (67 in the second look) | **Darwin before publish** (this PR) |
| Others (category outside taxonomy, source mismatch, frequency hold, superseded, not a fee) | 323 | |

**Spend:** Knox's only paid step is `extract.paid`. It made 3,651 calls for $99.49 in 14 days
(`ai_api_usage_events`, operation `paid_extract`):
- 644 calls ($20.29) have a live fee.
- 881 calls ($23.62) have rows still waiting on Darwin.
- 1,316 calls ($34.52) wrote no new row.
- 656 calls ($16.86) wrote rows that never published.
- 154 calls ($4.18) published fees that were all taken down.

No paid call was made on a document already known to be bad when it was called. 227 calls ($6.06)
were on documents found bad later: product page 192, non-deposit 21, and a few others. Most paid
waste is reads that yield nothing, not fees that are taken down. Magellan ($154.83) and Rosetta
($19.86) spend can't be attributed to takedowns from the ledger: unknown.

**Cause:** Darwin's document-owner check judged only pairs that already had live fees. So all
246 fees on the 20 `other_bank` pairs went live before the verdict, and only 4 were published
after it. The non-deposit takedown is a pure function of the document URL, category and name.
Publish could apply it, but only Darwin's live re-check did, after the fee was shown.

**Fix:**
- Publish refuses a row that Darwin's non-deposit re-check would take down
  (`nonDepositTakedownReason`, one function with two callers). Backtest: 100 of 100 of the
  14 days' takedowns would have been refused (88 non-deposit, 7 brokerage, 5 lending wording).
- Darwin's document-owner scan reads pairs with verified rows that aren't live yet (14 days)
  first. Re-reads stay limited to live pairs. The scan also wakes on a new verified row.
- Publish refuses a row whose pair Darwin's latest verdict, at the current text, judged
  `other_bank` (a fourth publish sweep rule). Prod dry run: 94 verified rows that aren't live
  would be refused, and 229 live rows are already in Darwin's takedown.
- Knox buys no paid read for a closed bank or for a text judged another bank's. 46 + 18 of
  18,683 waiting texts are skipped; $0.13 was spent on closed banks in the window.

**Lesson:** Put the rule at the earliest stage that has its inputs. A verdict that needs only
the document URL belongs at publish, and one that needs the document text belongs before
publish. A check that runs only on live rows is a detector, not a gate.

**Agent lesson:** gutenberg/issue-1069, darwin/pr-1769-judge-owner-before-live, knox/pr-1769-no-paid-read-unshown
