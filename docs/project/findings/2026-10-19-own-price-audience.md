# An exclusive audience on the fee's own price clause (#2342)

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
