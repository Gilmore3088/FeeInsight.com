# Browsing is not workspace selection

Related: #975, #976 (H01-T01, resolver portion of T02/T03, T09).
Baseline: `1b5de13cd5b2e61ff6ca64047222b6c90888d39b`.
Branch: `fix/hamilton-institution-context`.
Status: partial implementation; not authenticated-browser acceptance or a release.

## Reproduced at the resolver boundary

The original `workspace-context.ts` saves a valid URL institution when no workspace
selection is returned. That includes a database read failure, because the failure
is caught as null. Its explicit save also swallows write failures and still returns
`isWorkspaceBank: true`. Transient Ask/artifact requests skip the saved preference
entirely, so callers cannot distinguish it from the research subject using this
response alone. The old test explicitly expects the first URL visit to be saved.

These are synthetic code-level reproductions, not claims about a production data
leak or a replay of James's authenticated session.

## Changes and compatibility contract

- `institution` remains the resolved research subject. A URL or artifact never
  implies account membership or permission to use private institution data.
- `workspaceInstitutionId` is an optional, additive field for the saved research
  preference. A number identifies the stored preference; null means a successful
  read found none; omitted means the preference was not established, including a
  failed read/save or invalid subject. It is NOT the authorized account identity.
- `isWorkspaceBank` compares the subject with that preference when it is known.
  It is a display/selection hint, never an authorization or ownership assertion.
- Normal URL visits are read-only, even with no saved preference or with the legacy
  `persistUrlSelection: true` flag. Explicit `makeDefault: true` is required to save.
  `persistUrlSelection: false` overrides it and prevents a write.
- Transient requests read the existing preference and return its ID without changing
  it. Artifact/watchlist source labels are preserved.
- Read failures remain errors, not 'new user' states. Save failures never claim
  success. A valid explicit research subject remains in the returned object when
  preference storage fails; each UI consumer still needs its own error handling.
- The existing layout's explicit-selection link includes the canonical subject ID.
  This is necessary for saved-artifact views now that their comparison flag is
  available; otherwise their new selection link would keep the no-write fallback.
- The existing setters used by Settings, approved claims and other deliberate
  actions remain unchanged. No membership/role checks, grants or schema change.

## Precedence / no-write decision table

| Input | Research subject | Preference write | Returned preference |
|---|---|---|---|
| Invalid/unresolved explicit ID | unavailable; return error | never | unknown |
| Valid URL, no saved preference | URL subject | never | null |
| Valid URL, saved A, research B | B | never | A |
| Valid URL matches saved A | A | never | A |
| Artifact or transient Ask | explicit subject | never | current stored ID or null |
| Explicit selection, writes allowed | selected subject | after subject validation | ID only after successful save |
| Explicit selection, writes forbidden | explicit subject | never | current stored ID or null |
| Preference read fails | explicit subject if resolved | never | omitted plus error |
| Explicit save fails | explicit subject if resolved | attempted, failed | omitted plus error |
| No explicit subject, saved A | A if resolvable | never | A |
| Neither subject nor preference | unavailable | never | null |

## Inspected context flow and remaining boundaries

| Layer / entry point | Observed responsibility | This patch / remaining work |
|---|---|---|
| `pro/(hamilton)/layout.tsx` | Auth gate; URL/artifact selection; `setBank=1` preference action; context shell | Fix explicit link ID; no full chrome or error-state redesign |
| `workspace-context.ts` | Research subject and saved preference | Read-only browsing, honest errors, additive preference ID |
| `ask-service.ts` | Transient resolution, subject-scoped research/memory, answer saving | Can receive preference ID; still must propagate distinct account/subject through actual answers |
| `api/hamilton/ask/market/route.ts` | Transient resolution and local-market answer | Existing consumer; no peer or presentation changes here |
| `request-contract.ts` | Shared audience/subject/evidence request boundary | Unchanged; browser-supplied workspace context is not authority |
| `institution-membership.ts` | Separate active membership/role reads | Unchanged; no preference-to-membership inference |
| `AnalyzeWorkspace.tsx` | Answer rendering and hardcoded 'Your institution' audit label | Not fixed by this resolver patch; H01-T05 remains open |
| Saved answers and exports | Historical subject, peer and evidence context | H01-T04/T06 acceptance remains open |

This is a partial flow map, not completion of H01-T01's full route/export inventory.
An active peer-set identifier and the authorized account identity still need to be
combined with research context at the proper server boundary, aligned with H06-T02.

## Verification

The resolver test file now contains 24 cases: invalid/unresolved subject, first
visit, saved/same/different preference, explicit selection, no-write precedence,
transient Ask, artifacts, source labels, read/write failures, fallback/legacy rows
and a multi-visit sequence proving only the explicit choice writes storage.

Local: exact original resolver, context-source helper and layout bytes were checked
against their Git blob SHAs before editing. All 24 resolver cases passed under an
isolated assertion/mock adapter that executes the actual TypeScript test file and
transpiled resolver. This adapter is NOT Vitest, not a real database and not a full
application run. The old resolver passes 3 and fails 21 of the new assertions;
some failures are the new metadata contract, not 21 independent production bugs.
Strict isolated resolver compilation also passes with explicit declarations for
its external database/institution boundaries (not full app typechecking).

Repository Vitest, typecheck, lint, guards and pipeline tests must be checked on the
PR head in GitHub CI. Authenticated desktop/mobile, explicit-selection error UX,
artifact-link and export checks remain outstanding; their status belongs in the PR
and #976. No paid model call or production database read/write was used locally.

## Remaining release blockers / non-goals

Do not close H01, mark its acceptance cases passed, or call this a fix for every
'your institution' answer. H01-T04/T05/T06/T07/T08/T10 remain unaccepted. The legacy
explicit preference action is still URL-based; reviewing/moving that mutation to an
authenticated POST action and surfacing save failures in chrome remain follow-up
work. Existing erroneous saved preferences are not automatically rewritten.

No fee data, migrations, membership permissions, provider prompts or production
settings change. No merge/deployment authorization is implied. Keep independent
of #974 (confidence containment) and #939 (broader design work).
