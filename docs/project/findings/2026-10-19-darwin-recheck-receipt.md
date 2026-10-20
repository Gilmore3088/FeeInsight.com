# Returned Darwin recheck reports were omitted from the saved classify receipt

Issue #2309, under Darwin #1110 and related switch-audit work #2072. Darwin returned `recheck`,
but the classify/verify outcome omitted it before the real `finishAgenticStep` saved-event
JSON boundary. The guide promised details that operators could not recover from that receipt.
An external fixed-fe8 synthetic runner proof preserved four intended missing-field failures
and one ordinary positive, with five completed saved-INSERT witnesses. Earlier mock setup
failures are retained separately and are not defect evidence; this was a controlled SQL sink,
not a production count or an actual PostgreSQL write.

The receipt now saves a bounded pure allowlist projection and narrates it even when no new raw
fees were processed. Producer counters and outcome-array counts remain separate from safe
ID/category/reason/amount samples, capped at 20. Raw errors/source text/stacks/fee names and
unknown objects never enter this new projection. Shadow errors expose only presence and a
fixed code. Invalid/missing values remain unavailable; partial reports never acquire invented
pass/wouldClear complements. Ordinary verification counts and transaction completion are
preserved by connected runner-to-saved-INSERT tests.

Every received report has unknown assessment completeness, including zeros: primary and
narrow-due selection errors can be swallowed by the existing producer. Returned restored and
rejected IDs follow UPDATEs without RETURNING, so counts remain producer-reported outcomes,
not independently verified mutations. Shadow read/due counts describe work in the selected
batch, not its whole selection or backlog. Null, known dry-run nonexecution, learning-unavailable
nonexecution and malformed reports remain distinct. No producer, selector, switch, version,
policy, fee action, feedback write or teaching behavior changes here. Broader #2072 remains
open; the historical eight-case cohort and activation/deletion decisions are outstanding.

**Guard:** `src/lib/agents/darwin/verified-recheck-receipt.test.ts` checks bounded/nonthrowing
projection, unsafe values, error redaction, partial/zero/absence and unknown completeness;
`src/lib/agents/run-store.test.ts` exercises both aliases through the real runner and saved
event INSERT with completion/count witnesses; `src/lib/agents/narrate.test.ts` checks the
zero-new-raw path, ordinary verification and unavailable/error wording. Required broad gates
and exact-head review are recorded with the PR; no live bank/provider or production test is
needed for this receipt-only outcome.
