# 2026-11-03: A fee type printed only in a heading is read from the HTML's own headings, or not at all

**What happened:** class R1 of the lab's answer-key misses is a fee whose type is printed only in a
heading or a column header, not on its own line (`2026-11-02-lab-misses-by-root-cause.md`: 54 of 356).
On the source-bytes replay (`2026-11-02-lab-replays-source-bytes.md`) 53 were still missed, 14 of
them on HTML pages. Rosetta's stored text keeps no heading levels, so a heading and any short line
look alike to Knox, and every attempt to infer a heading from a line's shape lost to review: #2872's
retired-section half (four rounds), #2888's bare "Title Fee" (three) and the PDF column reader #2965
(six, closed).

The two examples in the task are PDFs, so out of scope here: state:10193 "Non-Customer | $35.00"
under "Cashier's Check" and state:8085 "Outgoing (Online) USD | $ 35.00" under "WIRE TRANSFER".

**Fix (behind `HTML_HEADING_CONTEXT_LIVE`, off):**
- **Rosetta** (`rosetta/html-heading-scope.ts`, `html-dom.ts`): the HTML reader records which real
  heading each line sits under: an `h1`-`h6` or `role="heading"` element, a table's header row (`<th>`
  cells only, or a `<thead>` row; a one-cell header heads the rows, a wider one by its cell over the
  rows' names), or a heading element alone in a one-cell table row. Scope follows the HTML outline: the
  next heading of the same or a higher rank, or the end of a sectioning element or root, ends it; a
  table's own header is nearer than any heading above the table. A hidden heading (`hidden`,
  `aria-hidden`, `display:none`, a screen-reader-only class) or one in a nav, header, footer, aside,
  form or dialog is refused and blocks the heading above it.
- **Format** (`src/lib/heading-context-trailer.ts`): a trailer line after the text, `⟦heading-context:1⟧
  n=<lines> h=<hash> s=<spans>`, made of digits and punctuation only. Why a trailer: the text above it
  is byte for byte main's, so no line, offset or lookback any reader takes moves; `runFreeSpecialists`
  and `checkFeeAgainstSource` strip it first, so Knox, Darwin's re-reads and Hamilton's re-check all
  read the same fees from one stored text; it needs no migration (a side column would) and it reaches
  the shadow lab, which replays text. A trailer whose line count or FNV-1a hash does not match the text
  above it is ignored. With the switch off the reader writes no trailer, and `extractHtmlDomText`'s text
  is the same with the switch off or on. The JavaScript fallback writes none.
- **Knox v177** (`knox/heading-category-rows.ts`): only when a priced row's own name files nowhere and
  main gives its line no read with a category, and only when its structural heading names one fee type,
  the row is read once more with the heading in front of its name, in the document around it, and
  admitted only as exactly one fee of that type's family at the row's own price that the shared check
  traces. Refused: a row with two prices or $0, a heading with a figure, a list ("and", "&", "/", ","),
  an account or product word, or the monthly maintenance type. Admit-only: main's reads stay whole and
  in order, and a held unclassified row it reads leaves the held list.

**Near-miss tests first:** 64 in `knox/heading-category-rows.test.ts` (an account heading over
unrelated fees, "Fees", "Other Services", "Miscellaneous", two types in one heading, a th naming
"Amount", a th row naming columns, nested headings, a nearer heading naming nothing, a section's end,
hidden headings five ways, a heading in a nav, footer, header, aside and navigation landmark, bold
paragraphs and full-width bold cells, a `<br>` inside a heading, tampered trailers), and 8 in
`rosetta/html-heading-scope.test.ts`.

**Measured** on the source replay (`source-replay.test.ts`, experiments `html-heading-context` and
`html-heading-context-with-row-pairing`; 38 documents, 20 of them HTML; same keys and pipeline both
sides):

| Measure | Switch off | Switch on |
|---|---|---|
| Re-read recall, row pairing off | 898 / 1,187 (75.7%) | 900 / 1,187 (75.8%) |
| Re-read recall, row pairing on | 914 / 1,187 (77.0%) | 916 / 1,187 (77.2%) |
| Keys lost (either) | | 0 |
| Published fees not in the answer key, pairing off / on | 29 / 30 | 29 / 30 |
| HTML R1 misses still missed | 14 | 12 |

- **Keys gained (2, the same with row pairing on or off), each checked against the bank's page:**
  - state:10500 night_deposit:2500: Sterling Federal Bank's `<h2>Night Depository</h2>` over the list
    item "Bag Replacement: $25.00 each", read "Night Depository - Bag Replacement" $25.
  - state:12821 atm_non_network:300: Lenco FCU's table row `<td colspan="2"><h2>ATM Service</h2></td>`
    over "All Other Transactions | $3.00", read "ATM Service - All Other Transactions" $3.
- **Publications outside the key:** none added, none removed.
- **Admit test** (`shadow-lab/heading-context-admit.test.ts`): on all 252 frozen lab texts (no trailer)
  Knox's free read equals main's read by read; on the 20 HTML re-reads with the switch on, row pairing off
  and on, every read of main's is kept in order, nothing is newly held, and the only reads added are the
  two above (pinned). Every default re-read of the 38 documents stores no trailer.
- **The frozen-text lab, the ratchet, the quality gates and the golden gate do not move:** they replay
  text with no trailer, which Knox reads exactly as main.

**The 12 HTML R1 misses still missed, and why each is refused:**
- Main already files the row, so admit-only leaves it: state:10358 "Balance Inquiry" (read
  balance_inquiry $0.50; its h3 "ATM/Debit Card Fees" is also a list), state:10500 "Key Replacement:
  $8.00 each" (read as a safe deposit box key under "Night Depository": a wrong read main makes, left for
  a category fix, not this switch).
- The heading is not markup: state:5703 (a `td class="rates_subheader"`, and a $0 row), state:3141 x3
  ("Checking Accounts" in a `<p>` and an accordion `div`, and an account heading), state:3554 (a bold
  `<td colspan="3">` "WIRE TRANSFER", no `<th>`).
- The heading names an account or nothing the classifier files: state:10279 (h3 "Business Checking
  Fees", and the table's own "Item | Fee" header is nearer), state:11470 (th "Member Service"; the row
  prints two prices), state:12752 (th "SAFE BOX FEES", which no rule files).
- Mislabelled R1: state:2017 dormant_account and mobile_deposit name their type in the row's own first
  cell.

**Before the switch flips:**
1. `HTML_READ_VERSION` moves with it (base plus one per HTML reader switch on; `reader-replay.test.ts`
   fails otherwise). Row pairing has v2 reserved; whichever flips first takes v2, the second v3.
2. James runs the switch dry-run audit, section 11: the current HTML documents and live fees a flip
   would reach once re-read (exposure only: the audit has no bytes). A live fee the paid read took from a
   line the free read now names in another category would be a re-file candidate for Darwin's re-read
   category check; the audit cannot count those.

**Lesson:** read a page's structure from its markup, record it beside the text without changing the
text, and let a later stage act on it only where the markup is positive evidence; refuse every other
case and fall back to main's reading. Most R1 misses on HTML pages are not markup headings at all, so the
honest gain is small.

**Guard:** `knox/heading-category-rows.test.ts`, `rosetta/html-heading-scope.test.ts`,
`shadow-lab/heading-context-admit.test.ts`, `shadow-lab/source-replay.test.ts`,
`rosetta/reader-replay.test.ts`, `deming/switch-dry-runs/run.test.ts` (section 11). Agent lessons:
rosetta/issue-1092-keep-the-heading-a-line-sits-under, knox/issue-1092-heading-names-the-row-only-on-structure.
