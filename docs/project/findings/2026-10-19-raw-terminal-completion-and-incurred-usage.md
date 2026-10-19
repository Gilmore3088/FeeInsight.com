# Raw terminal callers accepted unfinished answers and omitted their incurred usage

- Date: 2026-10-19
- Foundation: #1048; bounded outcome: #2275.
- Scope: terminal raw text/JSON consumers and their existing usage readers. No dependency, schema, provider/model/key/base URL, prompt, token cap or automation-control changes.

## Evidence and boundary

The prebuild assessment pinned source `3823f62084d4ff674bf209506c6566cbcb54af0c`; its twelve relevant runtime blobs matched this branch's `eee142d7c8289aad52f977e489e6b6d00ef2a07b` baseline. Actual installed SDK/factory fixtures accepted syntactically valid partial text or JSON at `max_tokens` into sections, thesis, memo, Simulate, editor approval and guide review storage. The connected memo action could overwrite a saved answer after its existing identity/evidence checks. Fourteen terminal safety assertions failed, with fifteen ordinary/generic-tool/explicit-partial controls passing. Five additional Rosetta policy failures were measured separately and remain outside this outcome. Earlier malformed fixture setup errors are preserved separately; they are not evidence of protection.

The raw terminal requests here configure no client tools or stop sequences. They now require `end_turn` before parsing or storage; a `stop_sequence` is accepted only when an explicitly supplied request boundary matches. Missing/null/unknown reasons, truncation, refusal, pause and unexpected tool work fail with the existing typed incomplete-response error. Only text, thinking and redacted-thinking content blocks are allowed: tool invocations/results, container uploads and unknown block kinds fail, including text mixed with a misleading `end_turn`. The assertion stays inside tracked callbacks, so rejection is a failed response with preserved trustworthy usage. Existing figure, identity and JSON guards still run on ordinary completed fixtures.

This is an opt-in terminal contract. Generic `paidModelCall` tool responses remain valid, and Rosetta's intentionally labelled `max_tokens` → `ok_partial` transcription is unchanged. The editor remains informational: its failure does not itself prevent report rendering. Existing assemblers may render deterministic fallbacks when generation fails. Guides still enter review and retain their separate existing provider-tracking gap. No automatic continuation, new paid retry or larger budget is introduced.

## Incurred work is distinct from a usable answer

The shared predicate includes legacy completed events and failed events whose recorder-authenticated `usage_observation` is `observed`. The SQL OR remains parenthesized before every route, agent, run and time condition. Caller annotations cannot spoof failed observation or completion provenance. Missing/malformed totals are unknown with NULL cost and explicit zero-placeholder metadata; observed zero still consumes a request. Unsupported model prices also stay NULL, while their observed requests count. Unknown spend is not inferred or converted into a known free call.

Daily/monthly and per-run guards, run counters, API trust, console spend and goal cost readers now retain observed failures. Base input/output, cache-read/cache-creation and search costs remain on the central provider receipt. Existing failure lists, route error audits and monetary credit-stop rules keep their purposes; semantic incompletion does not engage a billing stop.

Units remain distinct: one tracker event can contain up to three raw HTTP transport attempts. The report observer counts returned generation responses, including discarded figure drafts and failed partner rewrites; it is not a complete HTTP-attempt or billing census. Weighted request readers use `request_count`; goal `weekCalls` remains a count of ledger events. Unknown estimates remain a lower-bound gap in existing run/spend totals. Memo's legacy user-cost estimator still prices base input/output only; this patch does not reconcile its cache/search cents with provider billing.

## Connected persistence and request receipts

An incomplete memo is unavailable, cannot replace saved content, and retains observed calls/tokens (including known zero) in its existing mutable quota callback. Unknown or pre-call-denied work does not invent a memo call. Ordinary injected memo clients retain their prior counting behavior.

Report workers settle all already-started siblings before one final request outcome. The observer preserves returned usage through internal figure regeneration, failed partner rewrite, and both parallel completion orders. A valid original draft survives a failed rewrite. Typed incompletion retains its cause and bypasses the generic paid retry. A save rejection after generation now emits one final failed outcome; successful saving precedes a completed outcome. Pre-call guard rechecks preserve the existing retry policy but make no provider fetch or user model-call quota row. Bookkeeping/receipt failure cannot trigger re-billing or a duplicate outcome invocation.

These are once-only in-process receipt invocations when storage succeeds. Provider-event INSERT and run-counter UPDATE remain separately caught best-effort writes, and user/Pro receipts retain their existing storage semantics. No atomic/durable exactly-once or exact provider billing guarantee is claimed. Report unknown returned usage keeps NULL in the Pro detail; its legacy non-null cents column uses a labelled placeholder.

## Permanent guards and limits

**Guard:** `src/lib/raw-terminal-response.integration.test.ts` uses actual installed raw SDKs and application factories/trackers with synthetic fetch, exercising all terminal callers, absent/unknown/native reasons, unexpected tool blocks, saved-memo retention, true-zero versus unknown usage, ordinary content gates, generic paid tools/configured stop boundaries and Rosetta explicit partial preservation.

**Guard:** `src/lib/hamilton/report-terminal-response.integration.test.ts` connects actual generation and report actions to injected auth/data/storage: two unfinished siblings, either completion order, figure regeneration, failed partner rewrite with original retention, no extra semantic retry, post-generation save failure, receipt-write failure, known-zero/unknown totals and pre-call denial. `src/lib/hamilton/report-actions.test.ts` keeps existing selected-institution/evidence/export controls with the real observer contract represented by its generator fixture.

**Guard:** `src/lib/provider-usage-accounting.db.test.ts` runs actual recorder and budget/console/API/goal queries on a loopback-only production-schema fixture in a random isolated schema. It tests authoritative provenance, JS/SQL equivalence, OR grouping, route/agent/run/window boundaries, daily/monthly/call/cost caps, weighted requests versus event counts, cache/search cost, zero/unknown/unpriced usage and no provider creation at cap. It creates only private fixture objects/sequences and drops them afterwards; CI explicitly includes it in the SQL inventory.

**Guard:** `src/lib/ai-provider-usage.test.ts`, existing generate/memo/editor/guide content tests and report/home/evaluation/renderer/paid-pass/Rosetta suites preserve cause handling, content checks, generic tools, injected-client behavior and fallback policies. The release requires focused/static/full/agentic/current SQL and isolated production-build gates plus exact-head independent review and required CI.

All provider responses are injected; no production, bank/source, provider or storage request is acceptance evidence here. Rosetta's other stop reasons, guide tracking, unknown charged-response recovery, input/tool/UI budgets, broader egress and remaining dependency families remain separate work.
