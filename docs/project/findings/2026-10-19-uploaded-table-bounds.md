# Uploaded financial tables could expand before a resource check

Issue: [#2128](https://github.com/Gilmore3088/FeeInsight.com/issues/2128), audit F13. Scope is Hamilton's private CSV/XLSX upload flow, originally shipped in merged PR #247. No overlapping open parser implementation was found. The broader private-data feature #1089 does not cover this defect.

## Cause and resulting behavior

The 2 MB compressed-file check did not constrain sparse worksheet coordinates. The synthetic 206-byte workbook with one `ZZZZ1` cell caused the old parser to pad a row to 475,254 elements. Directory offsets were read without complete range validation; each selected XML part could inflate to 50 MB; shared strings had no separate budget. Both formats stopped at the row cap and could return a financial preview without explaining that later rows were omitted.

The parser now validates the complete ZIP directory, local headers, compressed ranges and overlaps before expanding any selected part. It accepts stored/deflated entries and normal streaming data descriptors, checks actual expanded length and CRC for selected parts, and decodes UTF-8 strictly. The declared size bounds every inflation call through Node's `maxOutputLength`; declared aggregate sizes include unused parts. Sparse coordinates, cell slots and text are checked before padding, appending or retaining them. XML is consumed with the existing `htmlparser2` runtime, after bounded structural validation because that parser otherwise accepts missing/mismatched closing tags.

Any exceeded limit rejects the whole upload. No prefix of a financial table becomes a preview. `receiveUpload` parses and maps before `createUpload` or its run-ledger write; a parsing rejection returns 400 and performs neither write. It never invokes the separate fee-memory application step. The route retains premium authorization before multipart parsing and its existing file-size check before `arrayBuffer`, with an actionable 413 message. This change does not add a streaming limit to the multipart request parser itself.

## Accepted task limits

These are independent limits: a table must satisfy all of them. MB below means 1,048,576 bytes, matching the existing 2 MB upload check. Character counts use JavaScript UTF-16 code units.

| Resource | Accepted limit |
| --- | --- |
| Uploaded bytes, including direct parser callers | 2 MB |
| CSV physical records / XLSX row coordinates and physical records | 5,000, including the header and blank records; quoted newlines remain inside one CSV record |
| Columns in a row | 128 |
| Total table cell slots | 100,000, including empty slots before a sparse XLSX cell |
| Text in one cell or shared string | 16,384 characters before trimming |
| Table text, counting every use of a shared string | 2,000,000 characters before trimming |
| ZIP directory entries | 128 |
| Expanded bytes per ZIP part / all declared parts | 8 MB / 16 MB |
| Shared-string values, including empty or unused values | 20,000 |
| Total shared-string text | 1,000,000 characters |
| XML nesting / attributes per element | 64 / 64 |

The 2 MB and 5,000-row limits are retained, with rejection replacing truncation. The mapper recognizes six column roles; 128 columns leaves room for ancillary bank fields while bounding sparse padding. The 100,000-slot budget permits a 5,000-row table with 20 columns, or a wider shorter table. The text and ZIP budgets allow substantially more decoded content than the compressed input without accepting arbitrary expansion. These are conservative import limits, not claims about the size of observed customer files. No customer files or production data were read to choose them.

Ordinary sparse cells, quoted/multiline CSV, BOM/CRLF, shared/inline rich text, Unicode entities, numeric zero, and cached formula values remain supported. Formulas are never executed; the first worksheet selection is unchanged. Blank records and cells count even if their text is later filtered from the table. A styled/blank worksheet row beyond 5,000 is rejected; the remedy is to export the actual data range. ZIP64, split/encrypted archives, unsupported compression, Unicode path-override records, DTD/custom entities, invalid UTF-8, conflicting cell references and malformed XML/CSV are rejected with a fresh-export remedy. Larger or unusually complex workbooks can be exported as a smaller CSV data range. The separate regulator/public-dataset XLSX loader is unchanged.

## Validation and copy review

Synthetic regression fixtures cover the 206-byte sparse-reference case; declared per-part, aggregate and entry-count limits with **zero decompression calls**; bounded decompression when a declared size lies; directory/local offsets and lengths; duplicate/overlapping entries; CRC/length failures; streaming descriptors; shared-string count/text; repeated shared references; XML structure/nesting/attributes; and CSV/XLSX limits that previously returned partial data. Service tests assert no preview, run ledger, memory-fact or upload-status writes on rejection. Route tests assert authorization before multipart parsing and the byte check before file copying.

Copy review follows the repository copywriting/copy-editing guidance: failure text identifies the enforced limit where available and gives one concrete next step (export a smaller range, or export CSV/save a fresh unencrypted XLSX). The no-rows-saved statement is backed by the tested parse-before-write ordering. Numbers in the messages come from the enforced policy above. No success or accuracy claim is inferred from resource-limit tests.

Protocol references: [PKWARE ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) for directory/local records, flags, CRC and descriptors; [Node zlib documentation](https://nodejs.org/api/zlib.html) for bounded synchronous output. Runtime packages, schema, providers, authentication, password formats, URL fetching and production data are unchanged.

**Guard:** `src/lib/hamilton/uploads/parse-bounds.test.ts:88` (a sparse column such as `ZZZZ1` is refused before padding; the cases after it cover the cell, text, shared-string, XML and ZIP budgets)
