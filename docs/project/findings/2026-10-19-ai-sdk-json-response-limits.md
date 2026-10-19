# AI SDK JSON response-reader patch

Issue: [#2164](https://github.com/Gilmore3088/FeeInsight.com/issues/2164), under Foundation #1048.

## Scope and remaining application budget

The patched JSON handlers use an upstream **2 GiB** response-body limit. This is a
finite library safeguard, not an application-sized memory budget. The handlers do
not expose a smaller per-call limit here; JSON parsing and intermediate byte/text
copies can still consume substantial memory below that threshold. A smaller,
application-specific provider-response budget remains separate work. This change
does not add a total SSE stream budget or prove protection against every memory
exhaustion path.

The installed `@ai-sdk/provider-utils@4.0.19` success-JSON, error-JSON and status-error
handlers read `response.text()` without using the shared size-limited reader. The
[maintainer fix #16374](https://github.com/vercel/ai/pull/16374), backported to the
v6 line in [#16449](https://github.com/vercel/ai/pull/16449), routes those handlers
through `readResponseWithSizeLimit`. One underlying advisory,
[GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8), appeared as
five affected npm package entries in this repository. Those entries are not five
independent exploits. No attacker-controlled provider endpoint or production
exploit has been established by this review.

## Compatible dependency closure

The 2026-10-19 registry and installed-source snapshots select exact direct versions
within the existing ranges and current major lines:

| Direct dependency | Before | After |
| --- | --- | --- |
| `ai` | `6.0.116` | `6.0.214` |
| `@ai-sdk/react` | `3.0.118` | `3.0.216` |
| `@ai-sdk/anthropic` | `3.0.58` | `3.0.89` |

Their coordinated dependency closure installs `@ai-sdk/provider-utils@4.0.33`,
`@ai-sdk/provider@3.0.12`, `@ai-sdk/gateway@3.0.139`, `@vercel/oidc@3.2.0` and
`eventsource-parser@3.1.1`. The OIDC version is the gateway package's exact child;
the event parser satisfies the updated provider-utils range. Every other lock
entry is unchanged. Existing Node, React and Zod versions satisfy the selected
packages' declared compatibility ranges.

The gateway package was already an `ai` dependency. Updating its locked version
does not activate it or migrate provider traffic. `src/lib/ai-provider.ts`, provider
selection, models, prompts, usage/circuit controls and all application runtime
source remain unchanged. The separately imported `@anthropic-ai/sdk` and other
dependency families retain their existing versions.

## Local verification

The actual installed library is exercised with synthetic in-memory response bodies,
without provider calls or giant allocations. Three header-only regressions set
`Content-Length` to 2 GiB plus one byte on a tiny stream. Before the patch, each
handler consumes the stream and the expected size rejection fails; eleven ordinary
controls pass. After the patch, all fourteen tests pass: each over-limit handler
rejects before pulling the body, cancels it and releases its reader. Additional
tests cover success/error metadata, malformed and empty bodies, source aborts,
inclusive limits, and a missing-length stream exceeding a tiny configurable
reader limit. That configurable reader test is distinct from the handlers'
unchanged 2 GiB default.

Five compatibility cases use the real SDK with injected fetch responses or its
version-matched mock model: Anthropic JSON and chunked SSE through the unchanged
application factory; token-usage ledger counts; schema-validated zero amounts;
tool execution and follow-up messages; and the actual React chat state/stream
transport. These fixtures never invoke a live provider or database.

Separate clean installs verify the original and patched lockfiles. The full npm
audit changes from 43 package entries (0 critical, 26 high, 10 moderate, 7 low) to
38 (0 critical, 26 high, 10 moderate, 2 low). The production audit changes from
12 entries (0 critical, 2 high, 5 moderate, 5 low) to 7 (0 critical, 2 high,
5 moderate, 0 low). Only the five AI SDK family entries disappear; all other
advisory objects are identical in these snapshots. Remaining advisories and the
smaller application response-budget gap are not resolved by this patch.

Exact-head receipts record repository gates and an isolated production build.
No production data, schema, permission setting, provider activation or browser
session is changed or exercised.
