# Compatible schema, cache and filesystem tooling safety

2026-10-19. Foundation #1048, scoped outcome #2188.

The development toolchain resolved vulnerable URI normalization, cyclic cache parsing
and filesystem copying dependencies. This outcome updates their compatible minimum
patched versions while preserving root declarations, configuration, application code
and all other dependency objects/text.

| Dependency | Before | After | Retained parent range |
| --- | --- | --- | --- |
| fast-uri | 3.1.0 | 3.1.8 | Ajv8.20.0: ^3.0.1 |
| flatted | 3.3.3 | 3.4.2 | flat-cache4.0.1: ^3.2.9 |
| @humanfs/node | 0.16.7 | 0.16.8 | ESLint9.39.2: ^0.16.6 |
| @humanfs/core | 0.19.1 | 0.19.2 | Required by node0.16.8: ^0.19.2 |
| @humanfs/types | absent | 0.15.0 | Required by the compatible node/core chain |

Exactly four existing lock nodes change and one required types node is added; none
is removed. The new humanfs chain retains Node>=18.18.0. Latest humanfs0.17 requires
Node24, and latest fast-uri4 is a different major; neither is introduced. Flatted3.4.2
is sufficient: its actual CJS and ESM parser files match assessed3.4.4 byte-for-byte.
No override, lifecycle hook, unused-CLI removal, new runtime or service is involved.
The browser backport archive, XML chain, SDKs and every other lock object remain intact.

## Primary evidence and precise behavior

[Fast-uri's3.1.8 release](https://github.com/fastify/fast-uri/releases/tag/v3.1.8)
names the [encoded-host case advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj).
The old actual parser returns uppercase `A.com` for scheme-relative `//%41.com`;
the target consistently returns `a.com`. Ordinary URI parsing/serialization,
numeric-zero query text, IPv6 and relative reference controls pass. The old3.1.0
`equal()` already returns true for this case; no failing old equality result is claimed.
Security normalization changes are intentional, not an assertion that all malformed
input produces identical output.

[Flatted's maintainer advisory](https://github.com/WebReflection/flatted/security/advisories/GHSA-rf6f-7fwh-wjgh)
and [fix](https://github.com/WebReflection/flatted/commit/885ddcc) describe inherited-array
references. Actual old CJS/ESM parsing returns live Array.prototype for a crafted
non-index reference. The target returns no such reference; tests never mutate the
global prototype. Its iterative parser also handles a bounded6,000-node reference
chain that raises RangeError in the old package. Cyclic/shared identity, zero, Unicode,
reviver and replacer controls remain usable. This is not an arbitrary-input memory cap.

[Humanfs's advisory](https://github.com/humanwhocodes/humanfs/security/advisories/GHSA-p498-v437-472g)
still lists patched versions as None; reviewed registry/advisory metadata identifies
0.16.8. We verified actual distributed source and the
[maintainer22bbaa4 patch](https://github.com/humanwhocodes/humanfs/commit/22bbaa4), rather
than claiming the stale advisory or type-focused release note alone proves a fix.
Target copy/copyAll preserves symbolic links instead of materializing their targets'
bytes as regular files. Opening a copied link can still follow outside. This is
**not a filesystem sandbox**, exclusion of external links, or proof against every race.
The test demonstrates that limitation explicitly using only an owned synthetic marker.
Ordinary nested zero content, overwrite, directory detection and walking remain usable.

Official archive SHA-512 integrity is checked before inspection. All installed files
match those archives: fast-uri44, flatted15, humanfs-node8, core12 and types5 files.
Source/registry snapshots, exact semantic/text lock comparison and byte receipts are
preserved with the outcome's local evidence.

## Actual consumer and regression boundaries

Current application imports Ajv only in API/OpenAPI tests. No application imports of
these three leaves were found. ESLint file enumeration uses humanfs directory/walk;
no copy/copyAll invocation was found there. Its cache chain is
ESLint→file-entry-cache→flat-cache→flatted. This is development/build/test maintenance,
not a demonstrated public-request exploit. Top-level tools remain present and unchanged.

Seven intended safety failures and seven passing ordinary/parent controls were captured
against the installed old packages before updating the lock. The patched tree passes
all14. Tests load URI and cache leaves through the actual unchanged consumers' CJS
resolution. Humanfs has import-only exports, so its native ESM resolution starts at
the actual ESLint helper parent. Recorded installed paths/versions all belong to this
owned worktree, not primary or an earlier installation.

The real parent tests validate Ajv references/zero/type/minimum, cyclic/shared/zero
flat-cache persistence and identical cold/cached ESLint glob diagnostics. The small
ESLint fixture supplies an explicit owned configuration; actual project configuration
is checked by the full lint/build gates. Global fetch tripwires have no network fallback.

**Guard:** `src/lib/tooling-dependency-security.test.ts` exercises actual URI normalization,
flatted CJS/ESM safety/compatibility, humanfs link copying and real Ajv/cache/ESLint consumers.
The two existing API/OpenAPI contract suites verify application Ajv consumers. Those
plus browser-backport, source-map/PostCSS and raw-SDK guards pass131 tests in seven suites
with zero skips. Root manifest bytes, project configuration and application source do
not change; TypeScript and targeted lint pass without fixture changes elsewhere.

## Residuals and release evidence

Fresh app-lock audit entries measure **32→29 full /1→1 production**. Only fast-uri,
flatted and humanfs-node disappear; every retained advisory object is structurally
identical, with no additions. Package entries are not unique application exploit counts.
The production entry remains the truthful baseline-browser version flag after its
reviewed behavior backport. Larger Vitest/shadcn/Browserslist families, other development
advisories, application response-memory budgets and broader egress gaps remain separate.

Frozen-head release receipts include clean/repeated installs, installed source/parent
resolution, audit comparisons, all current21 SQL suites on an owned loopback production
schema, full/agentic/static gates, isolated production build and14 canonical routes,
independent review and required CI. No browser, bank/provider/storage request, production
data, settings or migration action is part of this outcome.
