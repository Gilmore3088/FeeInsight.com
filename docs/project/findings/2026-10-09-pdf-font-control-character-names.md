# A PDF font wrote its spaces as U+0003, and they reached live fee names

**Found:** 2026-10-09, during the UAT hand check of retidy v11 (PR 888). Fee 60531 was live as "Copy\u0003of\u0003Check".

A few fee schedules use a PDF font with shifted glyph codes. In that font, U+0003 is the space,
U+0013-U+001C are the digits 0-9, and the letters are shifted too ("HDFK SUHVHQWPHQW" is "each
presentment"). The text extract kept those codes. On Oct 9, 14 live names at 5 institutions held
control characters.

**Fix (retidy v12):** U+0003 becomes a space, and a combining low line between letters becomes a
hyphen. The other retidy rules then run on the spaced name. That fixes 11 of the 14 names.

A name with any other control character is left alone, because decoding its digits would mean
guessing a figure from the font. Three such names stay as they are: 19932, 21141 and 96207.
Those three, and 41496's shifted letters, need a re-read of the source document with a working
font map.

**Follow-up (retidy v13):** the font writes every glyph 29 code points low, so the map can be read
back. It is trusted for a document only when at least two of the document's shifted words decode
to words that the same page also prints in clear. Meridia (doc 6826) passes: "EDODQFH" decodes to
"balance" and "&KHFN" to "Check". So 96207 becomes "Minimum Balance (under $1000)", and 41496
becomes its own cell, "Legal Process". All of Meridia's live amounts are printed in clear and
match the page.

**Known wrong, left live (Oct 9):** LFCU (doc 13444) and Georgia's Own (doc 12676) have no
shifted words, so their maps cannot be proven.
- 19932 is wrong under any map. Its $30 belongs to the next line, "Stop Payment Order - Check,
  ACH (per item)". Its own price is font-coded, and decodes to $25.
- 21141's $5 and category are right, but its name glues two lines together.

A new takedown check for them was not added, because the permission check refused wiring it into
publish. A Knox re-read would see the same codes, because Knox has no font decode. If Hamilton's
rules re-check does not bring them down, the takedown goes to James as a question.

**Ligatures (retidy v13):** another PDF font family extracts its ligatures as single letters:
"ti" as U+019F ("Outgoing Wire – DomesƟc"), "ft" as U+014C ("DraŌ"), "tt" as U+01A9 and "tf" as
U+019E. Eight live names carried them on Oct 9, at institutions 175, 8481 and 8535. v13 reads each
letter back as its pair, in the name and in the fee's document, so the renamed fee still traces.
Renaming 87572 to "Outgoing International Wire Fee" shows that it is filed as a domestic wire.

**Lesson:** text extraction should flag control characters in the text it extracts. A clean-looking
amount column can sit next to names in a broken font.
