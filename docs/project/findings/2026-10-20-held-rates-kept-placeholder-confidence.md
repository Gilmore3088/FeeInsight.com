# Held rates kept Knox's 0.5 placeholder confidence after promotion (#1055)

**What happened.** 1,037 verified rate fees (card foreign transaction 390, coin counting 249,
check cashing 204, late payment 133, cash advance 61) at 656 institutions sat at extraction
confidence 0.5, below Hamilton's 0.8 publish floor, so none could publish. Two institutions
(2706, 4486) never published at all because their third category was one of these rates.
Counted read-only on prod, 2026-10-20.

**Cause.** Knox writes a held line at a placeholder confidence of 0.5 (`knox/extract.ts`,
held insert). Every other held-line promotion in `knox/held-recheck.ts` sets
`extraction_confidence` from the line it read; the held-rate promotion (`recheckHeldRates`)
changed the row into a percent fee for Darwin but left the 0.5. Darwin copies the raw
confidence, so the verified row inherited it. A rate Knox reads directly scores 0.82 to 0.94
with `confidenceFor`, and 950 such rates are live.

**Fix.** The held-rate promotion sets `extraction_confidence = confidenceFor(excerpt)`, the
same score a directly read rate gets. The rows already promoted are re-scored by
`rescorePromotedRates` in Knox's extract step (raw row and verified copy, 500 a step; James
approved it on Oct 20). Hamilton had refused 1,017 of them at publish rules v3 as "Below publish
confidence threshold", which counts as decided, so a row refused only for confidence is now
decided once more when its confidence clears the floor. Up to 1,028 are at institutions that
already have live fees; Hamilton's other rules still decide each one.

**Guard:** `src/lib/agents/knox/held-rate-confidence.db.test.ts`: a promoted rate scores its
line (fails on the old code with 0.5), and a re-scored rate refused for confidence is decided
again by Hamilton (fails without the re-selection).

**Lesson (Knox).** When Knox promotes a held line, it re-scores the line as if it had read it
directly; a placeholder written for the held queue never travels with the fee.
