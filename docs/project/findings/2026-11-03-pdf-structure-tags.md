# 2026-11-03: PDF structure tags reach almost none of the PDF misses

**What happened:** after geometry failed to read PDF columns (#2965, closed;
`findings/2026-11-03-pdf-columns-need-structure.md`) and HTML outline headings failed to name
categories (#2972, closed), James chose a new source of evidence (Nov 3). Many PDFs carry
structure tags (Tagged PDF: `/MarkInfo /Marked true`, a `StructTreeRoot` with Table, TR, TH, TD,
H1 to H6 and L/LI, tied to the page text by marked-content ids, MCIDs). A table cell tag is
something the bank's own software wrote, so it would not be a guess from geometry. This finding
measures what the tags could reach before any reader is built. Its outcome is **no-go**, and no
production code changed.

**Method** (read-only, offline, with the pdf.js that `unpdf` 1.4.0 already ships; no new
dependency):
- **Documents:** the 18 PDFs in `src/lib/agents/deming/__fixtures__/source-bytes/`, plus the
  state:60 (Georgia United) Internet Archive capture. That is the 2026-03-17 `id_` capture named in
  the manifest's `archiveTried`, fetched with plain curl. Its sha256 is `3896c6fc…f811`, the one
  the manifest records.
- **Census:** for each document, `getMarkInfo()`, each page's `getStructTree()`, and
  `getTextContent({ includeMarkedContent: true })`. Each text item belongs to the MCIDs open
  around it. A priced item is one whose text holds `$` and a digit, or a figure with two decimals.
- **Replay prototype:** where every priced item on a page sits under a TD or TH tag, the prototype
  writes that page from the tags: one TR per line, cells joined by " | ", P, LI and Hn elements as
  lines of their own. Any other page keeps main's `read.pdf_layout` text. The result runs through
  the source-bytes replay with `currentVariant`, against the same keys.
- **Files:** the census script, its output (`tag-census.jsonl`) and the replay probe are committed
  under `findings/data/2026-11-03-pdf-structure-tags/`, as `.txt` files so they do not run in CI.

**Census: 11 of 19 PDFs are tagged, but only 3 have tags that cover their priced text.**

| Document | Pages | Tagged | Structure types (count) | Priced items in TD/TH | Pages the tags could read |
|---|---|---|---|---|---|
| state:10193 | 4 | yes | P 217, TD 136, TH 66, TR 64, LI 42, L 18, Table 3 | 110 / 110 | 3 / 4 (page 1 has no prices) |
| state:3515 | 2 | yes | P 127, TH 55, TR 54, TD 52, Table 3 | 56 / 56 | 2 / 2 |
| state:7450 | 1 | yes | TD 290, P 290, TR 59, Table 1 | 140 / 140 | 1 / 1 |
| state:8240 | 4 | yes | Span 643, P 269, TD 83, LI 24, TR 12, Table 2 | 12 / 97 | 0 / 4 (partly tagged) |
| state:3981 | 2 | yes | P 118, Figure 12, H1 5, H2 5, H3 1 | 0 / 54 | 0 / 2 |
| state:3148 | 1 | yes | P 113 | 0 / 52 | 0 / 1 |
| state:6820 | 1 | yes | P 92 | 0 / 40 | 0 / 1 |
| state:7114 | 1 | yes | P 86, LI 3 | 0 / 42 | 0 / 1 |
| state:8085 | 1 | yes | Span 197, P 170 | 0 / 72 | 0 / 1 |
| texas:2451 | 14 | yes | Figure 16 only | 0 / 163 | 0 / 14 |
| texas:841 | 12 | yes | P 441, TOCI 54, Link 54 | 0 / 97 | 0 / 12 |
| state:11362, state:1338, state:4677, state:6730, state:8036, state:8741, texas:2429, state:60 | 1 to 20 | no | none | none | none |

- Where tags exist, the MCIDs resolve to text: from 60% (texas:841, mostly TOC links) to 99%
  (state:7450) of content references, and all 16 on texas:2451. So pdf.js reads the tags. The tags are just rarely tables.
- Five tagged files mark every line as a plain P or Span. Their tags give reading order, but no
  cell boundary and no heading level a price sits under. texas:2451 tags each page as one Figure.

**Lab misses mapped to the tags** (the R labels come from
`findings/data/2026-11-02-lab-misses-by-root-cause.json`, counted for these 19 documents only):

| Group | Misses here | On pages tags cover | Untagged | Tagged as P / Span / Figure only | Partly tagged (8240) |
|---|---|---|---|---|---|
| R1 heading-only category | 40 | 3 (10193) | 11 | 18 (3981 has H tags, but its prices sit in P) | 8 |
| R4 PDF columns | 36 | 2 (10193) | 17 (texas:2429 10, state:60 4) | 16 | 1 |
| Wrapped PDF cells (state:60, `findings/2026-11-03-pdf-word-gaps.md`) | 14 | 0 | 14 | 0 | 0 |

- At most 5 of 90 misses sit on a page the tags cover, and all 5 are at state:10193. There the
  tags give one TD per product description: a whole paragraph of "Minimum to open / Maintenance
  Fee / Cash Processing Fee" text. The two products side by side still share one row, so the
  category still is not on the fee's line.
- The 14 wrapped-cell misses are in an untagged file. state:3515 shows that tags do join wrapped
  cells right ("Inactivity fees for checking (Monthly fee for accounts …) | $5.00"), but none of
  its 3 misses is a wrapped cell.

**Replay prototype (source-bytes replay, `PDF_TEXT_DIRECTION_LIVE` off):**

| Measure | Main's reading | Tag reading where tags cover the page |
|---|---|---|
| Recall: answer-key fees published | 922 / 1,216 | 921 / 1,216 |
| Keys gained / lost | | 2 / 3 |
| Published outside the key | 28 | 28 |
| Today's misses on the 3 covered documents | 25 (10193: 7, 3515: 3, 7450: 15) | 26 |

- Gained: state:3515 account_research $50 and state:7450 wire_intl_incoming $10.
- Lost:
  - state:3515 paper_statement $5. Its wrapped note "(No charge for paperless statement /
    e-statement)" now sits on the fee's own line.
  - state:7450 card_replacement $5 and cashiers_check $5. "1 Free → $5" and "3 Free " $5" now
    stand in their own cells, one per tier.
- On state:10193 the tags change the text (whole cells, footers dropped) but not one key.
- `PDF_TEXT_DIRECTION_LIVE` on gives the same table: no replayed PDF has a sideways page, and the
  only sideways file, state:60, is untagged. So the tag path falls back on each of its pages with
  the switch on or off, and leaves its text as main reads it.
- The other 16 PDFs fall back to main's reading on every page.

**Cause:** tags are a positive signal only where the bank's software wrote table structure, and
these fee schedules mostly were not built that way. 8 of 19 have no tags at all. 7 of the 11
tagged files mark only paragraphs, spans or figures. Of the 4 with table tags, 1 is too partly
tagged to use. On the other 3, main's layout reader already reads the rows right: state:7450's
text differs only by the " | " between cells. The misses there come from what Knox does with a
tier matrix (R3), not from row boundaries.

**Fix:** none. Per the Phase 1 rule (only build if the measurement pays), no
`PDF_STRUCTURE_TAGS_LIVE` reader was built. The ceiling is 25 of 294 re-read misses on documents
the tags fully cover, and the prototype loses 1 key net with nothing gained outside the key.

**Lesson:** before building a structural PDF reader, count how many of the missed fees' pages
carry that structure. Tags are worth reading only where they hold the priced text, and here that
was 3 of 19 documents, with no net gain. The PDF column and wrapped-cell misses are mostly in
untagged files (texas:2429, state:60) or in files tagged only as paragraphs. Any next attempt
needs evidence that works without tags (a layout model), or a Knox fix for tier matrices on the
rows the reader already gets right.

**Guard:** checklist line on #1092 recording this no-go and its numbers. The census script and
replay probe in `findings/data/2026-11-03-pdf-structure-tags/` re-measure any new fixture PDF
before a structure-tag reader is proposed again.
