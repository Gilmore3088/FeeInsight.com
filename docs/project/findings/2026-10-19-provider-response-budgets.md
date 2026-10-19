# Provider bodies were unbounded by application policy; failed streams could save partial answers

- Date: 2026-10-19
- Foundation: #1048; outcome: #2210.
- Scope: the existing centralized Anthropic factories, their raw/AI SDK consumers, and the three Hamilton streaming routes. No dependency, schema, provider/key/model/base-URL/prompt or automation-control changes.

## Evidence and cause

Actual installed SDKs through the prior application factories accepted synthetic JSON above 4 MiB, HTTP error text above 64 KiB and one SSE event above 1 MiB. Those were three failing policy assertions with two ordinary zero controls; they establish the lack of these practical application policies, not that those byte counts are inherently malicious. Earlier bounded header-only tests established a missing application boundary without allocating their declared 512 MiB. The upstream AI SDK safety default was 2 GiB, not an application-sized allowance. No paid or production request was used.

Actual AI SDK callback order on a partial provider error was `onError`, then `onFinish` with partial text and an error finish reason. The research route's old `onFinish` saved that text as an Analyze answer. Five initial route assertions failed for error, length, content-filter, tool-calls and other terminal reasons, while its twelve existing controls passed. Successful older buffered mocks omitted the real SDK's `finishReason`; those fixtures now explicitly represent `stop`, preserving their original evidence/account/peer-set/prompt expectations.

The raw SDK's ordinary two retries include an unabortable `sleep` after a retryable response. A real installed-library 429 with a synthetic 1,000 ms Retry-After retained that sleep after a 20 ms operation abort. Merely aborting fetch or racing a promise did not settle that logical operation. The failed baseline remains in the external audit evidence.

## Bounded transport contract

The new policies are product choices, independent of model token maxima or measured traffic percentiles:

| Boundary | Policy |
| --- | --- |
| Successful buffered JSON body | 4 MiB |
| Non-success HTTP body | 64 KiB |
| Complete SSE frame, including comments/line endings | 1 MiB |
| Cumulative decoded response bytes for a logical operation | 16 MiB |
| Active response body without a nonempty byte chunk | 60 seconds |
| Existing raw request policies | 60 / 90 / 600 seconds, now shared across headers, bodies and retries |
| Existing buffered written answer | 180 seconds |
| Previously unbounded AI calls, streamed or buffered | 300 seconds |

An operation starts its deadline at its first actual provider fetch, spans retries/tool steps, and is disposed at provider termination. Each logical operation creates a fresh bound client/model. No counter or dispatcher is global; a bound client is not reusable for a different operation. The total timer continues during tools/backoff; byte-idle applies only while a response body is active. Completion, error, abort, retry waits and outgoing cancellation release their owned timers/listeners/readers. Disposing an active pending body read without a failure reason still settles it with AbortError; actual incremental provider-error-then-stalled-body fixtures verify consumer settlement and the deferred failure receipt. A browser cancellation after successful provider disposal cannot turn success into a late failure.

Strict usable identity Content-Length headers can reject before pulling; absent, false, malformed or compressed wire lengths still receive decoded streamed-byte checks. Rejection aborts that same scope and rejects the response rather than truncating it. Fetch-decoded bytes are bounded before SDK body buffering/parsing. Already allocated upstream chunks, synchronous parsing work, provider request inputs, tool results, retained conversation history, and outgoing UI data are outside this transport policy.

Raw callers use only the SDK's public per-attempt `maxRetries: 0`; the operation owns the same two normal retries and cancellable waits. It retains 408/409/429/5xx and connection/timeout decisions (using public SDK instance identity rather than a constructor name that bundling could change), `x-should-retry`, retry-after-ms/seconds/HTTP-date and exponential jitter fallback. Waits share the remaining deadline. Invalid/nonfinite delays fall back and negative delays are clamped to zero. Retry-count headers are explicit 0/1/2; existing request/custom/idempotency headers and request timeout settings remain. The current raw client has no automatic idempotency-header configuration; the actual-library control separately proves an explicitly supplied idempotency header is retained. There is no private SDK patch or second hidden retry layer. SDK internal diagnostic request/log IDs can differ because attempts are separate public invocations.

## Completion and accounting

Only the AI SDK's ordinary final `stop` can save an assistant/Analyze answer or record completed success. The native client does not treat length/refusal/tool-call finishes as errors by itself: the current Analyze component would use its legacy browser save fallback. Three additional actual route → SDK Chat transport → mounted current Analyze callback regressions reproduced that save. Chat/research now emit the SDK's unsuccessful error protocol before unfinished completion (preserving the native finish reason); Simulate's plain-text projection rejects its body on incomplete termination instead of silently finishing partial prose. No component/prompt change is required. Intermediate tool-call steps still run normally; a final exhausted tool-call step is incomplete. Raw max-token/truncation policy beyond a transport failure remains a separate follow-up.

Chat and Simulate attach an SDK consumer before returning and abort the same operation when the outgoing stream is cancelled. Research retains its intentional detached consumption after a browser disconnect. The extra consumer uses the SDK's replay/tee behavior; the 16 MiB response budget does not claim to cap tool-generated or UI replay buffers. Actual provider completion may precede draining the browser branch.

A connected actual over-limit SSE test also exposed a separate dead end: the installed SDK's `consumeStream` catches reader errors and resolves unless its public `onError` observer is supplied. Catching its returned promise alone left research's verdict/saved promises pending; the old control reached its unchanged five-second test timeout. Each route now supplies the synchronous public observer as well as a catch fallback. Native abort UI parts also need an explicit unsuccessful error part: the installed Chat client otherwise ignores them, unlike its own local Stop signal.

Failure callbacks settle local UI promises immediately. A single failure receipt flushes only after the SDK consumer settles, allowing a later terminal callback to supply trustworthy totals. No callback waits on that flush/consumer, avoiding a cycle. A failure never saves a partial answer, logs completed usage, rolls back already committed tools, issues a refund, or engages the monetary billing stop merely because a local size/deadline policy was reached.

Known observed totals, including actual zero, remain estimates on the failed receipt with `response_complete: false` and `usage_observation: observed`. Missing/malformed totals stay unknown: `estimated_cost_microusd` is NULL, token columns retain their existing zero placeholders with explicit `token_counts_are_placeholders: true`. Existing context metadata is retained. Buffered research/written-answer typed incomplete errors carry observed terminal totals to the same tracker rather than discarding them before accounting. This does not redesign agent-run monetary budget accounting.

## Permanent verification and limits

**Guard:** `src/lib/ai-response-budget.test.ts` exercises exact/+1 JSON/error/frame/cumulative boundaries, UTF-8, split CR/LF frames, comments, missing/lying/compressed headers, idle/deadline/cancel disposal, and reader lock release.

**Guard:** `src/lib/ai-response-budget.integration.test.ts` runs actual installed raw/AI SDKs through the application factories: exact 4 MiB JSON and structured UTF-8 zero, exact 1 MiB SSE, actual large tool inputs through exact 16 MiB and +1 cumulative bytes, ordinary tool zero, shared retry/deadline/cancellation, and normal retry/header/error controls. Synthetic fetch only; no provider network or giant declared-body allocation.

**Guard:** `src/app/api/hamilton/chat/route.response-budget.test.ts` and `src/app/api/research/hamilton/route.response-budget.test.ts` exercise actual route/SDK callbacks and consumer order, partial errors/unfinished reasons, cancellation/late cancellation, research detached completion, real tool-loop completion, known-zero versus unknown usage, actual usage INSERT arguments, one failure receipt, and no failed answer save. Research also connects the actual Chat transport to the current mounted Analyze callback, proving its fallback save cannot run after partial/unfinished responses, oversized-event/idle aborts or native abort protocol; ordinary stop/tool loops and local Stop remain positive. Its in-memory fetch bridge honors the client signal for the Stop control. Research intentionally continues after that browser cancellation and may save a later successfully completed answer; no fallback save runs from the cancelled partial answer. Auth/data/tool effects and fetch are fixtures.

**Guard:** `src/lib/ai-provider-usage.test.ts`, `src/lib/anthropic-sdk-integration.test.ts`, `src/lib/ai-sdk-compatibility.test.ts`, existing paid-pass/guide/report/memo/editor/written-answer and research account/conversation/evidence suites preserve provider selection, paid guard ordering, accounting and prompt/identity contracts.

These are deterministic code/synthetic transport controls, not paid-provider, deployment, real browser, live workload/p99, egress allowlist or whole-process memory acceptance. No fixture establishes that every possible valid model result fits these policies; oversized results fail explicitly. Input/tool-result/UI budgets, broader outbound egress controls, larger dependency-family upgrades and raw nontransport truncation policy remain separate work.
