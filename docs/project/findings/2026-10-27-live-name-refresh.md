# 2026-10-27: a better re-read name never reached the live fee
**What happened:** issue #1912 had two open lines with one cause.
- Dutrac's (7711) wires 110356 and 110355, and 3 Rivers' (4366) 71592, keep their old names. Knox
  v135 reads the channel printed after the price ("$30.00 - phone request", "$15.00 Recurring"), but
  the live names never take it, so 7711's domestic wire value stays blended at $27.50.
- 14 live fee names at 8 institutions on 8 documents still hold U+FFFD. One of them is 140286, "Wire
  Interna�onal Transfer-Remote Outgoing" $70 (institution 2521), which is filed as a domestic
  wire: the garbled word hides "International" from the category guard.

Read-only checks on prod (Oct 27) found that Rosetta's glyph repair (#2598) had already restored
the stored texts: document 31383's newest text (29159) prints "Wire International Transfer-Remote
Outgoing ..$70.00*". Knox re-read it on Oct 26 and Darwin verified the clean name (raw 1186050,
verified 215327, under `wire_intl_outgoing`). The live row still shows the garbled name.

**Cause:** no step carries a re-read's name to a live fee.
- Hamilton's publish step refuses a re-read of a live fee's line. It is either a second read of
  that line (`same-line-read.ts`) or identical to the live fee (same category and price, one name's
  words inside the other's). Both refusals are right, because publishing the re-read would show
  the line twice. The live row keeps its name.
- Knox's name re-tidy (`knox/name-retidy.ts`) repairs a live name from the name alone. It leaves a
  glyph inside a word "for a re-read" (`junkStrippedName`), and that re-read never lands.
- #2761 expected 7711's names to change "on its next read". That cannot happen: Knox has not re-read
  documents 24816 and 38548 since Oct 11 and Oct 20, and when it does, publish refuses the renamed
  reads.

**Fix:** Hamilton's live name refresh (`hamilton/live-name-refresh.ts`, check
`hamilton.live_name_refresh` v1). It runs in Darwin's verify step, beside the re-read category
re-check. A live flat fee takes its re-read's name in place only when all of these hold:
- The re-read is newer, from the same document, at the same amount, variant, audience and product.
  It is verified, and it is not live itself.
- It reads the same printed line. Its stored line is printed once in the document's newest
  completed text and prices the amount once. The live read's stored line must be that line, with
  glyphs, ligature letters and punctuation folded away, or one must be a wider window of the other.
- The frequencies do not differ. The re-read keeps the live category, or the guard fails the new
  name under the live category and its re-file rule names the re-read's category.
- The new name is a strict improvement of a known kind, with every other word unchanged:
  - `glyph_repair`: each U+FFFD is read as a ligature Word draws, or a dropped ligature is put back
    in a listed fee word;
  - `channel_clause`, for a wire only: every old word is kept in order, and the added words (five
    at most) state a channel (`statesWireChannel`, new in `wire-channel.ts`).
- Publish would not hold the name. The guard accepts it under the re-read's category, and
  `checkFeeAgainstSource` traces it at the amount in the newest text.
- Only one new name passes for the fee, and no other live fee of the bank shows that name at that
  price.

Anything else keeps its name. The rename writes only `fee_name`, guarded on the old name and
category. It logs the old name in `pipeline_feedback` (kind `live_name_refreshed`, with the re-read's
ids and source line) and an agent run event. A renamed fee is judged afterwards by the category guard's
own live pass. That pass moves it where a guard re-file rule names a home (`restoreTarget`). Otherwise
its second look takes the fee down, and the re-read publishes in its place. This adds no new re-file
path.

**Switch:** the refresh writes only with the environment variable `LIVE_NAME_REFRESH_LIVE=true`
(read with `flagOn`; spaces, quotes and capitals are tolerated), and never in a dry run. It is off by
default. Switched off, or in a dry run, it reports the renames it would make in the verify step's
summary and in its `live_name_refresh` detail. Switched off, it also records the event. The full
read joins every live fee to its document's newer reads and took 23 s on prod (Oct 27), so a step
runs it at most once every `LIVE_NAME_REFRESH_INTERVAL_HOURS` (6), keyed on its last event. A read
scoped to one institution runs every time.

**Dry run** (prod, read-only, Oct 27). The step's own read (`LIVE_NAME_REFRESH_ROWS_SQL`) found
197 candidate pairs for 176 live fees at 135 institutions on 136 documents. Each pair was judged with
`findLiveNameRefreshes`. The texts of the 6 documents whose pairs pass the name test were fetched and
checked; every other pair fails the name test before the text is read.

| Live fee | Inst | Doc | Old name | New name (re-read raw / verified) | Stored line (newest text) | Outcome | Guard afterwards |
|---|---|---|---|---|---|---|---|
| 61057 | 7213 | 18129 | Stop Payment Order (dra� or EFT) | Stop Payment Order (draft or EFT) (1174896 / 214321) | "Stop Payment Order (draft or EFT) \| $30.00" | refresh | passes as stop_payment |
| 124887 | 6765 | 26441 | NSF/Overdra� Fee (per item) | NSF/Overdraft Fee (per item) (1184079 / 215149) | "• NSF/Overdraft Fee (per item) \| $30.00" | refresh | passes as nsf |
| 133131 | 8739 | 28625 |  GASCU member transac�on at non GASCU or non-Co-Op Network ATM |  GASCU member transaction at non GASCU or non-Co-Op Network ATM (1183574 / 215114) | "... Network ATM............ $1.00" | refresh | passes as atm_non_network |
| 133140 | 8739 | 28625 |  Wire transfer - Outgoing (domes�c only) |  Wire transfer - Outgoing (domestic only) (1183585 / 215117) | "... (domestic only) ...... $20.00" | refresh | passes as wire_domestic_outgoing |
| 140286 | 2521 | 31383 | Wire Interna�onal Transfer-Remote Outgoing | Wire International Transfer-Remote Outgoing (1186050 / 215327, `wire_intl_outgoing`) | "Wire International Transfer-Remote Outgoing ..$70.00*" | refresh | fails as wire_domestic_outgoing ("International"); there is no re-file rule, so it comes down on the guard's second look and 215327 publishes as wire_intl_outgoing |
| 144305 | 5072 | 2240 | Account Reconcilia�on Fee | Account Reconciliation Fee (1161591 / 213041) | "Account Reconciliation Fee \| $25/hour" | refresh | passes as account_research |

All 6 movers were sampled against their bank's newest stored text with `checkFeeAgainstSource`, and
6 of 6 trace on the line shown. The other live U+FFFD names keep their names:
- 33514 "Paid Check/Dra� Photocopy" and 61056 "Share Dra� Photocopies": `category_differs`.
  The re-read files them as `check_image`, while the live rows are `document_reproduction`, and no
  guard re-file joins the two. The repair is good, but the category disagreement is a separate
  question.
- 61063 "Low Balance Fee Tradi�onal Checking": `not_same_line`. The re-read's stored line joins
  the name and its next-line price with " / ", and the text never prints that line.
- 14526, 82311, 140283, 144304: `not_an_improvement`. The re-read is another reading, and words
  were dropped or the line was cut differently.
- 50008 "Lost Debit Rewards Card Replacement �... 1st Free": no verified, unpublished re-read
  of its line passes the step's read.

Outcomes over the 176 live fees: 6 refresh, 2 category_differs, 1 not_same_line, 167
not_an_improvement. 1 of the 6 (140286) then fails the guard under its live category.

The channel cases are not in the dry run because they have no re-read yet. 7711's documents were
last read on Oct 11 and 4366's on Oct 20. Today's free read (`runFreeSpecialists`, rules only) of
their stored texts (21982, 36830) names 110356 "Outgoing Domestic Wire Transfer (phone request)" and
71592 "Outgoing Domestic Wire fee (Recurring)". Judged as re-reads, both come out `refresh`
(`channel_clause`). The same free read gives no $55 read at all on 7711's text, so 110355 cannot
take its channel from a free re-read. That is a new checklist line.

**Lesson:** refusing a second read of a live line keeps the line shown once, but a refusal must not
also throw the better name away. When a re-read names the same line better, in a strict and
traceable way, the live row takes the name in place, and the guard judges it afterwards like any
live fee.

**What stops a repeat:**
- Agent lessons: hamilton/issue-1912-reread-name-reaches-live-fee and
  knox/issue-1912-a-better-read-must-reach-the-live-name.
- Guards: `src/lib/agents/hamilton/live-name-refresh.test.ts` and `src/lib/wire-channel.test.ts`.
