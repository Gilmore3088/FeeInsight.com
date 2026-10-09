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

**Lesson:** text extraction should flag control characters in the text it extracts. A clean-looking
amount column can sit next to names in a broken font.
