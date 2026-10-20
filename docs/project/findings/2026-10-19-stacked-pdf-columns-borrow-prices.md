# Stacked PDF columns supplied another fee's price (#2219)

Oakwood Bank's physical fee schedule page 2 has two independent lists: a label is
followed by its bullet price. The current free reader instead joined nearby
baselines across the gutter. Actual Rosetta→Knox replay paired reconciliation with
15, card replacement with 30 and outgoing wire with 35/hour. The source prices are
35/hour, 15/card and 30/wire. Its fresh official PDF matches stored document 17019:
SHA256 `e8160b6a4c57816399cfe99fe441fb227dac9e0895c56423286feae80daa0bf3`.

Layout 5 recognizes repeated label/next-line bullet-price pairs in both sufficiently
wide bands. It refuses mixed label/amount table rows, monetary or waiver lines
crossing the gutter, and nested cell columns. Existing prose, dot-leader lists and
ordinary table behavior remain controls. Real Oakwood bytes pass through the real
PDF reader and Knox in the regression; testing only rearranged text would miss the
actual category/name/price mapping failure.

A global reader 4 counterfactual admitted 8,127 extra documents; a global prose
layout 5 counterfactual admitted 228. Neither selected Oakwood. The fix therefore
keeps the reader 3 and prose-layout 4 replay floors settled. A separate versioned
stored-text witness admits current completed PDF-layout artifacts with repeated
crossed and standalone bullet-price lines. It requires matching content-addressed
vault bytes, preserves current-copy/profile/access/attempt guards, reserves at most
four slots inside the existing read-step limit and makes no outside request.
Unconfigured vaults and failed or mismatched bytes preserve the earlier artifact
and settle as explicit review exclusions in a check-only attempt strategy, without
changing the ordinary reader's retry memory. Successful checks include unchanged
geometry and never mean that every fee was corrected or published.

The exact owner query on 2026-10-19 at 14:20:26 UTC admitted 9 documents:
14753, 16979, 17019, 19635, 22588, 22641, 22705, 23746, 24319. The earlier 11-document
exploratory superset also included a non-vault source and a legacy text with no
PDF-layout reader. All 11 fresh official downloads match their stored source hashes.
Only Oakwood changes between the current reader and layout 5. Comparing production
stored artifacts with layout 5 under current Knox changes Oakwood and Peak: Peak's
unrelated ATM 25 candidate becomes held; the other 9 candidate/held outputs match.
Bayes and daily health count the complete owner selection; state readiness uses
the same query with LIMIT1/EXISTS. No source, extraction, verification, publication
or paid-reader replay floor is raised.

Release depends on safe downstream handling of the newly exposed annual reserve
charge (#2240) and neighboring check-image prices (#2241). A max-before-item-price source form also
needs protection (#2246): Oakwood's correct 35 overdraft fee must not fail the source check
because the same bullet first states its 140 maximum. These are separate Knox and
shared-source-check dependencies, not evidence that layout conversion alone fixes
the public catalog. Actual same-document sequential replay preserves previously
verified/published wrong rows; source-grounded historical cleanup remains a separate
reviewed step after the process repair. Original extraction-witness retention is
tracked by #2220. No claim of immediate public cleanup accompanies this change.

**Guard:** `src/lib/agents/rosetta/pdf-layout.test.ts` covers real Oakwood PDF→Knox
mapping, ordinary tables, existing real prose/dot-leader PDFs, mixed pages and
monetary/no-dollar waiver crossings. `pdf-stacked-repair.db.test.ts` runs the actual
owner selection, state readiness, Bayes and health against isolated PostgreSQL;
it covers once-per-source settlement, invalid/vault/current-copy exclusions,
the four-per-step cap, failure/hash preservation and no network fallback. It is
included in the existing CI E2E job.
