# 2026-10-19: A learned takedown needs the same fee and original judged text

**Problem (#2186).** Knox's learned-hold key was institution + aggressively simplified name +
price rounded to two decimals. It omitted category, product, audience, frequency, conditions,
variant and basis. Its live-twin anti-join likewise used name/amount only. Extract and re-read
could apply an unrelated confirmation to a new row, add `knox_review:taken_down` and remove its
Darwin eligibility. Another product's live fee could suppress the intended lesson instead.
The confirmation did not identify the normalized text the checker originally judged.

**Initial evidence.** At unchanged `aa680f2d95927467e1f797df02e5cfd8f0f02a87`, a controlled actual
function probe failed two cross-product/unknown-owner isolation assertions and passed two controls.
The actual old-loader SQL fixture failed three assertions with two independent identity defects:
a foreign-product live sibling hid a lesson, and same-price category/product lessons collapsed.
The third assertion repeats the product-collapse defect: its CTAS table retains numeric(12,2),
so inputs 1.651/1.654 had already become 1.65/1.65 before loading. It is not independent evidence
of sub-cent loss in stored SQL. Two controls passed. The original failed fixture/log are retained.
These fixtures are not production counts, real Alpha-product provenance or supported future-witness
positives. The old pure key's `toFixed(2)` and the new pure `exactAmount` controls establish exact-key
semantics separately; no production sub-cent amount or stored precision repair is claimed.

**Process fix.** The limit guard captures its bounded full selected publication/verification/raw
state and the raw observation's exact Rosetta artifact/hash before `limitGuardVerdict`. Its
existing second-look confirmation carries that optional typed witness. A latest-text join after
judgement cannot manufacture it. Only this producer is supported initially; source-check,
business-schedule and legacy missing-witness confirmations are unknown for new learned holds.
Their takedown policies, kinds/weights and old raw holds do not change.

Prospective identity uses the same grounded ownership/applicability/conditions facts as the raw
writer. Full supported flat identity and exact decimal keys preserve meaningful digits, product,
audience, frequency, treatment, conditions, variant and represented rate distinctions. SQL
live-twin identity shares the supported whitespace/ASCII rules; unknown product is not a wildcard.
The incoming artifact must have the same institution and verified normalized-text SHA256. A
different document/artifact with identical normalized text is supported; PDF bytes need not be
identical. The original witness remains bound to its own document/artifact/state.

**Final write.** The shared extract/re-read gate locks selected publication→verification→raw→
feedback NOWAIT, then original/incoming text IDs in stable order. It rechecks the full original
states, confirmation/closure, exact lineage, hashes/content and live twin before insertion in
the same transaction/savepoint. Unknown, drift or contention produces an ordinary new Darwin
candidate and explicit reason counts. Positive holds apply only to actual INSERT RETURNING
rows with the required flags; a raw conflict is byte-preserving `existing_raw_kept`, without
monthly enrichment, a second hold count or old-hold release. A writer failure rolls back and
propagates, rather than retrying as ordinary success. This protects selected state under Read
Committed; no broad serializable phantom or standalone autocommit claim is made.

**Acceptance.** Actual production-schema tests exercise limit-guard first look→aged second look→
confirmation witness→same-text new-document hold; both actual extract/current-copy and re-read
receipts; foreign/unknown products, category, audience, frequency, conditions, variant/rate/bounds
and name/value controls; changed/missing/ambiguous provenance; current state drift; conservative
true-twin blocking; existing held/raw conflicts; real separate-session NOWAIT boundaries and
insert-conflict waits; failure after a successful INSERT, savepoint rollback and stable retry.
No source/provider call is permitted by the fixture. Committed two-session cohorts are removed
in finally on an owned loopback database; other fixtures roll back.

**Boundary.** `TAKEDOWN_LESSONS_VERSION` v2 changes prospective eligibility only. Bayes records
the no-replay exception. Extract83/stale78/verify3/batch-key4/publish3/refresh2/current-copy2/
newer-copy1 stay settled. No migration, production mutation, live source/provider call, old hold
release, broad replay, switch or historical repair is included. #1911 represented-context/numeric
policy/recovery and the broader learning parents remain separate open work. No current fee count
or scorecard improvement is claimed from controlled fixtures.

**Guard:** `src/lib/agents/knox/takedown-lessons.test.ts`,
`src/lib/agents/knox/takedown-lessons.db.test.ts`,
`src/lib/agents/hamilton/limit-guard.test.ts`, `src/lib/agents/hamilton/second-look.test.ts` and
`src/lib/agents/knox/reread-feedback.test.ts` protect key/provenance/producer/actual SQL/receipt
boundaries. The database suite is included explicitly in CI `E2E_TESTS`.
