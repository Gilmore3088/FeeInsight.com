# 2026-10-25: stored texts carry U+FFFD where a glyph or a byte was not read (#2598)

**Lesson:** The replacement character in a stored text means a letter was lost before Knox ever
saw it. Find where it came from: a PDF whose own ToUnicode map says "unknown" cannot be decoded,
so restore only what one reading allows; bytes Rosetta decoded in the wrong charset can be read
right, so decode them in their own.

**What happened:** live fee 140286, "Wire Interna�onal Transfer-Remote Outgoing" $70, is filed
as a domestic outgoing wire: Knox and the category guard never saw the word "International".
Read-only production counts on 2026-10-25:

| Measure | Count |
|---|---|
| `agent_source_texts` rows containing U+FFFD | 219 (219 documents, 77 institutions) |
| of them completed | 193; 121 are their bank's current copy (70 institutions, 120 in the vault, 35 PDF) |
| by reader (all statuses) | `read.pdf_layout` 44 texts / 20,796 glyphs; `read.html_dom` 152 / 1,369; `read.js_fallback` 16 / 25; `read.plain_text` 2 / 49; no reader 5 / 11 |
| `source_documents` | stores no text, so none |
| completed texts with a U+FB00-U+FB06 ligature | 109 texts at 37 institutions |
| live fees (`published_fee_catalog`, 85,644 rows) with U+FFFD in the name | 15 |
| live fees with U+FFFD in the name or the stored excerpt | 73 at 12 institutions, 12 documents |

What the glyph stands for, from the PDF texts' word shapes: in words it is a Word ligature, mostly
"ti" ("Interna�onal", "transac�ons", "no�ce"), also "ft" ("Overdra�",
"a�er"), "tti" ("submi�ng"), "ff"/"ffi" ("di�erence", "o�ce"), "fi"
("speci�cally") and a lone "f" before i ("pro�it"). Elsewhere it is a decimal point
("$14�95"; Knox kept $14 for that Bill Pay fee before), a full stop after a word
("account�", 1,465 word-final glyphs), dot leaders (runs) and bullets or check boxes (lone).
A few scanned-text layers carry random letters ("ch�ck"). In HTML it is a Latin-1 byte decoded
as UTF-8: "Zelle�" on a page served as ISO-8859-1, "� 2026" for the copyright sign.

**Cause:** two places. PDFs: Microsoft Word's export maps the ligature glyphs to U+FFFD in the
font's ToUnicode map (most likely; the vault and the banks' sites were unreachable from the
session, so no original PDF was opened). pdf.js passes that map on faithfully; a test PDF whose
map sends one code to U+FFFD reads exactly that way. The letters are not in the text layer, and
Rosetta stored the glyph as it came. HTML and plain text: `read.ts` decoded every page as UTF-8
whatever its charset.

**Fix:** `src/lib/agents/rosetta/glyph-repair.ts`, `GLYPH_REPAIR_VERSION` v1. The PDF reader
restores a glyph only where one reading is possible: U+FB00-U+FB06 to their letters; a dollar
amount's glyph before exactly two digits to "." when it cannot be a range (cents "00" or not above
the dollar figure), or when the document writes the glyph as its decimal before "00" and never
between two dollar figures (all 85 such glyphs in current prod texts qualify); a word's glyph when exactly one ligature spelling
is a known word (a list of 1,093 such words printed at 10+ institutions in a prod sample, plus the
document's own clear words), and at a word's end only when the letters before it are not a word
the document prints on its own. Runs, lone glyphs and words with no single reading stay. HTML and
plain text get only ligature expansion and the charset fix: they keep valid UTF-8, and a page that
is not valid UTF-8 is read in its declared charset, or, when that is UTF-8, Windows-1252 or none,
sequence by sequence: valid UTF-8 stays UTF-8 and only a byte that starts no sequence is read as
Windows-1252 (a first version decoded the whole page as Windows-1252, which would have turned every
"’" on a UTF-8 page with one raw 0xA9 byte into mojibake; review of PR 2649). A
completed text with U+FFFD or a ligature is read once per glyph-repair version (`read.ts`, witness
`detail.glyph_repair`), and each read of a due text leaves a `read.glyph_repair` receipt, so an
access failure or a skipped read settles the text instead of reselecting it every run.

**Dry run (rule applied to prod data, record-only):** of 1,130 in-word glyphs in completed PDF
texts, 1,096 are restored and 34 stay (scan noise, web addresses, words outside the list); of
1,465 word-final glyphs, 134 are restored. Of the 73 live fees, 35 would read differently
(12 names, 35 excerpts); the other 38 carry only leader runs or bullets. The re-read wave is 173
current copies at 100 institutions (121 with U+FFFD, 52 with only a U+FB00-U+FB06 ligature), 172
of them in the vault: free reads, no provider spend.

**With #2477's same-text rule (merged first):** older copies of a page are never read again, so
their stored text keeps the glyphs a new read of the page now restores, and the new copy's text
hash no longer equals the older copy's. Without a fix, the next copy of such a page would lose the
rule and be rejected by the product-page check. A read now also matches an older Knox copy
glyph-blind when the exact hash finds none (`sameTextGlyphBlind` in
`src/lib/agents/rosetta/same-text-copy.ts`). Glyph-lane re-reads of completed texts were already
safe: their earlier text is kept on a rejection and the bank is not sent back. Prod, 25 Oct
(read-only): 21 current copies at 20 banks have a same-text older Knox copy whose text carries
U+FFFD or a ligature, 7 of them `wrong_document`.

**Not yet known:** whether the old garbled live rows fold into the new correctly named ones or
are taken down by Darwin's live re-check when the excerpt no longer matches the new text. That is
measured after the wave.

**Guard:** `src/lib/agents/rosetta/glyph-repair.test.ts`, `src/lib/agents/rosetta/same-text-copy.test.ts`, `src/lib/agents/rosetta/read.test.ts`
