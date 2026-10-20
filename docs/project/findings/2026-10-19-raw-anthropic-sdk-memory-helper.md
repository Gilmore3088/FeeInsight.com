# Raw SDK memory-helper safety, with Messages behavior preserved

2026-10-19. Foundation #1048, scoped outcome #2185.

The installed raw `@anthropic-ai/sdk` 0.80.0 contained two optional local filesystem
memory-helper defects: [sibling-prefix path validation](https://github.com/anthropics/anthropic-sdk-typescript/security/advisories/GHSA-5474-4w2j-mq4c)
(patched in 0.81.0) and [default file permissions](https://github.com/anthropics/anthropic-sdk-typescript/security/advisories/GHSA-p7fg-763f-g4gf)
(patched in 0.91.1). The minimum common published target is 0.91.1. Both official npm
archives were checked against registry SHA-512 integrity before comparing their actual
distributed CJS, ESM and TypeScript source. Version-tag URLs returned 404; they are not
used as release evidence.

Current application code imports the raw SDK through `src/lib/ai-provider.ts` and uses
ordinary non-streaming Messages in paid passes, Hamilton generation/memo/simulation,
report editing and guide drafting. It never imports or constructs
`BetaLocalFilesystemMemoryTool`. These advisories therefore do not establish a deployed
application filesystem escape. App streaming uses the separate AI SDK adapter.

## Bounded dependency change

The direct declaration changes from `^0.80.0` to exact `0.91.1`; the target is outside
the former 0.x range. Only the SDK's lock version, resolved URL and integrity change.
No nodes are added or removed, and every other retained dependency object is identical.
The direct dependency `json-schema-to-ts ^3.1.1`, optional zod peer, license and exports
remain unchanged. Unrelated npm formatting changes were restored from the original lock.
All 941 installed package files match the integrity-verified target archive. The
immutable baseline backport resolution/archive, XML chain and AI SDK adapters stay intact.

No application runtime, provider factory, key selection, model, prompt, sampling,
budget/accounting code or settings change. The target adds error `.type`, required
`Message.stop_details` types and beta event types, and corrects a model-warning lookup.
Existing project TypeScript and caller tests pass without fixture or runtime changes.
This is a dependency maintenance outcome, not a provider architecture migration.

## Reproduced behavior and guards

The actual installed old package produced six intended failures and 26 passing controls:
sibling-prefix read/write boundaries, sibling symlink boundaries and private creation/
atomic replacement modes, each through CJS and ESM. An initial test-harness mistake
matched an Error's inherited constructor using an object matcher; it was corrected
before the six-failure baseline was recorded. The patched package passes all 32 controls.
Disposable synthetic sibling files are the only filesystem targets. Permissive umask
000 runs only inside owned child processes, which verify new files 0600 and directories
0700, including replacement and rename, alongside ordinary create/view/delete behavior.
This does not repair already permissive files or prove a universal filesystem sandbox
or absence of every symlink race.

Actual injected-only Messages tests preserve request body/API version, response text,
tool input zero, cache/search usage, response status/request ID, eight error classes,
timeout/retry defaults, pre-request cancellation and cancellation of stalled fetches.
Canonical raw SSE iteration remains usable as an adjacent library control; it is not
an active raw streaming application path. Global fetch tripwires have no network
fallback, and all keys/base URLs are explicit test fixtures.

The separate integration suite uses the unchanged application factory and real paid
guard/accounting wrapper. It verifies own/shared key selection, configured model,
successful token/cache/search pricing and run accounting, actual SDK billing-error
recording/credit stop, and automation/circuit/budget denial before any fetch. Database
and control seams are mocked; no provider, bank or storage request occurs.

**Guard:** `src/lib/anthropic-sdk-security.test.ts` exercises actual installed CJS/ESM
helper safety and Messages/error/cancellation/SSE contracts. `src/lib/anthropic-sdk-integration.test.ts`
exercises the actual shared factory, paid path and accounting with injected transport.
Existing `ai-provider.test.ts`, `ai-provider-usage.test.ts`, `automation-control.test.ts`,
`agents/paid-pass.test.ts`, Hamilton/report/guide caller suites and the broad release
checks cover unchanged consumers. The ten focused suites pass 126 tests with zero skips.

## Measured residuals and release boundary

Fresh app-lock audits measure full package entries 33→32 and production 2→1. Only
`@anthropic-ai/sdk` disappears; every retained advisory object is structurally identical,
with no additions. Advisory package entries are not counts of unique application exploits.
The remaining production entry is the truthfully versioned baseline-browser behavior
backport. Development dependency families, application-sized response-memory budgets and
broader egress applicability remain separate work. This SDK patch does not add a response
size budget, fix every dependency warning or certify pipeline data accuracy.

Release evidence is recorded against the frozen commit: clean/repeated installs,
source/lock/audit comparisons, current 21-suite SQL inventory on an owned loopback
production-schema fixture, full unit/agentic/static gates, isolated production build
and canonical routes, independent review and required CI. No migrations, production
data, credentials, provider activation or browser actions are part of this outcome.
