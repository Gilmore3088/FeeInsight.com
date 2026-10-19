# An exclusive audience on the fee's own price clause (#2342)

**Guard:** `own-price-audience.test.ts`, `locked-raw-source.db.test.ts` and `verification-audience.db.test.ts` cover exact clause ownership, factual locks, ordinary boundaries and real caller settlement.

Oakwood's repaired source prints Check Images at $10 per statement for consumers only.
Raw943014 retained that clause in conditions but left audience unknown. Darwin then called
verified198096/published155214 `both` from unrelated mixed-schedule context. The price,
charging basis and public condition were retained; this finding is the stored audience.

The existing committed repaired-source fixture is the complete normalized source, SHA256
`dc6eb4136b9e193c6b9c250ba56e74499b1b8d29f3276658e6bdd81af9241ccc`, derived from official
PDF17019, physical page2, SHA256
`e8160b6a4c57816399cfe99fe441fb227dac9e0895c56423286feae80daa0bf3`.

## Pure interface checkpoint

`ownPriceAudience(text, exactFeeName, requestedDollarAmount)` returns three distinct states:
no exclusive evidence, a qualified consumer/business audience, or ambiguous ownership.
It reads one exact physical name and price row, or the label's immediate price continuation.
Only a complete exclusive clause and neutral charging-basis wording give positive authority.
Neighboring names/prices, extra cells, unsupported clauses and repeated requested-price
owners cannot choose an audience. The function supplies applicability metadata only;
existing source-price/category checks still decide whether this is a valid fee.

`darwinAudience(..., { ownPriceClause: true })` is a prospective opt-in. Existing calls keep
their legacy behavior. Existing name/product/exception semantics stand; a proved contradictory
own exclusive clause does not change a definite name audience to its opposite. Otherwise a
proved own clause precedes URL/title/mixed defaults, and ambiguity returns no decision instead
of taking those defaults. Existing non-unknown raw audience labels remain untouched.

This checkpoint does **not** opt any writer/caller in. The already-live v4 historical relabel
retains its exact default behavior, title-only `both` transition, epoch and cursor. The test
shows the actual legacy `both` outcome beside the opt-in consumer result. It also calls the
actual relabel decision to prove that this checkpoint does not rejudge the existing row.

## Required next boundary

Before prospective verification opts in, the common writer must derive applicability from
the current locked raw name/amount and its exact hash-bound own source. A model, stale
selected row or precomputed caller audience cannot override it. Outer peer/source checks
must use the same decision; ambiguous explicit null must not trigger later broad fallback.
Normal extraction through Darwin and publication, every verification caller, existing
history/trigger behavior and both source/raw lock orders still need actual PostgreSQL proof.

No production correction, historical metadata rewrite, relabel restart, provider call,
source/extraction epoch, numeric policy, migration or feature activation is part of this
pure checkpoint. The live155214 recovery remains a separately reviewed last step after
the process is deployed and a normal scoped recheck has completed.

## Unwired factual-source checkpoint

`withLockedSourcePrefix(tx, refs)` requires a real native transaction/savepoint. It validates
every document/institution reference, locks all documents then all current artifacts in
ascending identity order, and verifies the actual owner, status, source bytes hash and
normalized body digest. It returns the actual locked document/artifact rows, including
status, timestamps, stream metadata and pointers; this supplies facts, not date authority.
It never locks raw, verified or published rows. Publication can preserve its existing
published → verified → raw suffix instead of entering a raw-first wrapper.

`withLockedRawSource(tx, rawId)` uses the same prefix, then locks raw last. Its complete
preflight/post-lock raw snapshot must match. The actual original generated raw header's
artifact and normalized digest must equal the locked current artifact; source quotations
cannot supply a header, and private retained/historical witnesses are never consulted.
`matchOriginalRawSource` exposes that same pure original-binding grammar for a publication
suffix, without duplicating a loader or granting any admission authority.

Every newly introduced row lock is `NOWAIT`, including raw. Busy, changed and unavailable
remain distinct and roll back the helper's nested savepoint, releasing all locks it added.
No pending raw state, attempt, outcome, marker or fee tier is written. Only a bound result
keeps locks in the caller's transaction. A prefix consumer must wrap its later identity-CAS
and write in its **own** savepoint and roll that back if the suffix defers, releasing the
bound prefix as well. An autocommit/root client is rejected instead of pretending its
locks span later work.

Thirty actual disposable-PostgreSQL tests cover current facts, full pending-state equality,
owner/body/header mismatches, absent data, every busy prefix/raw position and release of
previous locks, complete raw document/name/amount/scope CAS, a changed source after pointer
discovery, retained bound locks, multi-document order, invalid/conflicting refs, consumer
rollback, native repeatable-read serialization and the Knox rawA → source-FK rawB inversion.
The free/paid generated headers are tested without invoking providers. This is a module
checkpoint: no existing verification or publication caller is wired to it yet.

Before wiring, the admitted caller identity must also be compared with the current locked
raw identity: it may have become stale even before module preflight. Precomputed caller or
model audience/text cannot override the final own-source decision. Prospective outer peer,
source and duplicate checks must use that same exact audience. Existing known raw labels
and historical relabel behavior remain unchanged. Each consumer's busy/unavailable fallback
requires review; this module does not impose a new global source-binding requirement on
ordinary nonapplicable fees or turn unavailable proof into an ordinary no-qualifier result.

## Factual current-raw refinement and prospective caller matrix

`withLockedCurrentRawSource` uses the same loader and full raw CAS as the strict wrapper,
without treating an old missing raw digest as missing current source facts. An available
current document/artifact stays locked through raw CAS and later work even when the own
qualifier is absent. The strict wrapper adds `matchOriginalRawSource` over those same facts.
Three additional real PostgreSQL controls (33 total) prove the no-header ordinary boundary,
a no-qualifier source replaced by Consumer Only before prefix acquisition, and a real
source UPDATE blocked until the negative-cue consumer's transaction ends.

The prospective integration follows this matrix. Busy/changed is a transient deferral,
never an ordinary judgement, attempt, feedback or pending-state mutation. All consumer
work is enclosed by its own savepoint so a deferred suffix releases the prefix as well.

| Current factual source / own clause | Prospective disposition |
| --- | --- |
| Available, no own exclusive clause | Hold factual prefix and raw CAS; preserve the existing legacy audience calculation. An original raw hash is not newly required. |
| Available, qualified or ambiguous own clause, raw audience unknown | Require the exact original artifact/hash. Qualified evidence precedes broader defaults; ambiguity is explicit null, never undefined/recomputed. |
| Available own clause but original binding unavailable/mismatched | Defer; do not convert unavailable authority to a broad both/title result. |
| Current raw already has a definite audience | Preserve the existing raw-label contract and trigger behavior. No historical rewrite. |
| Genuinely unavailable source, no current own-clause cue | Preserve the documented ordinary legacy boundary. This is not proof that the document contains no qualifier or a claim of full coverage. |
| Unavailable facts with a current own-clause cue | Defer; caller/model text or a retained witness cannot supply authority. |
| Direct caller with own-clause evidence but no matching completed admission context | Defer to the normal verification path; new audience metadata is not verification authority. |

Normal verification, normal/paid held release and conditional-zero resolution must derive
one prospective decision before their source/peer/duplicate checks, then compare the same
admitted identity and audience at the common writer after fresh current-raw/source locks.
Caller name, amount/kind/rate identity and every supplied category-relevant field must match
current raw. Optional absent fields in minimal ordinary callers are loaded from the database.
The selected legacy evidence projection is `extraction_note ?? conditions`; the complete raw
snapshot remains separate. Derived effective audience is never compared as if it were the
original raw label. Existing historical v4 relabel calls remain unopted and unchanged.


## Prospective caller checkpoint

The completed admission carries a private brand, exact current raw/source identities, explicit
nullable audience, final checked category, the existing release-derived frequency when used,
and `sourceContext: Readonly<LockedCurrentRawSourceResult>`. Other guards consume those held
facts directly; the identity string and caller source text are hints, not another source loader.
The final writer independently re-prepares actual facts, compares the admitted raw/effective
identity, and refuses own-clause direct calls without completed admission. Minimal ordinary
callers still load absent optional raw metadata from the database.

Every ordinary settlement is enclosed by its consumer's native row savepoint: normal Darwin
checks, free held sorting, paid review after its existing response, recorded passes, zero
resolution and direct release. Uncertainty precedes negative, duplicate and feedback outcomes
as well as inserts. Paid transport failures keep their existing usage/retry contract; no source
lock is held across a provider request. Explicit dry runs and switched-off release previews
retain the existing legacy calculation, so this patch does not claim preview/live parity.
Parent receipts distinguish selected/settled/deferred inputs and retain bounded ID/reason
samples without source bodies or exception stacks.

Twenty-six actual disposable-PostgreSQL caller tests cover the complete official Oakwood text
through Knox → Darwin → Hamilton, migration47's actual audience trigger, explicit ambiguous
null, known raw business labels, minimal/direct calls, original/derived release frequency,
ordinary unavailable inputs, zero resolution, all held/review negative paths, stale admissions,
real busy opposing connections, and unchanged existing verified/raw history. The paid negative
path uses an accepted local response transport fixture, with zero provider requests/spend.
The existing shared factual-source suite remains33 cases. The released trigger47 body is
installed transactionally inside caller fixtures because the base CI schema otherwise contains
its older migration40 body; rollback restores fixture DDL. No new production DDL is proposed.

No extraction/reader/verification/source-check/relabel version, manifest epoch or selector
changes. Already-recorded decisions are not reopened, and no existing public row is rewritten.
The source/lock/CAS availability boundary remains explicit; the dated offline projection is
conditional policy evidence, not a historical error census or proof of live admission.

## Final main composition and regression contract

The CI database inventory includes both factual-source and prospective caller suites,
alongside every existing suite and the dedicated public applicability suite. Native files
remain serialized because existing suites install transactional test DDL. The existing
monthly, cap-eligibility and symbolic-price races still observe a real blocking dependency
when Darwin wins first. When a held writer wins, the new nonwaiting read defers before
that transaction commits, without a judgment, attempt, feedback or pending-row change.
After commit, the identical stale callback defers on changed raw identity; a normal fresh
selection under the same stale category still reaches the existing held-eligibility refusal.
No assertion deadline or runtime guard was weakened to accommodate that lock contract.

The complete repaired-source stage fixture now supplies its actual artifact source hash
and transactionally installs the already-released audience trigger47 before testing the
consumer outcome. Rollback restores the shared fixture's prior trigger. This is local test
schema alignment, with no new migration or production table change.

A dated offline projection joins 3,794 saved monthly rows and 6,407 saved wire rows to their
exact saved sources and separates raw from catalog names, known raw labels and original
binding availability. Neither category-selected frame contains a matching own exclusive
clause, so this measured projection introduces no audience change in those dated inputs.
It is not an all-fee census or a live admission test. Current repaired Oakwood is a separate
positive control; its current text is not substituted into either historical source frame.
