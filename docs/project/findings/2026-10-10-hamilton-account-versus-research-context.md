# Written answers need account identity as well as a research subject

Related: #975, #976; partial H01-T02/T04/T05/T06/T09.
Starting head: `9da7b9912c1919e733d953bf2cd5f9a1141a7bee`.
Branch: `fix/hamilton-institution-context`, existing draft PR #985.

## Reproduced gap

`src/app/api/research/hamilton/route.ts` previously injected the profile's
institution name only when no research institution ID was selected. Selecting
another institution supplied its briefing but omitted account identity. The shared
request contract described the selected institution as workspace context without
separating that subject from the signed-in user's institution.

This is a request-construction finding, not a replay of a live model answer.
`institution_workspace_memberships` already has an active, user-scoped read through
`getUserInstitutionMemberships`; no new membership store or name-matching query is
needed. Account identity must not come from URL selection, a saved research
preference, user display name, or a client-provided ownership assertion.

## Changes

- The request parser still whitelists browser input; it does not accept the new
  optional `serverAccountContext` field. The route enriches the parsed request only
  after authentication, access/quota checks and request validation.
- The account reader uses current memberships for the authenticated user, filters
  active/canonical records and returns only an institution ID/name when precisely
  one distinct institution is established. Multiple memberships remain ambiguous;
  neither their order, the viewed institution nor profile-name matching chooses a
  home. Revoked/other-user records cannot establish account identity.
- No membership is `unlinked`; a failed lookup is `unavailable`. A self-reported
  profile label stays explicitly unverified and supplies no ID or access grant.
  Labels are length-limited, whitespace-normalized and JSON-quoted in the prompt.
  Membership roles, notes, email addresses and grant records are not sent.
- An explicit research institution is never replaced by account identity. With no
  explicit subject, the sole linked account can be the research default without
  writing the saved research preference. Without an unambiguous link, the subject
  remains absent rather than being inferred from profile text.
- The shared request prompt names the subject and account roles separately, directs
  'this institution' to the research subject and 'we/our/us' to the account only
  when identified, and requires correctly scoped evidence for any comparison.
  It explicitly grants no private-data access and treats identity as reference
  context rather than proof of financial claims.
- The written-answer route supplies this context to both buffered and streaming
  generation. New server-saved streamed answers retain a minimal versioned snapshot
  of research ID, account ID and identity status. Successful buffered responses and
  saved streaming message metadata carry the same reference snapshot. Profile text
  is not stored in that snapshot. Historical identity is never future permission.
- Existing citation/provider tests explicitly mock the added membership read, so
  that test suite does not accidentally query membership storage.

## Verification

The fetched originals of `request-contract.ts`, `route.ts` and the existing route
citation test were checked against their Git blob hashes before patching. The
actual new TS test files pass under the local Node assertion/mock adapter:
18 pure identity/contract cases, 11 server-enrichment cases and 12 route-boundary
cases, 41 total. The route cases execute the actual handler with synthetic auth,
membership, provider, storage and stream boundaries, including the server save
callback and metadata. These checks are NOT Vitest, a live database, actual model
output, authenticated browser acceptance or PDF inspection. An initial local
adapter alias-resolution gap was fixed before the route checks could execute; it
was a harness error, not an application result.

The pure identity production module passes strict standalone TypeScript checking.
Full application typecheck, real Vitest, guards, lint and database pipeline checks
must be recorded against the new exact head in GitHub CI. The previous head's
successful run is not proof for this commit. No provider calls or production data
reads/writes were used to execute the local tests.

## Remaining boundaries

This fixes reference context supplied to the live written-answer path; it does not
prove every model sentence respects the context. Structured Ask responses and
storyline memos still need the same account/subject contract, and complete
cross-institution comparisons, generated pronoun checks, peer/evidence provenance,
private-workspace authorization coverage and browser/export acceptance remain open.
The snapshot is additive JSON metadata: existing renderers/exports do not yet
present it as an account badge, and old answers are not rewritten. A full saved
artifact schema/UX review remains under H01/H06. Existing account claims/profile
links are not created, repaired or granted by this patch. Multiple active account
memberships need an explicit future account-selection design rather than a guess.

No fee changes, migrations, grants, model selection, quota/budget overrides,
production deployment or consulting-readiness claim. Keep #985 a draft and H01 in
progress until its remaining acceptance and approved release checks are complete.
