# 2026-10-25: a competitor's price was bound to the subject bank's record, because the competitor was never named to the binder

**Lesson:** The binder can only tell whose figure a sentence states when every tool that gives a
figure also gives whose it is, by id. The local competitor read gave competitors by name only, so
a sentence about a competitor was read as being about the bank named before it. Now the read gives
ids and the binder learns the names. Its prices are still aggregates with no record behind them,
so they are never a supported fact. A competitor price that matches one of the subject's own
records is now left out, even when it is true of the competitor.

**What happened (Cycle A trace, defect #2, #1077):** `getLocalCompetitors`
(`src/lib/research/tool-local-competitors.ts`) returned the subject as `institution` (a name)
and each competitor as `{name, fees, several_fees}`. No institution id came with any of them, and
no record or document id came with any price. `feeFactsAndNames` in
`src/lib/hamilton/written-answer-binding.ts` learns names only from a profile, from
`{institution_name, institution_id}`, or from `{name, id, charter_type/state}`, so it never learned
the competitors' names. `bindNarrative` (`narrative-bound.ts`) carries the last named institution
on to a sentence that names none it knows. So in "Bank A charges $37 for an overdraft. Bank B
charges $35 for an overdraft." the second sentence was read as Bank A's, and its $35 was bound as
supported to Bank A's own $35 overdraft line.

**Cause:** the tool output dropped the identity it had. `getLocalMarketCompetitors`
(`src/lib/data-store/local-market.ts`) already returns each competitor's `institution_id`,
`document_url` and `document_date`, and the market's basis, counties and SOD year. The tool kept
only the names and prices. The prices are aggregates: the highest overdraft tier (`MAX(amount)`)
or the median (`PERCENTILE_CONT(0.5)`) of a competitor's catalog rows in that category.

**Fix:**
- The tool now returns the subject's `institution_id`, the market's `market_basis`,
  `county_fips` and `sod_year`, and for each competitor its `institution_id`, `document_url`,
  `document_date` and a `fee_basis` per category in `fees`: `"max"` or `"median"`, from
  `competitorAmountBasis` in `local-market.ts`, next to the query it describes. No SQL or schema
  changed.
- The binder recognises the read (a `competitors` array beside `your_fees`) and learns the
  subject's and each competitor's name by id. A sentence that names a competitor now has that
  competitor as its subject. The existing rule then applies: a same-value record of another
  institution is `wrong_institution`.

**Aggregate decision: a reading, not a derived fact.** The binder makes no fact from a competitor's
price. The evidence contract has no class for it. It is not an observed fee record:
`validObserved` needs a catalog row id and a source document id, and the read carries neither. It
cannot be a derivation either: `derivationHolds` requires every input to be a validated record in
the bundle, and the read does not carry the competitor's rows, nor their ids, for a median or max
to be recomputed from. A synthetic id would let the binder support a figure no record backs. So,
as with a benchmark median, a sentence stating a competitor's price is Hamilton's reading
(`interpretation`) when no record holds that value, and is left out as `wrong_institution` when a
record of another institution does.

**Known limits:**
- A true competitor sentence is left out, not shown as a reading, when the subject (or any other
  named bank) has a record at the same price. Overdraft prices cluster ($35, $30), so this will
  happen. It errs toward cutting.
- Subjects are read per sentence, not per clause. "Bank A charges $37, while Bank B charges $35."
  names both, so the $35 can still bind to a $35 record of Bank A.
- A later sentence that names nobody now carries the competitor ("Bank B charges $35. It also
  charges $30 to stop a check."), as it would for a profile-named bank.
- Names are found by plain substring (`namedIn`). The longest name is matched first and blanked,
  so "Capital Bank of Texas" is not also read as "Capital Bank" (a review finding, fixed here).
  A short name that is also an ordinary phrase ("Community Bank" in "as a community bank") is
  still read as named, and a shortened name ("Wells Fargo" for "Wells Fargo Bank") is missed.
- `document_url` and `document_date` are the first category's `MAX(document_url)` and
  `MAX(updated_at)` per competitor, as the existing exhibit uses them. That is a pointer to a
  schedule and the catalog's last update, not the document behind each price, nor its date.
- Separate root cause, not fixed here: the written answer's figure gate
  (`checkNarrativeFigures`, `figure-check.ts`) traces a dollar figure only under a money-like key.
  The read keys prices by category (`fees: { overdraft: 35 }`, `your_fees`), so a competitor price
  that no profile also holds is called untraced and the answer is held before the binding is
  shown. This is why the golden set has no "reading" control for a competitor price.

**Measured:** no existing test or golden case changed outcome. The new two-sentence unit test and
the golden case `sb-competitor-carried` fail without the binder change: both sentences come back
supported, the $35 resting on `fee:published:14` (Bank A's $35 line). The golden set (version
2026-10-25.10) adds one swapped-bank case (shown, one sentence left out as `wrong_institution`,
target `ready_partial`) and two controls (Bank A's own $37, and a sentence naming no institution
that binds to Bank A's $35 line as before). The unified gate replay agrees on all three.

**Guard:** `src/lib/hamilton/written-answer-binding.test.ts` ("local competitors in a written
answer"), `src/lib/research/tool-local-competitors.test.ts` ("local competitor identity"), and the
`sb-competitor-*` cases in `src/lib/hamilton/claim-golden-set.ts` (run by
`claim-golden-set.test.ts` and replayed in `output-gate.test.ts`).
