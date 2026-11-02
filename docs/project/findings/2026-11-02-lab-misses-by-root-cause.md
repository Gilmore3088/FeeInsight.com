# 2026-11-02: The shadow lab's 356 answer-key misses, sorted by root cause

**What happened:** On main eaf6bef, before #2883, #2885 and #2888, the shadow lab
(`npm run test:shadow-lab`) published 956 of 1,312 answer-key fees and missed 356. One hand-labelled
pass assigned each miss one root cause (`R1` to `R18`). The labelled rows (fields `label`, `case`,
`key`, `amt`, `stage`, `doc`, `src`) are committed beside this finding as
`data/2026-11-02-lab-misses-by-root-cause.json` (356 rows), and every count below is recounted from it.

**Method and limits:** a single pass by one analyst, with no second reviewer, so borderline rows could
move between groups. The labels are not a test oracle. They were checked against a sample of rows per
label, not row by row. Counts are of misses, not of fixable fees. The lab's `missed_fees` scenario
holds 41 frozen answer-key source texts (`frozen-inputs.json`); 40 of them hold the 356 misses. 181
misses are in PDF texts and 175 in HTML texts. By stage: not read 125, read in another category 98,
read at another price 77, held at extract 25, verify 20, publish gate 11.

| Label | Misses | Root cause (read from the rows) |
|---|---|---|
| R1 | 54 | The category is only in a heading or column header, not on the fee's line |
| R2 | 51 | HTML: the label and the price sit in separate blocks (all 51 are HTML) |
| R3 | 44 | Several prices on one row, or `<br>` items inside a cell flattened by `html-dom.ts` |
| R4 | 36 | PDF columns interleaved or flattened, in texts read before pdf-layout v2 to v5 (all PDF) |
| R9 | 34 | A clean "Name | $X" row with no category; #2888 has since fixed part of this group |
| R8 | 25 | The price shape on the line ("Up to $32.00", "Free; for non-members $5", "No Maintenance Fee") |
| R6 | 22 | Category overlaps: the fee fits two categories (20 of 22 read in another category) |
| R5 | 19 | "First N free" or a free allowance keyed as $0 |
| R10 | 12 | The fee is stated in a sentence, not a row |
| R7 | 11 | Clearly the wrong category (10 of 11 read in another category) |
| R13 | 10 | A cutoff-name hold at the publish gate (all 10 stop at publish) |
| R12 | 9 | E-statement lines that state free and paid in one line (5 stop at verify, 4 not read) |
| R16 | 7 | Mixed single lines: statement print-outs, a bare "per check" price, a neighbouring row's fee |
| R11 | 6 | Verify refuses a fee that reads in the key's category and price (all 6 stop at verify) |
| R17 | 5 | Daily-cap keys whose line is another fee's (3 held at extract); #2885 has since touched this shape |
| R11club | 5 | Club and holiday-account withdrawals filed as early closure; all 5 stop at verify |
| R15 | 4 | International wires held at extract (all 4) |
| R18 | 2 | Deposit adjustments read beside the wrong fee |

**Totals:** R1 to R4 are 185 of 356 (52%), and all four are about how Rosetta and the HTML reader
flatten structure (heading levels, table cells, separated blocks, interleaved columns). R6, the
category overlaps, is 22.

**Cause:** the lab replays text Rosetta has already flattened. A miss whose root cause is a lost heading
level, a split table cell or an interleaved PDF column is not visible to the stages after Rosetta, and
a structural Rosetta fix cannot show up in the lab, because the lab never runs Rosetta on the bank's
document.

**Lesson:** a structural Rosetta fix cannot be measured until the lab replays the source bytes. Until
then, text-only shape rules for the R1 to R4 groups cost many review rounds for few fees (#2872, #2888).

**Guard:** checklist line: the 2026-11-02 checkpoint names replaying source documents in the lab as
the next step for Rosetta heading levels and the R1 to R4 groups.
