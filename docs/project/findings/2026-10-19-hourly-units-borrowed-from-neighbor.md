# Hourly units were attributed to another fee's price (#1456)

The read-only whole-table hourly check on main `15cfd2d64` proposed 2,080 line-only changes
at 1,622 institutions. It matched a fee's amount anywhere on its stored line and accepted
hourly wording anywhere before or after that price. Equal prices, a previous price's suffix,
and another fee's label therefore supplied an unrelated fee's unit.

Three source-grounded witnesses are Citizens Bank stop payment 19296 (another $30 research
fee), First Service FCU counter check 32264 (preceded by $25/hour research), and Mound City
Bank box rent 36105 (another $25 subpoena-response fee). The original source artifact IDs
are 712, 6275 and 6676. The new tests fail on the previous code.

Darwin now passes the actual fee name to `hourlyFromLine`. Each named read needs that literal
owner before its own price, including a single-price line. A unit must directly qualify that
price or occupy a unit-only next cell; the previous price's suffix and a later fee's label
cannot qualify it. A minimum/maximum is a bound, and a partial-hour unit is not an hourly
price. An unnamed caller leaves incompatible equal-price readings unknown.

The replay over the exact same 7,467 exported inputs proposes 2,033 line-only changes at
1,593 institutions: 47 prior sets and four exemptions become unknown, with no newly eligible
sets. All 27 reviewed W43 whole-hour positive controls remain sets. Some excluded rows are
real hourly fees with cut names, malformed source text or composite charges; this change
does not repair those inputs or claim that they are flat charges. Existing name-based hourly
policy and already-hourly rows are unchanged.

`HOURLY_LINE_LIVE` remains false. This fixes the predicate and prepares a reviewable count;
it does not activate the line-only writer, change production frequencies, or reopen any
extraction/verification/publication epochs. #1456 stays open for its controlled activation
and remaining source/partial-hour work.

Activation remains blocked by source correctness beyond this predicate: #2219 reproduces
Oakwood's shifted PDF columns in the current Rosetta reader, #1827 covers the merged
varies/research label retained at Primeway, and #2220 records original extraction hashes
that differ from the artifact rows now stored under the cited IDs. The 2,033 are candidates,
not a globally source-certified change set. The 27 W43 positives are unit witnesses and
do not rescore stale, wrong-source or incomplete-condition observations as matches.

**Guard:** `src/lib/agents/darwin/hourly-frequency-check.test.ts` covers the three actual
failures, equal/unequal neighboring prices, incompatible single-price labels, unit-only next
cells, bounds, partial-hour contradictions, the off switch and all 27 exact W43 controls in
`src/lib/agents/darwin/hourly-frequency-check.fixtures.ts`; `src/lib/fee-frequency.test.ts`
retains the existing frequency semantics.
