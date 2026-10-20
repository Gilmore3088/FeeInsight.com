# 2026-10-19: Wrapped fee bullets lost their title or their own price

**What happened.** The read-only #1918 loss-funnel check traced two missing SchoolsFirst
disclosure fees to normalized source document 20747 / text 16671: the returned NSF and the
Standard Overdraft fee, each $22. A bounded GET of the known official
[October 2026 disclosure](https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf)
on 2026-10-19 at 08:08:35–37 UTC returned HTTP 200, 618,887 bytes and 48 pages, with SHA256
`4b8cf689fa4c3586fe08e8e4dbb1d351d7437b72375d674ee409e17227d27967`, identical to the stored PDF.
The unchanged PDF is a regression fixture. Visual inspection of physical page 4 (printed page 2)
confirmed the two separate paid/returned bullets and their shared maximum-three-per-share-per-day
footnote. This source capture establishes those printed terms at that time; it is not a live
recovery receipt or a confirmed answer key.

**Cause.** The returned bullet becomes 283 characters after ordinary prose joining, beyond the
280-character legacy segment budget. It was dropped rather than extracted. The paid bullet's
last line starts `(NSF) available balance and paid`; lowercase-only continuation did not attach
it to `Standard Overdraft`. Raw 307805 instead carried a misleading NSF name and Darwin rejected
it for `category_mismatch`. Expanding a global budget or accepting arbitrary uppercase
continuations would also cross unrelated sections, bullets and neighboring price columns.

**Fix (#2151, Knox tracker #1092).** A shared physical-row scanner recognizes an explicit bullet
and primary label, bounded lowercase/parenthetical continuation, and its own terminal dot-leader
price, before callers erase blank separators. A unit is at most six physical lines and 2,000
characters. New bullets, blanks, headings, cells, ambiguous prices and budgets stop it. Only
existing recognized primary labels leave the legacy readers; their consumed spans remain
barriers, so later specialists cannot extract a tail as another fee. Unresolved recognized units
record `wrapped_bullet_unresolved`. An exact owned source name uses only that unit; a neighboring
row at the right price cannot make an incomplete or differently priced unit pass.

The complete owned text becomes raw `conditions`, also visible through the publication catalog,
and the raw audit excerpt is no longer cut at 180 characters for these bounded units. The shared
asterisk count cap can cross only adjacent complete units carrying that same reference, within
12 physical lines. It is retained in bank conditions and `linked_conditions` audit evidence,
before the final own-row `excerpt`. Frequency settlement reads that own-row excerpt: the count
cap supplies neither a daily charging unit nor a derived $66 fee. Other extraction rows retain
their existing excerpt budget. Category, threshold, audience, source-owner and publication gates
remain in the path.

**Proof and limits.** At baseline `5c2129bb19110801f412b4c66d46d830b39c369e`, the first 11
regressions failed seven cases and passed four. They now read one faithful NSF and one Standard
Overdraft from the full actual PDF, preserve unequal prices in both orders, and reject swapped
source witnesses. Additional controls cover budgets, next bullets, blank/section/column barriers,
single-dollar balance/allowance conditions, multiple prices/rates, cap-reference barriers,
explicit audiences, nearby payroll/card labels, ACH/deposited-item/overdraft-transfer distinctions,
and Bellco's unresolved multicolumn prices. Disposable loopback PostgreSQL runs the actual
Knox raw insert, Darwin verification and Hamilton publication, proves complete conditions in the
catalog with frequency still unknown, repeat idempotence, wrong-neighbor rejection and an
operator-held row surviving a new copy. The SQL suite is in CI's `E2E_TESTS` list. No fixture
uses network or a provider; each SQL fixture rolls back.

**Version and recovery boundary.** Knox is `extract.rules` v83. The stale-read floor stays v78
and twin floor v82. Bayes's existing `knox.rules` manifest uses the runtime's ordinary due-text
query, leaving every other current copy on its prior read. Darwin source-check v2 and verify v3
stay unchanged: a read-only current-copy/latest-v3 `not_in_source` screen at 08:33 UTC found 149
rows whose texts contain the general bullet-label grammar, with a 201-row safety cap not reached.
None has a matching primary label owned by this scanner; stored-source before/after replay
changed zero decisions. The original SchoolsFirst row is a category rejection. Newly faithful
undecided candidates get the check normally, without reopening historical rejections or article
lineages. These counts describe a stored-source cohort, not new current-web validation.

Relates to #1908 and #1918; remaining work includes payroll-source contamination, Bellco
classification/multicolumn associations, Cascade paid/returned expansion, round-two cases and
authorized live recovery/verification. An unrecognized primary title can still use legacy
description classification, so this change makes no broad contamination claim. SchoolFirst's
two fees are outside the confirmed answer key; no aggregate recall or coverage movement is
claimed from this code-only receipt.

**Overlap reconciliation.** Unrelated report-only PR #1736 was inspected at exact head
`15b0340b38ff20c7303f604d1829a8f22d3af2dc`: its source-check signature adds a sixth optional
`SourceCheckOptions.sectionHeadingCategory` argument and passes category-context permission to
`checkAgainstLines`. This fix leaves that separate option contract alone and does not adopt its
report-only category-context behavior. Existing default pipeline category rules remain required.

**Lesson.** Read a bounded logical source unit before fragment normalization, preserve its complete
conditions, and prove storage plus verification/publication. Equal prices can hide a borrowed
neighbor witness; unequal prices, reversed order and real SQL are necessary controls.

**Agent lesson:** knox/pr-2162-wrapped-bullet-unit
