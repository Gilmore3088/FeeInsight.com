# Peer SQL contract checks must tolerate formatting, not wrong mappings

Related: #975, #977 H02-T09, draft #988.
Starting head: `49c8ca9403fb4bd1caec0d5e1dc702019e51cca7`.

## Observed failure and limits

GitHub run 38005218290, job 114072323798, finished with failure. The retrieved
logs report 11 passing focused peer UI tests, then one full-suite failure in
`hamilton-peer-list.test.ts`: a contiguous text assertion for the regulator CASE.
The logged SQL wraps `credit_union`, `THEN 'ncua'` and `ELSE 'fdic'` across lines.
The isolated PostgreSQL step did not run; it is not verified by this patch.

The freshly fetched production blob 6cf53644f4cc20254c8022b6628dcdcc13893566
contains the CASE on one line. Its original test blob is
d1729d3a0957590f5cb68cc4182f911541379198. The local copies matched these hashes.
All 14 original cases passed in the isolated local adapter against those exact
bytes. Thus the source/log formatting difference is not fully reproduced, and
this patch does not claim the cause of that discrepancy or the earlier Card error.

## Change

Require the complete source-selection CASE with a whitespace-flexible expression:
credit unions map to NCUA and the alternate branch maps to FDIC. This is not a
removed assertion or a change to production SQL. Add tests that accept the logged
line-wrapping form and reject a wrong regulator in either branch. Strengthen the
ordering checks to require both fragments to exist before comparing their indices;
otherwise a missing fragment with index -1 could accidentally satisfy an ordering
assertion. Keep the asset conversion, coverage, count and other checks unchanged.

## Verification

Executed the actual updated TypeScript test file and unchanged production module
with the portable Node assertion/mock adapter: 17/17 cases passed. Three added
cases cover formatting and negative regulator mutations. This is not real Vitest,
a PostgreSQL execution, browser verification or production evidence. The npm
registry could not resolve from this runtime, so no local Vitest result is claimed.
GitHub's current-head full suite and eight real peer SQL tests remain required.

No application logic, query, data, schema, permission, model or deployment changes.
The day-away scheduled continuation must inspect the next run's actual result,
not assume this test patch makes the combined feature ready. Preserve all prior
failed runs and do not close H02 or release the stacked PR on this evidence alone.
