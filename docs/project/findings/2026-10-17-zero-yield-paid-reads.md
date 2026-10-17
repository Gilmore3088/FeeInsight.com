# 2026-10-17: paid reads that yield nothing

**What happened:** James: we pay to read fees we then throw away. Knox's only paid step,
`extract.paid`, made 3,653 calls for $99.54 from Oct 5 to Oct 17 11:00 UTC (`pipeline_attempts`,
the same calls #1769 counted as 3,651 / $99.49 to 10:00). 972 calls ($26.57) kept no row:
680 `no_candidates` ($18.71, the model found no fee), 270 `evidence_mismatch` ($6.41, rows the
text did not ground) and 22 `parse_error` ($1.45). #1769's 1,316 counts calls that wrote no *new*
row, which also includes calls whose kept rows were already stored.

**Yield by class** (read-only, prod). Rows are linked to a call by document and time; "live" is a
published row not rolled back or quarantined; "live only here" is a live fee whose bank, category
and amount is live from no other document.

| Class | Calls | $ | Calls with no row | Rows written | Published | Live | Live only here |
|---|---:|---:|---:|---:|---:|---:|---:|
| All | 3,653 | 99.54 | 972 | 8,618 | 2,104 | 1,393 | 1,141 |
| Product-page address (`isProductPageUrl`) | 2,206 | 52.57 | 294 | 5,468 | 919 | 501 | 390 |
| Any other address | 1,447 | 46.98 | 678 | 3,150 | 1,185 | 892 | 751 |
| Rosetta kind not classified | 3,440 | 93.84 | 926 | 8,149 | 2,035 | 1,328 | 1,093 |
| Free team found 0 fees | 1,603 | 42.72 | 806 | 2,123 | 579 | 390 | 303 |
| Free team found 1-4 fees | 2,050 | 56.82 | 166 | 6,495 | 1,525 | 1,003 | 838 |
| Same bank's same text, second copy in a run | 149 | 4.08 | 52 | 370 | 48 | 21 | 13 |
| Page address read before, model found no fee, never one | 107 | 3.06 | 105 | 1 | 0 | 0 | 0 |

Product pages are not the waste they looked like: 390 live fees come only from them. No content
measure separates the empty reads from the useful ones without losing live fees. Every band of
text length, dollar count, fee-word count, fee-line count, yield-word count, schedule title and
content type has live fees found only there. URL words with no live fee (hsa, youth, teen, senior,
news, lend, home-equity, insurance, treasury) cover at most 54 calls, $1.39: too few to trust.
Rosetta's `document_kind` is unset on 3,440 of the 3,653 texts, so it can't predict yet.

**Cause:** a re-fetched page with a slightly changed text (a new hash) was bought again after the
model had already found no fee on that page: 107 calls, 105 kept nothing and none has a live fee.

**Fix:** `planPaidReads` skips the no-fee page before the call. Each skip is logged on the step
(`knox.paid_read_skipped` event, `skip_reason` in the results) and gets a $0 `rejected` attempt,
so the page is not selected again. A page whose earlier read returned rows the text didn't ground
is still read: one such page later grounded 3 fees, one of them live.

**Backtest (14 days):** 107 calls and $3.06 skipped, 0 live fees lost.

**Not skipped: the same text twice.** Skipping the second copy would save 149 calls and $4.08,
but 13 live fees came only from that copy:
- 7 had the same category and amount on the first copy's read, and that row came down as a
  page-copy duplicate of the second. With the skip, it would have stayed live.
- 6 came only from asking the model again about identical text: 4 lending fees at one bank, a
  $10 minimum-balance fee and a $3 excess-withdrawal fee.

A skip may lose no live fee, so this one was dropped (decision, Oct 17).

The rest of the empty calls are first reads where the model found nothing on a text the free
team also read poorly. Today's text measures can't predict them.

**Lesson:** test a skip against live fees before adding it. A read that looks wasteful, such as
reading the same text a second time, can still find fees the first read missed.
