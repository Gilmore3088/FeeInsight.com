# Answer-key reference eligibility (#1862)

Human confirmation, automated document eligibility and the v3 matching algorithm are separate.
The score step checks whether a confirmed key is supported by the captured bytes (PDF/text) or
main text (HTML) of a priced consumer schedule, with a recorded official-site path and no unresolved current-schedule conflict.
It never repairs a key or changes confirmation, attribution or expected fees. James's complete
workflow remains the weekly 50 whole institutions in five packets of ten; no extra checks are added.

## Producer and durable contract

Only the real `score-answer-key` run/step produces `answer_key.eligibility` ledger events.
Dry runs and all readers make no source requests. The producer uses the pinned fee-source client,
three workers, a total 120-second deadline, eight seconds per request including body/parser,
six pages per key, eight MiB per response, one million parsed characters, 30 PDF pages and
100,000 PDF text items. Cancellation reaches the transport/parser; ignored injected promises are
raced against the deadline. PDF work uses Rosetta's existing layout reader with bounded inputs,
not a provider. These are bounded observations, not proof of exhaustive site discovery or a hard
process-isolation CPU guarantee. Missing/unreadable candidates and hit limits remain unknown.
Within the page cap, fee-schedule-like links are observed before navigation hubs (Disclosures,
Forms). Only an unvisited fee-schedule-like link makes discovery incomplete; an unvisited hub
is not evidence of a newer schedule (#2466). The receipt records how many hubs went unvisited
(`skippedHubCount`).
Oldest attempted unknowns rotate behind never-attempted keys.

Protocol 1 receipts record three independent facts (consumer/current/priced), reasons, requested
and final URLs, byte/text hashes, effective dates when present, HTTP metadata, source/text IDs
when exactly matched, bounded excerpts and the discovery graph. Consumer support requires each
mapped confirmed key line in the bound observed document, using whitespace normalization
only. A PDF or plain-text reference is byte-bound: the key's stored hash must equal the fetched
bytes. An HTML page's bytes change on every fetch, so an HTML reference is bound to its extracted
main text: the key's hash names those bytes or that main text, or every mapped confirmed key line
is in the observed main text and the page's effective date, when present, is not after the key was
confirmed; otherwise it stays unknown (#2466). Combined schedules require those
lines in their consumer section; service copy and incidental consumer words do not attest a heading.
A schedule with no consumer heading passes only with no business evidence (business URL/text/heading
or a business section label, bullets ignored) and every mapped key line present. Protocol 1 receipts
issued before 2026-10-20 ran under stricter rules that admitted no key. Legacy/closed-to-new products, future-effective key
documents and priced fees' absence cannot pass. A linked newer applicable schedule fails;
an unreadable or unclassifiable candidate cannot prove that the old key is current. An explicit
stored supersession of the exact key bytes remains contradictory authority even when the old
page is still linked; receipt reissue leaves it unknown. Duplicate/status alone is not inferred.

The exact key fingerprint includes the document and every confirmed expected-fee field, including
price/category/kind/conditions/frequency/source line/uncertainty/attribution. A separate fingerprint
covers the source/text inventory. The final `INSERT ... SELECT` compares the whole observed key,
fee and source state again in one statement, and requires the actual score step under that run.
`clock_timestamp()` records wall-clock event time even inside an already-running ledger transaction.
A state change or persistence failure produces no trusted receipt.

Readers load one shared snapshot per operation and never fetch a bank. The newest event is selected
before validation: unknown/malformed/unbound-step events are tombstones, not reasons to revive an
older pass. Missing/stale/identity-mismatched/read-failed/cap-unread references are unknown. Valid
receipts last at most 24 hours; a changed source/key invalidates them immediately on the next read.
At most 10,000 recent eligibility events are read; keys not reached stay unknown. An unidentified
malformed event conservatively suppresses trust for its window. General event retention may remove
an original learning receipt; its dependent examples then remain excluded rather than gaining
synthetic provenance. No existing database schema or retention policy is changed.

## Shared consumers and measurement boundary

The same snapshot gates score inputs, per-bank/latest score projections, scoreboard yield/accuracy,
quality-ledger email, category-model cache/training, Knox lessons/label queue/batch references,
Magellan reference-based finder demotions, feedback sync and Deming's Knox replay cases.
Batch judgments use the snapshot's exact key/fee payload and require the row's actual source-document
bytes to match the reference, including mirrors at other URLs. Same URL with missing/different
bytes cannot teach. Deming replay likewise excludes other editions of the same URL.
Original answer-key feedback and replay cases additionally require an immutable dedicated eligible
receipt under a real run/step and exact current key/fee/payload identity. An older original receipt
may remain valid through a current renewal of the same key snapshot; daily renewals do not multiply
training weight. Missing/forged origins and edited payloads are excluded. Unknown history is never
rewritten into right/wrong, nor relabelled `key_fee_removed` merely because its document is ineligible.
Only an actually removed confirmed key fee retires its replay case.

Scorer v3 matching/default is unchanged. Score rows embed protocol/cohort/frame identities in
reserved `by_stage._reference`; all stage consumers strip or validate that metadata. Zero expected
mapped fees means `no_measurement`, null metrics and visible confirmed/eligible/excluded counts.
Even an all-excluded run is stored so an earlier ungated score cannot reappear as the latest result.
Read failure is explicit unavailable state; unknown counts are not presented as known zeros.
Legacy/current-incompatible overall and breakdown metrics are suppressed; stored history remains
unchanged and explicitly labelled. Trends and change-outcome comparisons break on scorer or
reference/cohort changes. A key-price/category edit cannot count as a better pipeline.

This guard does not independently establish fee correctness, missing-fee recall or launch accuracy.
The [weekly live protocol](../../../../docs/plans/weekly-live-fee-accuracy-plan.md) remains the launch
measurement. The [stored-copy audit](ACCURACY.md) is a separate diagnostic. Broader live validation
and automation work in #2061/#1063 remains outstanding. No historical key is repaired by this change.

## Separate frozen tuning/holdout dataset

`darwin/answer-key-reference-manifest.json` inventories the immutable original gzipped fixtures,
full fixture-text hashes and compact fee hashes. The available 81 fixtures contain text IDs,
institution names and text, but no original document ID/URL/byte-hash mapping. Today's database row
at the same text ID cannot reconstruct that missing provenance. All 81 therefore remain unbound
for runtime judgments/teaching; their offline fixture and historical score records remain intact.
The frozen protocol/manifest identity is separate from current v3 eligibility. Verdict-score v2
reports no measurement, and the method scorecard labels old chunks historical/unbound instead
of treating them as current review accuracy or a promotion signal. Holdout weight is always zero;
holdout and unbound misses never enter review prompts. No fuzzy/prefix retrofit blesses a fixture.

## Evidence and verification

The three historical failure modes come from [#1862](https://github.com/Gilmore3088/FeeInsight.com/issues/1862)
and [the #629 audit](https://github.com/Gilmore3088/FeeInsight.com/issues/629#issuecomment-6246011208).
Regression fixtures reproduce business-only iTHINK, closed-to-new Texas Capital and unpriced TDECU
rates-hub cases with synthetic addresses/prices. They are not fresh live-site checks or repaired
bank keys. Positive consumer/combined/current/priced controls are required beside exclusions.

Policy, transport/parser, latest-score, cohort, frozen-manifest, learning and replay tests are injected
or use loopback-only PostgreSQL random schemas over `tests/e2e/production-schema.sql`
(the unchanged learning readiness check reads public schema metadata). Actual SQL covers final-state drift, aged enclosing
transactions, the producer-to-receipt-to-score-input path, historical cases, unknown tombstones,
origin/payload tampering, renewal, cache invalidation and replay exclusions. Passing tests protect
this process contract; they do not certify live bank data or the 99.5% launch target.
