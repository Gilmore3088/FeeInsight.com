# 2026-10-25: Hamilton's sentence binding never reached a filing figure

**Lesson:** A filing figure is supported only by a fact of the institution, metric, quarter and
period basis the sentence states. When the sentence's owner ("your" with no account known, or no
subject at all) or its metric is unknown, bind nothing rather than the first fact with the same
number, and let any derivation kind the checker does not know fail.

**What happened (#1077, claim contract step 2):** step 1 gave filing and filed-peer figures fact
IDs, but the written answer's sentence binding (`writtenAnswerBinding`) still read fee records only
and returned no binding at all when the reads held none. A financial answer stating Bank B's filed
service charge income as Bank A's, a Q1 quarter as Q2, or a year-to-date total as a quarter was
shown with no binding. `derivationHolds` also passed any derivation kind it did not know, so a
`ytd_to_quarter` or `ratio` fact would have held without being recomputed.

**Fix:**
- `narrative-bound.ts`: validity by evidence class (a filing needs its institution, a quarter-end
  date, metric, period basis, table and natural key; an NCUA call line also an ncua.gov URL; no
  other non-fee class is a record). A filing figure binds only where the sentence names its metric
  (broad fee income never stands for overdraft revenue), to its institution (`wrong_institution`),
  quarter (`wrong_period`; "Q2 2026", "second quarter", "June 30, 2026") and basis (new
  `wrong_basis`; a first quarter's year-to-date total is that quarter). "Your" with no institution
  named is the reader's own institution, and another's figure stated as it is the new
  `account_as_subject`; a sentence naming nobody is the research subject's. `derivationHolds`
  recomputes `ytd_to_quarter` (this quarter's YTD less the prior quarter's, same institution and
  metric) and `ratio`, checks a filed peer median's peers share its metric, quarter and basis, and
  fails any other unknown kind. Fee-record behaviour is unchanged: every existing binding test passes.
- `evidence-contract.ts`: `claimBindingMatches` checks `metric`, `periodBasis` and `cohortKey` when
  the claim states them.
- `written-answer-binding.ts` / `answer-save.ts` / the route: the binding takes the claim facts built
  from the same server-observed reads, the research subject and the account institution; it returns
  a binding when the reads hold a fee record or a claim fact. Both new reasons are in `OMIT_REASONS`.
  Peer names now come from rows that carry `institution_id` and `name`.
- `claim-evidence.ts` (step 1 review): profile rows are read exactly as `profileQuarterCalculations`
  reads them (definition unit, publisher and period basis must be the source's own; an explicit
  `unit: null` never falls through to the response's units; an unreadable row makes its whole date
  conflicting). One conflicting peer fact drops the whole filed peer median derivation (fails closed).

**Golden set (`claim-golden-set.ts`, version 2026-10-25.2):** wrong today 10 of 25 before, 7 after.
`sb-financial` (wrong_institution), `sb-account-as-research` (account_as_subject) and
`sb-median-as-subject` now hold. `pd-quarter` and `pd-ytd-as-quarter` keep their gate hold and now
also omit `wrong_period` and `wrong_basis`. `sb-median-as-subject` holds as `wrong_institution`, not
the target's `median_as_fee`: a synthetic peer's own quarter equals the median and is checked first.

**Where the design was wrong or is left open:** the design puts "your" resolution in the gate
(step 4); the binding needs it now or "your" binds to any bank's figure. NCUA ledger derivations
(four-input percent changes), call-peer statistics and index-statistic IDs are still not facts.
A sentence with no figure stays supported with no fact, so `wp-direction` style answers gain a
binding but no check (step 3).

**Guard:** `src/lib/hamilton/claim-sentence-binding.test.ts` (swapped bank, wrong quarter, wrong
basis, unnamed metric, "your", keyless filings, `ytd_to_quarter`/`ratio`/unknown kinds, saved
binding reads back) and `src/lib/hamilton/claim-golden-set.test.ts` (recorded outcomes).
