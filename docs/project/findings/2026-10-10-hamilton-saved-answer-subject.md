# Saved answers must retain their recorded research subject

Related: #975 and #976; partial H01-T04/T05/T06/T08/T09 work.
Starting head: `dcf73f4a490ecbb41af4ed842c4b726e192ee93c` on
`fix/hamilton-institution-context`. This is an additional commit on draft #985,
not a merge, deployment or completion of H01.

## Reproduced paths

1. Analyze's recent-answer links use `hrefWithInstitutionContext`, attaching the
   institution currently being browsed to an older answer's URL.
2. `resolveArtifactContextInstitutionId` formerly prioritized that URL over the
   saved record's institution, and the shell skipped the saved lookup entirely
   when `instId` was present. An answer about A could therefore be surrounded by
   B's labels, request context and report-basket metadata.
3. `AnalyzeWorkspace` initializes answer/export state from props with useState,
   but had no user/subject/artifact identity boundary. Reusing its position while
   navigating between saved answers could retain the previous answer/export ID.
4. The prose audit helper labels any supplied institution name 'Your institution'
   without an account-membership check.

The saved record loaders already scope reads to the authenticated user. These are
identity/presentation findings, not evidence of cross-account data disclosure.

## Implementation boundaries

- Saved Analyze views request an authorized analysis lookup even if `instId` is
  supplied. The page and shell explicitly prefer the saved record's canonical ID.
  Existing explicit-URL semantics for scenario/report configuration are unchanged.
- History-link construction no longer appends the currently browsed institution
  to a saved-analysis link. Server-side precedence still protects old/conflicting
  links already in circulation.
- An inaccessible/invalid saved ID cannot silently become a new auto-sent question;
  the page uses a generic not-found outcome through the existing user-scoped loader.
  That loader also returns null on a storage failure; the UI cannot currently
  distinguish a missing record from that outage. No new existence leak is added.
- Missing/invalid recorded subjects never invoke the current-workspace fallback.
  Unresolvable recorded subjects likewise remain unscoped. Their original content
  remains readable with a notice; questions, report-basket additions, modeling
  links and exports are disabled for that view rather than misattributed. The
  recovery link starts a new question and does not rewrite the historical record.
- Saved views ignore new-question auto-send and intent overrides. Their explicit
  preference link leaves the artifact view before making the existing selection.
  A URL `setBank=1` on an open saved analysis does not change the preference.
- The client conversation is keyed by authenticated user, canonical subject, saved
  answer ID, handed-over question/intent and read-only state. Ordinary rerenders
  preserve drafts; a different context resets local answer/export state.
- Cleanup marks the old conversation inactive and stops its prose stream. Late
  completion/fallback callbacks cannot update or save through that unmounted
  conversation. This does not certify cancellation of every server-side or
  structured/memo request, or every cross-tab/race case in H01/H04.
- The Ask audit uses 'Research subject', and its starter prompts/placeholders name
  the selected institution rather than implying that every viewed bank is ours.
  Generated narrative, structured story pronouns, account authority, source-date
  verification and previously stored text are not rewritten by this patch.

## Verification evidence

Exact baseline bytes for the original workspace renderer, context-link helper,
artifact helper and prior-PR layout were checked against their fetched Git blob
SHAs before editing. The renderer change is a targeted patch, not a replacement
implementation or a new design system.

Local checks:
- 31/31 pure-helper assertions passed, executing the actual two TypeScript test
  files through a Node assertion adapter. The original helpers pass 15 and fail
  16 of these; some failures reflect new key/contract APIs, not separate bugs.
- 10/10 server-page wiring assertions passed against the actual page/test code
  using synthetic auth, saved-record and resolver dependencies, plus a minimal
  JSX-object adapter. This is not React rendering or a live-auth/database test.
- The two pure production helpers pass strict TypeScript checking without external
  boundary stubs. Changed TS/TSX files have also been syntax-transpiled locally;
  that is not full application typechecking.
- Ten additional tests are authored for the real Vitest/jsdom runner: changing
  subject, changing saved answer, changing user, preserving drafts, read-only
  legacy content, late completion suppression, export request ID, neutral starter
  copy, and audit identity with/without a known subject. Local React/Vitest/jsdom
  dependencies are unavailable, so these tests require the actual repository CI.

Record CI results against the new exact head in #985/#976. The prior commit's
successful CI run 37992203250 is not evidence that this new commit passes.
A mocked export request proves its selected ID, not a rendered PDF's correctness.

## Remaining acceptance

Authenticated phone/desktop walkthroughs and inspected exports remain mandatory.
Active account/home membership still needs to reach the answer-producing services
separately from research subject and saved preference. Complete pronoun handling,
all artifact types, subject-bound evidence/peer metadata, broad authorization/race
coverage, legacy preference repair and the URL-based preference write all remain
open under H01/H06/H07. No entire H01 task or release checkbox is satisfied merely
by this partial patch. No source-fee data, database schema, permissions, model
prompts, billing rules or production settings are changed.
