# 2026-10-25: Hamilton's filing and filed-peer figures had no fact IDs

**Lesson:** Give a figure a fact ID only from a server-observed read, through the validator that
already reads it, and put its period basis in the ID. A natural key without the basis gives an
NCUA year-to-date row and the same quarter's standalone figure one ID with two values.

**What happened (#1077, claim contract step 1):** a written answer's financial and peer figures
(a credit union's filed fee income, a bank's filed peers and their median) were checked only as
numbers somewhere in the DATA (`figure-check.ts`). Only fee rows were ever built into a
`HamiltonEvidenceFact` (`writtenAnswerFeeEvidence` in `written-answer-binding.ts`), so no
sentence-level rule (wrong institution, wrong period, median as the subject's own figure) could
reach a filing figure. Two functions were also both named `writtenAnswerEvidence`, one building the
figure check's DATA and one the fee bundle, so the two checks read their evidence separately.

**Cause:** filing rows have no numeric id in the tool output (`getFinancialsByInstitution`
selects none), and the evidence contract had no place for a metric, a period basis or a peer group.

**Fix:** optional `metric`, `periodBasis` and `cohortKey` on `HamiltonFactScope` and
`HamiltonClaimBinding`, `recordKey` and `evidenceClass` on `HamiltonFactSource`, and the derivation
kinds `ytd_to_quarter` and `ratio`. `src/lib/hamilton/claim-evidence.ts` builds facts from three
reads, each through its existing validator: `getInstitution` financial rows (as
`profileQuarterCalculations` checks them) plus the profile's NCUA quarter as a `ytd_to_quarter`
derivation; `queryData` institution reads of the NCUA call lines (`ncuaFilingInputs`, exported
from `answer-derivations.ts`); and `queryFeeRevenueCorrelation` peers (`filedPeerIncomeReadings`,
the same checks as `filedPeerIncomeEvidenceResult`, keeping the peer rows). IDs are
`filing:<source>:<institution>:<report date>:<metric>:<period basis>` and
`stat:filed_peers:<source>:<report date>:<group hash>:median`. An ID two reads disagree on gives
no fact and drops what was derived from it. A shortened peer list gives a median with no inputs
and a limitation. `writtenAnswerEvidenceBuild` returns the DATA, the fee bundle and these facts;
the fee builder is renamed `writtenAnswerFeeEvidence`. Nothing reads the new facts yet, and the
DATA is byte-identical: replaying all 401 `writtenAnswerEvidence` calls the existing Hamilton,
research and route tests make gave the same JSON before and after.

**Where the design (`claim-contract-design-2026-10-25.md`) was wrong:**
- It gives the profile row and the peer view's subject row one ID so they reconcile. For NCUA the
  profile row is year to date and the peer view's is the standalone quarter, so the ID names the basis.
- It takes every profile field's basis from `definition.period_basis`. Total assets and deposits
  are quarter-end balances, so they are `point_in_time`.
- It orders the `queryData` key as institution, measure, date, and the profile key as
  institution, date, field. One order is used for both.
- It puts `evidenceClass` on the median, but a `HamiltonDerivedFact` has no source; the median
  is marked by its `cohortKey`. The group hash includes the subject, since the subject is left out
  of its own peers.

**Left for step 2:** NCUA ledger derivations as derived facts (a percent change has up to four
inputs, which `derivationHolds` cannot recompute yet), call-peer statistics, index statistics
with IDs, and `claimBindingMatches` on the new fields. `derivationHolds` passes any kind it does
not know, so it must learn `ytd_to_quarter` and `ratio` before these facts reach `bindNarrative`.

**Guard:** `src/lib/hamilton/claim-evidence.test.ts` (same reads, same IDs; Bank B's row never
gets Bank A's ID; a conflicting filing gives no fact; a shortened peer list's median has no inputs
and a limitation; DATA digests pinned from `origin/main`).
