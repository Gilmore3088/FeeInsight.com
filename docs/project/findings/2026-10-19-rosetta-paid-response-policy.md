# Rosetta paid transcription response and cost contract

Issue: #2325. Parent: #1050; related scan coverage #1056 and Foundation #1048.

Rosetta previously accepted syntactically usable transcription text without checking most
native stop reasons. Its explicit partial flag covered `max_tokens` alone. Preserved
actual-SDK fixtures therefore stored context-window fragments, refusals, paused work and
unknown/null reasons as ordinary successful reads. Separate actual-SDK end-turn controls
showed missing/malformed usage becoming a zero estimate, and observed unpriced usage
remaining NULL in the ledger while the paid result/attempt and narrator called it $0.00.
These are synthetic controlled fixtures, not a claim about deployed document prevalence.
The original seven-reason and five-usage proofs, including setup failures, remain in
`Reports/evidence/rosetta-accepted-usage-proof-b269` outside this application diff.

The transcription-only policy now runs inside the tracker before completed accounting.
Ordinary `end_turn` is usable; `max_tokens` and `model_context_window_exceeded` are explicitly
partial, subject to the same empty/NO_TEXT, fee-page and prior-text-yield checks. A stored
completed artifact means usable source text, never exhaustive or faithful transcription
proof. Refusal, pause, unconfigured stop sequence, absent/unknown stop reason and unrequested
tool/result content settle as `rejected` before successful text/table/profile writes or
low-yield handling. No semantic continuation, extra call for a rejected native reason or
token increase is added.
The attempt binds selected source/run/step, produced text hash and separately retained
text hash when a better earlier artifact stays. Version2 does not reopen historical settled
paid attempts on the same bytes; no global reader version or history replay changes.

For this opt-in only, accepted replies validate actual base usage totals before recording.
Observed zero stays zero; valid cache/search counts remain part of the estimate. Missing or
malformed totals have unknown observation and NULL estimated cost; an unpriced model keeps
observed counts with NULL estimated cost. Typed rejected replies retain the same honest
observed/unknown accounting. When required persistence succeeds, paid results, saved step detail and independent narration
carry a known estimate subtotal plus the number of returned replies with unavailable cost.
The non-null attempt cost column has an explicitly marked zero placeholder for those
replies, excluded from playbook folding so it cannot lower learned mean cost. This cohort
is therefore absent from that strategy's playbook statistics. Pre-call denial is not an
unknown returned response. No-return transport cost uncertainty remains unresolved here.

Generic paid tools/default completed normalization and the shared incurred predicate remain
unchanged: completed requests, or failed requests with recorder-validated observed usage,
count as incurred. Unknown failed replies are visible NULL-cost events but remain excluded
from the existing incurred spend/run predicate. Known estimate totals do not account for
unknown charges. Ledger/run writes are existing best-effort writes, not an atomic or durable
exactly-once billing guarantee; one emitted receipt can contain up to three unchanged HTTP
transport attempts. No provider/model/prompt/key, package, schema, budget/control or live
source/provider setting changes are part of this fix.

The provider receipt is recorded before artifact writes, and the paid attempt remains
outside that artifact group. When the normalized-witness capability is ready, main's
`atomicTextWrite` groups artifact/table/profile and witness writes in a transaction or
savepoint. A failure rolls back that group. Without the capability, the legacy fallback
can still leave earlier autocommit subwrites after a later statement fails. In either
mode, a successfully committed provider receipt survives a later text-write error without
a second provider event. That error rejects the reader before its normal paid result,
settled attempt and saved success summary are returned. A failed first artifact write
retains the prior artifact and can leave later paid selection eligible. This remaining
cross-group persistence boundary stays under open #1050/#1048; no global no-retry, atomic
provider/artifact/attempt settlement or storage-recovery guarantee is made here.

**Guard:** `src/lib/agents/rosetta/paid-read.integration.test.ts` exercises the actual installed
SDK, factory, bounded transport, tracker and reader against intercepted synthetic JSON:
usable partials, unresolved native reasons, mixed/bare tool results, malformed text, ordinary
thinking, missing/malformed/zero/unpriced/cache/search usage, one request/event and no rejected
write sinks. It makes no provider/network or database request.

**Guard:** `src/lib/agents/rosetta/paid-read.db.test.ts` uses a random schema on an owned TLS
loopback production-schema fixture. Real text/table/profile/attempt/ledger writes prove
partial lineage, prior-good preservation, settled selection without another paid call,
known-zero versus unknown playbook behavior and the unchanged incurred predicate.
Known/unknown returned-response cases use an owned-schema failing text-INSERT trigger with
witness capability both ready and unavailable. They prove the already committed ledger
receipt/run counter survives, prior text/profile stay, no normal paid attempt is written
and a later dry selection remains eligible. A normal unknown-cost usable partial with
ready retention preserves both exact witnesses plus the response/cost/lineage fields.
The fixture applies main's exact migration contract only in its random schema. These SQL
responses use the existing injected creator; actual-SDK controls are the separate suite.
`src/lib/provider-usage-accounting.db.test.ts` preserves existing observed/unknown/zero
accounting and budget/run controls.

**Guard:** Existing `paid-read.test.ts`, `paid-pass.test.ts` and `ai-provider-usage.test.ts`
preserve original content checks, no-call budget denial, generic paid behavior and opt-in
recording order. `run-store.test.ts` executes the actual paid dispatch and captured saved
step/event detail with an injected runner, then independently calls real narration for
mixed/all-unknown/zero/rejected/pre-call-denied outcomes; `narrate.test.ts` also covers the
formatter directly. This saved-step fixture is distinct from the actual-SDK reader fixture.
