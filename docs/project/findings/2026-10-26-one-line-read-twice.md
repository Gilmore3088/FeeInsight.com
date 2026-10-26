# 2026-10-26: one printed line went live twice when its two reads differed in name or frequency

**Lesson:** Two reads of one printed line are one fee, whatever their names or frequencies. Compare
a row about to publish with the live fees from the same document and stored source line; when the
text prints that line once, with the price once, the frequencies do not conflict and one name's
words are all in the other's, it is the same fee.

**Agent lesson:** hamilton/issue-1876-one-line-read-twice

**Guard:** `src/lib/agents/hamilton/same-line-read.test.ts` (the rule and the publish read),
`src/lib/agents/hamilton/publish.test.ts` (publish refuses, counts with the switch off, defers on a
failed read), `src/lib/agents/darwin/same-line-read-check.test.ts` (18 prod groups from the dry run)
and `src/lib/agents/darwin/same-line-read-check.db.test.ts` (both reads in real PostgreSQL).

**What happened (#1876):** James's Oct 18 `/fees` audit found Access FCU's overdraft row opening to
several $30 records, and 1st Community FCU's to two $30 excerpts for one price. Traced on prod
(read-only, 2026-10-26):

- Access FCU (institution 7235, PA), doc 28555, text hash `a57bb83e...`. Three live $30 overdraft
  fees: 132907 "charge for each ATM overdraft" (raw 633863, line "- $30.00 charge for each ATM
  overdraft.") is its own line. 132908 "charge for each one-time debit overdraft" (raw 633864, no
  frequency, Knox's deterministic read) and 137315 "One-time debit overdraft charge" (raw 633887,
  per item, Knox's paid read of the same artifact #25928, 34 seconds later) are one line, "- $30.00
  charge for each one-time debit overdraft.", printed once in the document. The paid pass also read
  the ATM line (633886) and the NSF line (633885); Darwin held those as `duplicate_in_batch`, since
  their frequency matched the deterministic read's.
- 1st Community FCU (5314, TX): live 140652 "Basic Courtesy Pay" and 140653 "Enhanced Courtesy Pay",
  both $30 per item from doc 31635, are two programs on two lines ("Basic Courtesy Pay for | $30 Per
  Item" and "Enhanced Courtesy Pay | $30 Per Item"). Not a duplicate; they stay. Their second copy
  (doc 31636, raws 666798 and 666799) is verified and was never published.

**Why the second read got through:** Knox keeps every read as its own raw row by design. The
checks after it each missed this shape:

- Darwin's in-batch key (`batchKey`, v4) includes the frequency, so "per_item" and none are two keys.
- Hamilton's live-line read (`selectLivePublishedFees`) matches the frequency exactly. On Oct 11
  03:01 the paid read was skipped as identical to the only per-item $30 overdraft line, 132907, the
  ATM line. When that skip was decided again (19:41, same rule version), the page check set the ATM
  line apart, the unstated-frequency 132908 was never read, and 137315 published as a new line.
- The exact duplicate collapse needs the same name; the near-name collapse needs a one-word
  difference. "charge for each one-time debit overdraft" and "One-time debit overdraft charge"
  differ by word order and "for each".

**The class (prod, read-only, 2026-10-26, `SAME_LINE_READ_ROWS_SQL`):** 248 live dollar fees in 124
groups at 58 institutions share an institution, document, category, variant, amount, audience,
product and stored source line. Under the rule, 108 fees at 44 institutions are a second read and
would come down; 16 groups stay. Of the 108, 77 are safe deposit boxes: 76 of them Knox v99's
"Safe Deposit Box <size>" read (no frequency) live beside the older "<size>" read (annual), the same
frequency gap. 6 are overdraft, and the rest are single fees of 19 other categories. The 16 groups
that stay include two fees in one window (6852's "Courtesy Pay Fee" and "ACH Overdraft Fee", each
$31.00/item), four account columns ("$2 | $2 | $2 | $2"), lines printed 2 to 4 times in their
document, frequencies that differ (2562's $1.00 per withdrawal and $1.00 monthly) and names that
share no reading.

**Fix (Hamilton publish, live):** `same-line-read.ts` holds the one rule (`readsSameLine`). Each
dollar row about to publish is read against the live fees with its stored line
(`selectSameLineReadOf`) and, while `PUBLISH_REFUSE_SAME_LINE_READS_LIVE` is on, skipped as `Same
printed line as live fee #<id>` (step detail `same_line_read_check`). It takes no live fee down.

**Live re-check (Darwin, `same-line-read-check.ts`, v1, switch off):** each verify step reads the
groups, keeps the read that states its frequency (then the oldest) and matches the rest with the
same rule. `SAME_LINE_READ_TAKEDOWN_LIVE` is false, so it only reports. Switched on, a match goes
through the 12-hour second look and is archived as `same_line_duplicate: live fee #<kept>`, so
Hamilton's same-line restore brings it back if the kept read goes. Dry-run count: 108 live fees.

**Sample (seeded: every 11th of the 108 by fee id, plus Access FCU), each read against its
document's current stored text:** every one is a single printed line at a single price, so the two
rows are one fee.

| Taken down | Kept | Institution / doc | Stored line | Verdict |
|---|---|---|---|---|
| 23345 | 67479 | 101 / 11996 | "$2.50* per ATM transaction. In addition to our fee..." | one line read twice |
| 88235 | 53415 | 2211 / 13970 | "Notary Service - Customer \| item \| Free" | one line read twice |
| 132329 | 132331 | 2603 / 32822 | "...there will be an IRA transfer fee of $25.00" | one line read twice |
| 158225 | 66235 | 75 / 19575 | "5 x 5: $60.00" (box list) | one line read twice |
| 158331 | 144418 | 35 / 22562 | "6x16 $100" | one line read twice |
| 158412 | 53859 | 5140 / 16676 | "10x10 \| $65.00" | one line read twice |
| 158823 | 80971 | 651 / 36749 | "2 x 5 \| $30.00" (2.5 x 5 is its own row) | one line read twice |
| 159022 | 68049 | 5895 / 13781 | "3x10 \| $50.00 (Omega, Main Street, ...)" | one line read twice |
| 159095 | 24535 | 211 / 7629 | "9 x 10 \| $155" in a three-box row | one line read twice |
| 159229 | 51426 | 1014 / 13466 | "10x10 \| $175.00" | one line read twice |
| 132908 | 137315 | 7235 / 28555 | "- $30.00 charge for each one-time debit overdraft." | one line read twice |

**Not changed here:** Knox still writes a paid read of a line its deterministic read already
took, and Knox v99's box re-read carries no frequency where the older read had "annual"; both are
inputs the publish rule now absorbs. Darwin's in-batch key still compares frequency exactly.
