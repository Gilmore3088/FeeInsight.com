# Frequent Knox bumps starved the rules re-check, and banks with a live overdraft were never re-read (Oct 9, 2026)

Knox re-reads a document only when one of its own triggers asks. For a credit union under $10B the
usual trigger is Hamilton's rules re-check: it reads the document with today's rules and, when those
rules find fees that are not live, Knox reads it again. Two things kept that from happening.

- The re-check walked each state lane in document-id order, 25 documents per run, once per Knox
  signature. Knox went from v33 to v64 in about 30 hours, and each bump restarted the walk at the
  lowest ids. A lane runs 5-7 times a day, so later documents were never reached. Doc 20570 (Peak FCU,
  WA, 100 live documents ahead of it) was last re-checked at v33 on Oct 8 06:10.
- Atlas's read-now run for one institution re-read its current page once per rules version only
  while the institution had no live overdraft fee. Space Coast CU (8109) has one, so its 09:25 v63
  run (`atlas:priority:8109:knox:63`) finished in 4 seconds without reading doc 13776, which kept
  its v33 read. The v64 sideways box-table fix (PR 892) never reached it, and SCCU stayed at 11 live fees.

Fix:
- `rules-recheck.ts`: the walk takes the documents whose last re-check, under any Knox version, is
  oldest first. Never-checked documents go first, and every document is reached however often Knox bumps.
- `knox/extract.ts`: a one-institution run reads that institution's current page once per rules
  version, whatever its overdraft fee. The same text is still never read twice by one version.
- Peak FCU (8414) joins Atlas's read-now requests. SCCU is already on the list.

The new selection takes 75 ms on prod for the WA lane (read-only EXPLAIN ANALYZE).
