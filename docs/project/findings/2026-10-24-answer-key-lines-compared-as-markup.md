# 2026-10-24: answer-key lines were compared to the bank's page as markup, not as fee content
**What happened:** after #2468 the daily score runs (Oct 20-24) admitted at most 2 of 62 answer keys.
Read-only on prod, the Oct 23 run (11879) had 44 keys whose consumer fact was
`key_line_not_in_reference`: a confirmed key line was not found in the freshly observed document.
**Cause:** the key's lines and the observed text were compared after whitespace collapse only.
- Many key lines were copied from stored table text, so they carry cell separators:
  `| NSF Fee | $25.00 per item |`. A web page's own cells, as the HTML reader extracts them, have no `|`.
- The HTML reader (`htmlToScoringText`) decodes only `&nbsp;`, `&amp;` and `$` entities. A page
  writing `Cashier&#8217;s checks` or `VISA&reg;` never matches a key line with `’` or `®`.
- Dot leaders (`checks.......$4.00`), bullets and missing spaces in PDF text (`throughInternet`)
  differ between the key's copy and a later read of the same document.
Same words and prices, so the key was refused only because of the formatting.
**Fix:** the eligibility comparison (`compact` in `src/lib/data-store/answer-key-eligibility.ts`)
decodes HTML entities, drops cell separators, dot leaders, bullets and all whitespace, and unifies
curly quotes and dashes on both sides. Every remaining character must still match in order: a
different price or word still fails, digits split by a break or separator never join into another
number ("$2" then "5 or more" is not "$25"), and a line of separators only counts as missing.
**Measured:** against each key's stored source text (a proxy; live pages cannot be fetched from the
build container), matching lines rose from 1,079 to 1,334 of 1,449, and keys with every line present
from 24 to 27 of 41. The real effect is the eligible count on the next score run.
**Still open (on #2466):** key lines that differ in wording from the current document (the document
changed after the key was confirmed, e.g. a newer edition), 28 HTML pages failing
`reference_main_text_changed`, and 14 `priced_schedule_unproven`.
**Agent lesson:** deming/issue-2466-line-content-match
