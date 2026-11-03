# 2026-11-03: PDF columns cannot be read from geometry alone
**What happened:** PR #2965 (Rosetta reading PDF columns from geometry, switch
`PDF_COLUMN_READING_LIVE`, off) was closed without merging after six review rounds (#1092). Every
round, an adversarial reviewer found a realistic fee-table layout that the column rule split, losing
or misreading fees. The layouts: notes columns, wrapped descriptions, dot-leader and one-space
rows, partial "$" price columns, trailing text after amounts (/month, a footnote digit, (each)),
lower-case or bracketed notes under a header, Member | Non-member tiers, four-column tables, and
facing-page furniture (page numbers, footnotes, half-headings). Each fix narrowed the gain on the
source replay (#2939): 19, then 9, then 8 of 1,187 fees. The last head (b7e1f10) still published
wrong check_printing fees ($110, $125, $130, $18) on a Member | Non-member table with page numbers.
The branch `feat/rosetta-pdf-columns` is kept.

**Block-start share on the replay's 27 real splits** (as reported in the third-review fix,
c6997ba: the share of a split's right-side blocks that start on a priced left row):

| Share | Splits |
|---|---|
| 0.00 | 12 |
| 0.08, 0.16 | 2 and 3 |
| 0.07, 0.13, 0.14, 0.15, 0.19, 0.25, 0.29, 0.32, 0.33 | 1 each |
| 0.34 (max) | 1 |

The reviewers' fee-table shapes scored 0.50 to 1.00 against a threshold of 0.5, so the narrowest
sat exactly on it.

**The 8 last surviving gains** (898 to 906 of 1,187, 0 lost; head b7e1f10):
- state:7114 stop_payment 30
- state:8085 box 125, wires 15 and 17
- texas:841 check_image 1, wire 25, document_reproduction 2 and 5

**Cause:** a fee table is also two or more columns, and its notes, descriptions and second prices
take endless shapes. Geometry cannot separate independent content from one wide table.

**Fix:** none merged; the PR was closed. The measurements and attack cases are the spec for a later
attempt.

**Lesson:** do not add a geometric rule for reading PDF columns. A future attempt needs structural
evidence that geometry cannot give (tagged-PDF structure or marked content, or a layout model),
measured on the source replay from #2939, and every layout in the committed repros must keep its
rows.

**Guard:** the reviewer's repro layouts are committed in
`docs/project/findings/data/2026-11-03-pdf-columns-need-structure/` (`zz-adv` to `zz-adv7`, stored
as `.txt` because they import a module that is not on main). Any future column reader starts from
them as a checklist: each must read the same with the reader on as off.
