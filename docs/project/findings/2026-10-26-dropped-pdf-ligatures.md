# 2026-10-26: a PDF font drops its ligatures, so "International" is stored as "Internaonal" (#1513)

**Lesson:** A ligature a PDF font draws can come out as nothing at all, with no U+FFFD to mark the
loss. Restore it only in known fee words, and only when the same document shows the loss in at
least two different words.

**Agent lesson:** rosetta/issue-1513-dropped-ligatures

**What happened:** two live international wires were filed as domestic outgoing wires because
the stored PDF text lost the ligature in "International". Read-only production checks on
2026-10-26 (`published_fee_records` -> `verified_fee_observations` -> `raw_fee_observations` ->
`agent_source_texts`):

| Live fee | Bank | Stored fee name | Text | What the text holds |
|---|---|---|---|---|
| 42754, $50, `wire_domestic_outgoing` | Bay Area CU (7582) | `Wire Transfer Outgoing (Internaonal)` | 6266 (document 3092, `read.pdf_layout`, Oct 5) | nothing where "ti" was: the hex is `...496e7465726e616f6e616c...`. No U+FFFD, no U+FB00-U+FB06 |
| 140286, $70, `wire_domestic_outgoing` | Reliance State Bank (2521) | `Wire Interna�onal Transfer-Remote Outgoing` | 29159 (document 31383, `read.pdf_layout`, Oct 12) | U+FFFD (`efbfbd`) where "ti" was, 6 in the text |

Fee 140286 is the #2598 case. Glyph repair v1 already reads "Interna�onal" as
"International". Text 29159 has had no `read.glyph_repair` receipt yet; it is queued in that lane,
which was running (44 receipts in the 5 days to Oct 26).

Fee 42754 is a different pattern. The Bay Area font drops its "ti" and "ft" ligatures with no
character left: "Reconciliaon", "ACH Overdra", "relaonship", "Selecon", "Violaon",
"consecuve", "Inacve", "aer", "Reacvaon", "Transacon", "Domesc", "Internaonal" and
"Verificaons". Its "Sufficient" and "Official" are whole. The stored text's SHA-256 matches its
`text_hash`, so this is what the reader wrote. Nothing in the text marks the loss, so the glyph
repair due selection (U+FFFD or a Unicode ligature) never chose it.

**Pattern counts** (all 25,437 completed texts, read-only regex, 2026-10-26). These are texts
holding a dropped-ligature spelling of a fee word, with a space or punctuation on each side:

| Text | Reader | Broken words | Changed by the repair |
|---|---|---|---|
| 6266 (Bay Area CU) | pdf_layout | 12 different words | yes |
| 13094 (inst 2624) | pdf_layout | overdra, overdras | yes |
| 23754 (inst 5469) | pdf_layout | Ocial, Sucient (ffi dropped) | yes |
| 24946 (Marshland CU) | pdf_layout | Informaon, overdra | yes |
| 2451 (inst 61) | pdf_layout | one "Overdra" (prints "overdraft" 109 times) | no: one word |
| 12789, 12920, 22776, 24680, 30872 | html_dom / js_fallback | one "certicate" or "Cerficates" | no: a site's own typo, and not PDF |

No completed text holds a space-gap spelling ("Interna onal"). Live fees whose name holds a
dropped-ligature spelling: 5, all in texts the repair changes. They are 42754 "...(Internaonal)"
(wrong category), 42753 "...(Domesc)", 42757 "Account Research/Reconciliaon...", 125276
"Non-Sucient Funds / Overdraft Privilege Fees" and 125299 "Ocial Checks & Money Orders".
Run locally on text 6266's stored bytes, the repair restores 18 words and leaves no listed broken
spelling ("aer" stays). Each of the 5 fee names reads whole with its document's evidence. The
other 3 changed texts were measured by the SQL regex only, not repaired locally.

Two related patterns are left as they are, with counts. A font that writes the ligature as another
character: "overdra*s" and "transac5on" (text 22732), "Overdra(" and "DonaRo..." (text 10476).
A private-use code point in its place: U+E029 and U+E050 in text 10877 (inst 4415, 10 places),
behind 3 live fee names there (50106 "Overdra... (Non-Sufficient Funds)", 50112 "Outgoing Wire –
Domes...c including Western Union", 50119 "Legal Fees (includes domes...c rela...on orders...)").
Other private-use code points beside letters in 37 more PDF texts are mostly Symbol-font bullets
(U+F0A8).

**Why Rosetta, not Knox:** the loss happens when the PDF is read, and it breaks every word with the
ligature, not only category words. Overdraft, transaction, verification and domestic all name fee
types or conditions. A Knox rule that matched "interna onal" would fix one category and leave the
stored text, waiver text and fee names wrong. Rosetta already owns glyph repair.

**Fix:** `restoreDroppedLigatures` (`src/lib/agents/rosetta/glyph-repair.ts`) runs in the PDF
reader after glyph repair, on both readings of each page (`pdf-document-text.ts`).

- It restores a broken spelling of one of 30 fee words (`DROPPED_LIGATURE_WORDS`). A spelling
  is one or more of the word's ffi, ffl, ff, fi, fl, ft, ti or tt dropped, or left as a space.
- The document must show at least 2 different broken words (`MIN_DROPPED_LIGATURE_WORDS`).
- A spelling is skipped when it is under five letters, leaves a single letter beside a gap, is
  ambiguous, or has a part that is itself a known word.
- A space or ordinary punctuation must stand on each side, so "social" and "Overdra*" are never
  touched.

`GLYPH_REPAIR_DUE_PATTERN` now also matches these spellings, so the glyph lane reads the 10
matching completed texts once (current copies only, as before). `same-text-copy.ts` keeps the
glyph-only `UNMAPPED_GLYPH_PATTERN`. The change stays at `GLYPH_REPAIR_VERSION` v1. None of the 4
texts it changes carries U+FFFD or a Unicode ligature, so none was due or settled at v1. A bump
would only re-read the settled glyph texts, and the repair leaves HTML and plain text alone.

The changed text reaches live fees only when the lane re-reads a text, Knox re-extracts it and
Darwin re-checks the fees. This PR changes no fee row.

**Guard:** `src/lib/agents/rosetta/glyph-repair.test.ts` ("restoreDroppedLigatures").
