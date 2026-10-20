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
same score a directly read rate gets. Test: `knox/held-rate-confidence.db.test.ts` (fails on
the old code with 0.5).

**Not fixed by this change.** The 1,037 rows already promoted keep 0.5 until a typed step
re-scores them. Up to 1,028 of them are at institutions that already have live fees, and 2
institutions would newly reach the 3-category floor; Hamilton's other rules still decide each
row. That re-score changes live data and waits for James's yes.

**Lesson (Knox).** When Knox promotes a held line, it re-scores the line as if it had read it
directly; a placeholder written for the held queue never travels with the fee.
