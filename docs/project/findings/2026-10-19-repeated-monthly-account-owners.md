# Repeated monthly prices lost their account owners

Issue: [#2259](https://github.com/Gilmore3088/FeeInsight.com/issues/2259), child of
Knox tracker #1092 and release dependency of Rosetta #2219 / draft PR #2256.
Related Darwin race: [#2277](https://github.com/Gilmore3088/FeeInsight.com/issues/2277),
child of Darwin tracker #1110, repaired in the same bounded admission change.

The stored Oakwood PDF reader combined unrelated page columns. The repaired reader
separates them, exposing identical monthly price clauses under personal and business
account headings. Candidate dedupe and generic names retained one price without a
unique owner. The actual historical fixture contains seven monthly raw rows and 27
verification/publication judgments. After replacing only the stored normalized text,
real Knox, Darwin and two complete Hamilton sweep/owner cycles published new generic
5/7 monthly rows while the old business-specific rows remained correctly held. A
same-document name difference bypassed those older identities' business holds.

## Prospective admission boundary

The new source reader indexes only bounded physical monthly price rows under explicit
standalone account headings. The candidate's own literal price and phrase must match
two distinct owners. It preserves two literal owner/price blocks as eligibility
evidence, including their balance context; it does not choose a first owner or infer
a personal customer. A blank, table-cell boundary, unsupported uppercase account
heading, next price, unfinished condition, or exceeded budget prevents crossing that
boundary. Whole-token comparisons distinguish 50 from 500. Unique owners, differing
prices or conditions, a repeated single owner, and source-grounded assigned/named
products remain eligible. A literal product name can omit only a trailing generic
Account(s) suffix when a checking/savings/money-market name remains explicit.

Free extraction and the common writer apply the same eligibility check. Accepted paid
quotes may contain their heading and balance figures: the actual physical fee clause
owns the price. Existing generic zero paid quotes still fail the existing paid source
gate; common zero-price writes are nevertheless covered. Minimal internal callers
without text load the exact artifact/document/institution/hash witness and verify its
actual SHA256; unavailable or mismatched content declines the write.

An exact raw-key conflict may take over an unverified pending row as eligibility-held.
The ordinary insert retains `ON CONFLICT DO NOTHING`. Only proven monthly ambiguity
locks the conflict's exact raw identity in an actual transaction, then uses a fresh
statement snapshot to check judgments before updating. This also handles a concurrent
ordinary insert winning an initially absent key. Darwin checks the current monthly
eligibility flag after its raw lock, including NULL or legacy unrepresented products.
It does not require a needs-verification flag for legitimate historical rejudges.
Two actual-function, two-connection PostgreSQL repros established both prior races:
an UPSERT could rewrite history after waiting for Darwin's commit, and a stale Darwin
selection could verify after a monthly hold committed. Both directions are regressions.
Every identity with any verified judgment stays byte-for-byte unchanged, including
rejected/operator-held/published history. An existing safe eligibility hold stays
unchanged too. The retained source evidence and provider flags survive common-writer
and automatic-promoter paths; no verification flag is added to an ambiguity hold.

This code phase is explicitly approved in the 2026-10-19 review as a prospective
eligibility exception to Darwin's general live-rule-join requirement, following #1911.
It makes no unsupported-price refusal or historical cleanup claim. No shared
source-price/two-look rule, provider control, paid activation or production row is
changed. Historical recovery requires its own reviewed path. Oakwood live monthly 10
and the old held business 5/7 remain unchanged. The separate legacy lineup-correct
Savings-to-Money-Market metadata defect is tracked in #2269; its savings hold continues
to keep that row unpublished through repeat sweeps.

## Evidence and replay scope

The read-only impact packet is in the W43 `pipeline-repairs-20261019` audit directory.
It freezes 10,004 current source artifacts at 4,561 institutions (164,076,221 characters)
and verifies every full normalized-text SHA256. The export uses 101 bounded verified
HTTPS GET batches; the refreshed 15:26:34 UTC manifest has zero added, removed or changed
artifacts. Actual rules85 free extraction produced 88,599 candidates, including 9,192
monthly candidates. The final helper is replayed against every cached candidate before
and after the real lineup/grounding path, rather than against whole documents alone.
This is a necessary SQL superset for two repeated own monthly fee phrases and account
headings; unsupported layouts and paid-only model outputs are not an accuracy claim.
Final helper SHA256 is `a628fa9225723dc5e5022803e8d0804d22486a22492cfd063d35d40cd1a3939d`.
It holds 13 ordinary candidates at seven institutions before lineup assignment; 12
also match after the actual grounded lineup path. The one difference is Evolve text
35619: free extraction holds before an arbitrary occurrence can acquire an owner,
whereas an explicitly assigned matching source product remains an intended writer
control. The real free path does not pass that held candidate to the ordinary writer.
Of 1,386 monthly zero-price inputs, four become eligibility-held. Together these are
17 prospective held inputs at ten institutions / 12 source artifacts. A held input is
not a certification that its old category, amount or eligibility was otherwise correct.

Existing exposure separately includes all 3,794 current monthly catalog identities and
their exact raw names/products/excerpts at 1,894 institutions. All 2,475 own source
documents are present (514 source artifacts are outside the prospective cohort).
The original extraction hash matches the current artifact for 3,612 rows; 150 differ
and 32 have no extraction hash/own excerpt. Changed/absent witnesses remain explicitly
uncertain and cannot authorize historical cleanup. Input manifests, per-batch hashes,
exact match IDs, helper hash and final counts are in `monthly-2259-final-*.json`.
Four existing identities match the bounded helper: published/raw 21534/131714,
64868/258475, 64871/258478 and 76983/308638, at three institutions. All four original
extraction hashes match their current artifacts. They are measured exposure, not
automatic takedowns; two are zero prices. The 150 changed and 32 absent original
witnesses remain uncertain even when their current text passes a helper control.

Rules86 uses the existing ordinary selector. Its stale78/lineup73/twin82 floors remain
settled. The actual same-statement due counter at 15:23:47 UTC is 12,478 at both rules85
and rules86 (+0); no other replay epoch changes. Source text may change later counts.

**Guard:** `src/lib/agents/knox/monthly-account-owners.test.ts` covers real repaired PDF
ambiguity, named/assigned/unique/tier controls, source/title boundaries, complete
bounded conditions and accepted paid quotes. `monthly-account-owners.db.test.ts` seeds
the exact historical monthly states/judgments, performs the stored-to-repaired source
transition, real extraction/verification/publication plus all normal sweep phases,
then checks repeat/conflict and automatic-promoter safety. It also exercises accepted
paid quotes, minimal-caller hash failures, common zero-price writes and pending versus
judged conflict behavior. `monthly-account-owner-concurrency.db.test.ts` proves both
lock orders with actual PostgreSQL blocking plus legacy-undefined product and normal
pending controls. CI explicitly runs both loopback PostgreSQL suites; focused
source guards and both existing answer-key gates remain required.
