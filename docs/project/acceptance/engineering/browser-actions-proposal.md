# Browser action and saved-artifact acceptance proposal

This supplements `plan-validation.md` under Foundation #1048 and Hamilton #975. The M0–M5 objective remains open. PR #3006 at `baed699f71104afdce8a952264c6844b7f0b2498` is a separate pending owner-controlled contract revision; this work neither amends that head nor supplies its approval.

The independent 43-case design in `browser-actions-cases-v1.json` is frozen as a proposed acceptance inventory, with every case retaining its original `NOT_RUN` design status. Its source inspection used `a97eda6373e3dff7d50f88a61c3e9f45a2967c3f`, whose tree equals merged main `8b748c49a9ffeedea997c44a1a0772e6b76a5fb8`. Executed test receipts must be recorded separately. This inventory is not a registered trusted-workflow contract or an assertion that all 43 cases are implemented.

## Concrete next outcome

A reader saves peer research for institution A, signs in again on a fresh phone session, selects B, and reopens the exact saved artifact. Both the saved content and Hamilton's surrounding institution context must identify A. Another account must receive a user-scoped refusal, and neither reopening nor refusal may change the saved snapshot.

The previous research journey resized its existing desktop page. Independent source review found that `/pro/peer-research/[id]` lacked artifact resolution in both the server layout and retained client shell. The new regression exercises both paths, including conflicting URL/research parameters, missing or inactive records, invalid snapshot lineage and stale asynchronous responses. The baseline test receipt preserves behavioral failures against unchanged main.

## Evidence dimensions

`browser-actions.mjs` composes the existing passive CDP observer and records a bounded action window with generated context, session, frame, document, request, action and artifact references. Only an unambiguous scoped POST, its native terminal event, a source-known UI result, an independently compared persistence witness and a fresh authenticated reopen can complete the supported local action evidence. Imported comparisons remain untrusted. Native request metadata alone cannot establish application settlement or persistence.

The test-side peer-research adapter observes the actual JSON save response and rendered link, compares their artifact IDs transiently, queries the fixed semantic table in the dedicated loopback fixture database, and checks ownership, institution, exact peer membership, source dates and saved identity metadata against fixture authority. It reopens the same artifact in a newly authenticated phone context after selecting another institution, checks every rendered peer, and exercises a second account's denial. The saved semantic digest must remain unchanged. Response bodies, headers, cookies and raw artifact IDs are not attached to the action receipt. Verification mode uses sanitized captures instead of Playwright traces, which retain headers and bodies.

The three finite operation labels describe fresh peer snapshots, fresh saved analyses and fresh board briefs. The first native product adapter covers peer snapshots only. Saved-analysis deduplication, edits of an existing board brief and report-builder PDF downloads need their own effect semantics; a generic fresh-row comparison cannot certify them. The Reports builder's download is not a saved report insertion.

## Preserved blocking boundaries

The original browser v1 assessment and protocol schema are unchanged. Canceled or unterminated POSTs remain unsettled even when a later database read observes an artifact. A later navigation cannot supply an earlier action's completion, and an unrelated or overlapping request cannot lend its terminal event. The action receipt and whole-network receipt retain separate statuses. Completing a supported local action does not clear an unrelated network failure or establish full browser acceptance.

The two new product tests execute the complete peer-research chain independently at desktop and phone widths. Each retains its own console, page, HTTP and request inventory and fresh-context screenshots. Required skipped cases, missing artifacts, setup failures and timeouts remain explicit. A callback result cannot replace the Playwright runner result or either evidence assessment.

## Remaining work before M5 acceptance

- Review and register a complete expanded browser contract with frozen inputs and exact trusted execution identities, retaining the protected owner boundary for policy changes.
- Execute and independently assess the real product matrix, including full Reports builder exports, saved analysis PDFs, saved board-brief creation/editing and fresh-context account isolation. Preserve numeric reconciliation separately from export parity.
- Resolve the outstanding same-document, cancellation, incomplete transport and unobserved-target questions with native evidence and an explicitly reviewed policy. No blanket abort exception is proposed here.
- Complete specialist adoption and measured before/after outcomes. The private holdout remains excluded from tuning; it is not read or rerun by this work.

An additional source finding remains open: Analyze can install a conversation ID in state and URL before `recordAnalyzeConversationAction` stores its turns. A durable saved analysis does not prove durable conversation history. It needs a separate persistence regression and disposition under Hamilton #975; this peer-snapshot outcome does not close it.
