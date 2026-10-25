# 2026-10-25: a newer copy with the same text was rejected, so its page's fees stayed on the old copy

**Lesson:** Judge a page, not a copy: when a newer copy of a page holds exactly the text of an older
copy Knox already read, give it the older copy's verdict. A rule that spares "a text Knox already
pulled fees from" has to spare that text on every copy of the page, or the page's current copy is
rejected while its fees stay live on a copy nothing checks any more.

**What happened (#2477, last open item):** 2,573 live fees (470 current copies, 440 banks) came
from a superseded copy of a page whose current copy had no live fee at all (read-only prod read,
2026-10-25; the issue counted 2,549 on Oct 20). Grouped by where each current copy stopped:

| Where the current copy stopped | Copies | Live fees on the older copies |
|---|---:|---:|
| Knox read it, rows wait in Darwin's queue (no Darwin decision yet; 53 of the 57 copies with only undecided rows are in Texas, whose lane decides about 460 rows a run, roughly once a day) | 58 | 842 |
| Rosetta judged it `wrong_document` | 285 | 684 |
| ... of which the text is identical to the older copy's (229 older copies, 186 banks, all rejected by the product-page rule, #1053) | 202 | 441 |
| Darwin verified rows, none published | 64 | 381 |
| Rosetta never read it (no text) | 20 | 302 |
| Read, Knox found no fee rows | 16 | 222 |
| Published, then taken down | 14 | 83 |
| Knox rows not sent to Darwin | 8 | 42 |
| Darwin rejected every row | 5 | 17 |

No current copy in the set carries a stated date yet (`stated_date_version` is NULL on all 470;
Magellan's #2615 pass has dated 1,151 of 18,030 current copies so far), so a future-dated edition
(R4, #1915/#2573) could not be measured as a cause here; none of the 470 is known to be one.

The Darwin queue group is waiting, not stuck: its rows were written by Knox's second wave
(Oct 21-24) and have no Darwin attempt yet. The largest group that cannot clear on its own is the
`wrong_document` one.

**Cause:** Rosetta's fee-page check judged each copy of a page on its own. Its triage pass spares a
text Knox already pulled fees from (`triageEarlierTexts`, `has_knox_fees`), but only by document.
Magellan stores a new copy whenever a page's bytes change; an HTML page whose bytes changed and
whose text did not (a nonce, a tracking tag) got a newer copy with no Knox rows yet. At read time
the product-page rule (fee-page check v2) rejected that copy as `wrong_document` and sent the bank
back to Magellan, while the older copy, with the same text, stayed readable because Knox had read
it. Knox never reads a `wrong_document` text, so the current copy never got rows; Darwin had
nothing to verify; Hamilton's refresh had no current-copy row to move the live fee to; and the
fees stayed on the superseded copy, outside every current-copy check. 202 of the 285 rejected
current copies have exactly an older copy's text, every one rejected by the product-page rule.

**Fix:** `src/lib/agents/rosetta/same-text-copy.ts`.
- At read time (live): a read the fee-page check rejects is kept readable when an older copy of the
  same page (superseded by this document, same bank) holds the same text hash and Knox rows sent to
  Darwin. The page check's own verdict stays on the attempt, the attempt records
  `same_text_copy_of`, and the bank is not sent back to Magellan. Triage spares such a text too.
- The backlog (`reopenSameTextCopies`, `SAME_TEXT_COPY_REOPEN_LIVE = false`): each read step counts
  and samples the rejected current copies the rule covers (`rosetta.same_text_copies` event); live,
  it sets them to `completed` with a `read.same_text_copy` attempt. Dry run on prod (Oct 25): 714
  current copies at 641 banks, 712 of them product-page rejections; 451 live fees sit on their older
  copies.
- No fee moves in this change. Once a copy is readable, Knox reads it, Darwin verifies its rows, and
  Hamilton's refresh moves a live fee only when the current copy's row is the same line, so no Darwin
  live re-check is needed for this rule. A changed text is still judged on its own.

**Before switching the backlog on:** the 10 sampled pages are account and product pages
(Evolve, UMB, Timberland, North State Bank's cash-management page). Some of their live fees read
oddly ("No monthly service charge: Only $5.00", a safe deposit line read as $10.00). Reopening
them lets Knox, Darwin and Hamilton's checks judge those pages again under today's rules, which is
the point, but the reviewer decides whether the product-page rule or the "Knox already read it"
exemption should win for these pages before the switch flips.

**Agent lesson:** rosetta/issue-2477-same-text-same-verdict

**Guard:** `src/lib/agents/rosetta/same-text-copy.test.ts`, `src/lib/agents/rosetta/read.test.ts`
