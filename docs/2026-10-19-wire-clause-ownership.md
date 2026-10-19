# Own wire direction prices — #2021

The existing fragment reader assigned the words after Family Savings' incoming price to the next slash price. It emitted an incoming $20 and missed the actual incoming $10. New Heights' paired Wire Out/Wire In row similarly lost the $5 incoming price.

The new reader accepts a complete physical wire-labelled row with two to four dollar prices separated by slashes. Every price must have its own explicit incoming or outgoing clause. The clauses use only literal direction, geography and transaction-unit wording. No amount is computed, rescaled or taken from another row. New admission and refusal authority covers domestic directions only.

The free producer, shared source checker and Hamilton rules recheck use this same bounded witness. A contradictory ordinary domestic direction price or repeated conflicting pair disables the new authority. An age or account heading that introduces the priced section also prevents new standard-tier authority until an explicit general schedule heading resets it. Incomplete rows, ranges, percentages, zero prices, conditional clauses and conflicting directions stay with their existing paths.

The actual own clause is retained as customer-readable conditions on new deterministic candidates. Existing stored rows are not rewritten by this change. The accepted paid-row fixture calls no provider: the normal shared writer and Darwin/Hamilton checks accept the true incoming $10 and refuse publication of a borrowed incoming $20. The same explicit own-direction refusal also runs before the paid source-line fallback; #2286 records its independently reproduced old-red admission bypass.

The short Wire In/Out aliases participate in conflicting-price checks as well as paired-row admission (#2284). Under business/commercial headings, new pair authority is declined. The unchanged legacy path can still misread a section and publish an unknown-audience row; baseline/new pure probes and an actual PostgreSQL stage preserve that separate finding in #2285 under #1059. This repair makes no claim that legacy audience classification is complete.

## Exact evidence and impact

- Family source document 35927 / text 34016, normalized text SHA256 `98c8db38fc19d1865db9a704d41e50750d321b7b5c53d6fa1cee481ac6f8836d`. Fresh official HTML at 15:39:24 UTC was byte-identical to the stored source, SHA256 `9223e7d801a21d337a890201a41e1089e6c0b131c9dc3837cd3c3b5c7736aac1`.
- New Heights source document 38048 / text 36167, normalized text SHA256 `edc22739f2809c08f7a23ebbf1d0356695e101663a09d1ee0a1bb9d940860eff`. A fresh official GET at 16:19:33 UTC had different HTML bytes; the actual current Rosetta DOM still carries the same literal $15 outgoing/$5 incoming row.
- Corrected read-only authority: 2,716 own source documents and 6,407 current live/raw identities across all four actual wire category keys. Every exported text hash was verified. The initial domestic-only export is historical investigation, not the final denominator.
- Three documents match the complete physical-row parser. One is international-only and gains no new authority. Candidate changes are limited to the Family and New Heights domestic rows.
- Of five live rows in those documents, only Family published 81504 changes its source verdict: incoming $20 now fails `amount_not_the_fee`. New Heights 123514 still passes; its witness now identifies its own outgoing clause. The other three verdicts remain unchanged. All 6,402 live rows outside matching documents retain the existing path.

Family's separate international $35 keeps its prior candidate, source verdict and actual per-institution comparison value. The explicit $45 international clause gains no admission. Its unresolved applicability is recorded in issue #2278; this change makes no new international eligibility or aggregation policy.

## Release and replay boundary

This preintegration branch retains rules 85 while monthly 86 and unit 87 are reviewed. Final Family integration reserves rules 88 and must use a same-snapshot87→88 ordinary-reread counter. Selector predicates, settled floors, general source-check version 18 and controls are unchanged.

The rules version is part of `knoxFreeSignature`, so an older already-passed document is selected again. The new own-price refusal runs before accepting a category/amount reproduction. It still needs the independent original-source failure and existing 12-hour second look. The PostgreSQL regression seeds a genuine passed attempt at the preceding signature, proves first flag and immediate retention, then ages only its local pending receipt 13 hours and confirms removal of the wrong incoming $20 alone.

No production writes, direct data patch, provider call, permission change, new source-check epoch or control activation is included. Normal institution replay and post-release validation precede any separately reviewed correction of historical rows. #2021 stays open until that output proof is complete.
