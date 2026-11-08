# Hamilton conversation continuity acceptance

This is the separate conversation-pointer finding already tracked in Hamilton #975 and Foundation #1048, under H04 reload, reset, recoverable failure and authorization work. It does not close either tracker or expand the saved peer research outcome in [PR #3007](https://github.com/Gilmore3088/FeeInsight.com/pull/3007).

## Problem and resulting behavior

The previous Analyze client published a newly allocated conversation UUID before its first history snapshot was acknowledged. Allocation creates only a shell. A failed or pending record could therefore leave an address that promised continuity without an acknowledged history. A separately saved analysis is a different artifact and cannot establish conversation persistence.

Analyze now keeps the allocation private until an affirmative snapshot acknowledgement. One queue per conversation serializes immutable snapshots and coalesces newer content. A retry reuses that allocation and saves the latest eligible snapshot without asking Hamilton again. A later failed update preserves a previously acknowledged pointer. Save status and a retry control appear beside the composer, while the answer and draft remain available.

The existing server can insert a snapshot and then fail its separate parent metadata update. An unacknowledged result therefore does not establish absence. Retry wire revisions advance even after refusal, while content revisions remain separate; the existing parser limit remains enforced. The client never converts a refused acknowledgement into success.

Fresh-history validation also exposed a peer-reference comparison that treated object-key order as source identity. An actual PostgreSQL JSONB round trip preserved the exact stored values but failed that comparison. The continuation check now compares the four explicit own fields at each original row position. Institution ID, record ID, reporting date, source, row order, row count and extra-field rejection remain strict; object-key insertion order alone cannot invalidate the saved peer set.

After every asynchronous boundary, the client checks its conversation epoch, queue identity, liveness and current route. A reset, unmount or URL subject handoff invalidates older publication and navigation. Market-brief navigation requires the acknowledged current conversation; a failed save leaves its recoverable state on Analyze. Retrying a save does not revive an obsolete navigation intent.

The change uses the existing authenticated actions, owner-scoped loader and semantic tables. It introduces no migration, endpoint, provider execution or production mutation. It does not establish cross-tab write idempotency.

## Independent checks and evidence boundaries

The original independent design contains eleven acceptance cases. Its component baseline on unchanged main produced three behavioral failures and one successful control. A later real-URL handoff case also failed before its correction. Original source, inputs, reports and failed receipts remain retained outside the candidate source; passing candidate assertions do not erase them.

At this candidate's plan freeze, a fresh final-candidate browser run is pending. Earlier failed attempts remain retained. The browser entries below are required checks whose executed status must come from the exact-candidate delivery receipt; completed component and database checks do not supply those browser observations.

| Cases | Candidate checks | Remaining boundary |
| --- | --- | --- |
| CP-01–03: pending, refused, rejected and acknowledged first record | Independent component tests observe the actual address and literal subject/question/ordered peers | Action mocks establish client behavior, not storage or native navigation |
| CP-04: retry and partial commit | Component cases plus a dedicated browser fault in the real parent update after snapshot insertion | Browser run must prove one allocation, a newer wire revision, the same content and no second Ask request |
| CP-05: reset, subject, URL handoff and unmount races | Deferred component cases; new native pending-save reset procedure below | Native same-document reset requires the actual held request's successful EOF; newer-turn and route-handoff native races remain outside this slice |
| CP-06–07: durable pointer, serialization and newer content | Component cases plus real database stale-write controls | Single-client queue and newest-loader behavior do not prove concurrent-tab idempotency |
| CP-08: market-brief continuation | Component controls plus new native normal, refused-save/retry and pending-reset procedures | Native navigation and post-terminal effects must come from the exact-candidate execution receipt |
| CP-09: fresh owner history | Real database fresh-client checks and exact-UUID authenticated browser reopening followed by a Florida refinement | Requires the actual snapshot and fresh document, not a URL, allocated shell or saved analysis |
| CP-10: foreign, malformed and empty-shell access | Existing authenticated action controls, real owner-scoped database checks and fresh other-owner browser denial | Browser denial follows the current empty-Analyze contract; it does not invent a new 404 contract |
| CP-11: unchanged opening and saved-answer fork | State/database controls plus new fresh-owner unchanged-open, actual earlier-answer link and fork procedure | Seeded saved-answer baseline proves continuity only; whole-owner inventory and later real UI turn are required |

The component test is `src/components/hamilton/analyze/AnalyzeWorkspace.persistence.test.tsx`. Schema-backed checks extend the already mandatory `src/lib/hamilton/chat-memory.db.test.ts` lane. Its cleanup requires both a permitted loopback URL and the native database identity; ordinary-suite skipped database cases are not executed evidence. The frozen peer-reference regressions in `peer-list-service.test.ts` and the real database lane separately reproduced the key-order false mismatch before its correction, with unchanged-identity positive controls and changed-identity rejection controls retained.

## Prospective native browser procedure

Run `tests/e2e/hamilton/conversation-persistence.pw.ts` independently at 1440 and 390 pixels against a clean committed fresh production build. Use only the dedicated loopback `engineering_conversation_YYYYMMDD` fixture database, real fixture login, ordinary controls and the existing owner-scoped loader. Provider credentials stay blank. The fixture-only trigger and function must be removed independently in cleanup; no production schema or permission changes are involved.

1. Refuse the synthetic owner's parent metadata update. Ask “List ten similarly sized credit unions.” Require the answer and failure alert, no published conversation pointer, one newly allocated owner row and one real snapshot despite the unacknowledged result.
2. Require the literal subject and question, all ten known peers, exact original ordered row references including record IDs and source dates, and no horizontal overflow. Original source references remain the same after later refinement.
3. Type “Only Florida” without sending it. Remove the fixture fault and click Retry saving conversation. Require the same UUID, owner and creation time; a newer wire revision with unchanged content; the retained draft; and no extra Ask request, allocation or metadata-only save loop.
4. Open that exact UUID in a fresh authenticated owner phone document. Require the prior question and subject. Ask “Only Florida”; verify the fixed seven-peer subset, `refinedState: "FL"`, both stored questions, unchanged original ten references and a newer stored revision through a separate native database connection.
5. Open the same URL as another authenticated Pro user. Require no foreign question, peer table or earlier-history region; verify the owner snapshot is unchanged.

Keep HTTP, console, page, canceled and unterminated-request diagnostics. An already completed semantic callback may defer its unchanged strict v1 error only long enough to gather the other independent witnesses, then must rethrow it. Screenshots retain success and failure states. Sensitive traces are disabled for this test; attached receipts use synthetic references and hashes rather than raw conversation UUIDs or response bodies.

Fresh-build hashes, native database identity, screenshots, exact runner results and independent review belong in the delivery receipt and PR. A local semantic observation remains `LOCAL_BROWSER_CONVERSATION_UNTRUSTED`; strict browser acceptance and trusted workflow provenance remain separately assessed. This plan does not declare a future run passed.

## Additional native continuity procedure

`tests/e2e/hamilton/conversation-continuity.pw.ts` adds four independently frozen cases at both 1440 and 390 pixels. It keeps the existing strict diagnostics and runs against a new clean committed production build. Previous failed browser attempts remain retained. In particular, the prior attempt at `45bf577` completed both persistence callbacks but failed both runner cases on strict request diagnostics; those callbacks do not establish strict browser acceptance.

1. Ask “Tell me about Ohio” through the composer. Require real navigation to the Ohio brief with exactly `brief`, `conversation` and `instId`, the acknowledged native snapshot, and zero market Ask calls. Submit “List ten similarly sized credit unions” through the brief's actual GET form. Require that same conversation and exact stored two-question history, subject and independently frozen ordered source references.
2. Refuse the real synthetic owner's metadata update after snapshot insertion. Require the failure alert and no brief or conversation pointer. Remove the fault and retry. Require the same allocation, strictly newer wire revision and unchanged content with no Ask/provider regeneration. The retry record must finish natively before a bounded two-frame/300-ms observation can establish that retry did not revive the brief intent.
3. Hold the real metadata update with a fixture-only advisory lock. Require a native waiter blocked by the separately owned connection, the correct visible partial snapshot, and exactly one unfinished record POST after the allocation has finished. Bind that request to the native frame, loader and document. Click the actual New conversation control before release in that same document. Require successful EOF of that exact old request, completed database metadata, the unchanged document and no old pointer, brief or save status during the bounded post-terminal observation. A subsequent peer question must save under a different UUID. Canceled, ambiguous or missing terminal evidence leaves this race unknown and failing.
4. Seed an owned active saved answer genuinely linked to its earlier stored turn, then create the later original peer turn through the real UI. Label the seed `SEEDED_LOCAL_BASELINE_NOT_UI_SAVE_PROOF`. A fresh authenticated owner opens the original unchanged: every owned conversation/message row and the whole saved-analysis row must remain identical. Click its actual earlier Open this answer link, require exactly `analysis` and `instId`, the literal earlier answer and no later peer state or writes. Ask “List ten peers”; require exactly one different UUID, the older saved-answer linkage, exact two-turn fork and source references, unchanged original rows and saved answer, then corroborate the fork in another fresh owner document.

The pending fixture's lock mechanism is a precondition to demonstrate, not assumed product evidence. Release and close the blocker before independently removing trigger/function objects; retain cleanup errors and the original failure. Passive native request observation retains no headers, bodies, cookies or action IDs. EOF is necessary here to exercise the awaited continuation; it is not generic proof of Promise settlement or absence of future effects. Each completed subcase is recorded separately from strict runner results. Same-document newer-turn and real-route-handoff races remain covered only by their existing component controls and are not executed by this four-case native slice.

## Delivery and remaining program work

Before delivery, run the focused component/action/state/database checks and the repository guard, agentic, TypeScript, lint and full test checks. Review the exact final head and reconcile overlapping owners. Record required CI's actual database inventory, count, artifact digest and zero-skip result from its native report.

Keep the existing tracker item open until its stated acceptance evidence exists. This slice does not enroll the independent GitHub reviewer, approve PR #3006, register an expanded browser contract, relax transport failures, activate enforcement or establish production accuracy. Full M5 still requires the remaining native Hamilton flows, trusted contract execution, specialist adoption and measured outcomes in the [program plan](plan-validation.md).
