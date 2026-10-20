# Browser-target mapping option errors must remain catchable

Issue: #2178, Foundation #1048. Code/data-only dependency maintenance; no
request-controlled use or deployed exploit was established.

The installed `baseline-browser-mapping` 2.9.19 is reached through the existing
Next and browserslist dependency ranges. Its CJS and ESM distributions call
`process.exit(1)` for conflicting year/date options and an invalid KaiOS/downstream
combination. Catching an imported API error cannot keep that process alive.
[CVE-2026-45819 / GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv)
and [maintainer PR 137](https://github.com/web-platform-dx/baseline-browser-mapping/pull/137)
describe the upstream change.

## Why the published upgrade was rejected

The first candidate, 2.11.0, substantially changes compressed browser data and
timeline selection as well as fixing the termination behavior. Actual CJS and ESM
checks on 2.11.0, 2.11.1 and registry-latest 2.11.29 reproduce retained downstream
minima after later core-browser bumps. A 2024 selection returns QQ/Blink 121,
UC/Blink 123 and KaiOS/Gecko 123 against core Chrome 130 and Firefox 132. Those
downstream release records remain labeled 2023. The runtime retains earlier
downstream minima when the later timeline omits them instead of removing them.
The package's documented downstream-engine relationship fails; its red control
was retained instead of accepting those tuples. This is not a claim that every
intermediate release was tested.

All seven recorded ordinary API scenarios also differ under the published
upgrade: dates, data and downstream/year fields change even where core
browser/version tuples agree. Exact project production targets remain Chrome 111,
Edge 111, Firefox 111 and Safari 16.4, but that alone does not justify the incorrect
downstream selection. Upstream 2.11 also changes one invalid-option warning mode:
`getCompatibleVersions` can return the seven core browsers when warnings are
suppressed. The backport deliberately preserves original 2.9.19 validation in
both warning modes.

## Bounded backport and provenance

The checked-in archive keeps the truthful original version 2.9.19 and original
Apache-2.0 license and attribution. Each of its two distribution files has exactly
two literal replacements, throwing the original specific `Error` in place of the
logging/termination sequence, plus a dated modification notice. Original browser
data, validation placement, CLI, types, package metadata and README are preserved.
All five other package files are byte-identical. There is no override, lifecycle
hook, new dependency, application change or configuration change.

`vendor/baseline-browser-mapping/provenance.json` contains the original registry
URL/SRI, exact source replacements, all original/final file hashes and final
archive SRI. Its README contains executable reconstruction instructions; a fresh
download verified against the original SRI reproduced the archive exactly with
the recorded Node/npm toolchain. The existing lock node resolves the immutable
local archive, accepted by both existing dependency parents. Regenerating the lock
can discard this resolution, so installed-byte and parent-resolution guards are
part of the regression suite.

**Guard:** `src/lib/baseline-browser-security.test.ts` checks the actual installed
CJS and ESM exports in bounded child processes for all three conflicts with both
warning settings, then verifies a normal alive marker. It pins UTC and the
2026-10-19 clock for complete original-output hashes across seven API scenarios
per export; it also checks historical mappings, Blink/Gecko engine minima, actual
Next/browserslist resolution, all installed file hashes, archive SRI, exact project
production targets and the real bundled CLI. The original installed baseline had
six failing catch/alive controls and seven passing ordinary controls before the
additional warning-mode and provenance checks; the final suite passes 35 tests.
The expanded twelve-conflict matrix was also rerun directly against the
integrity-verified original exports: all twelve exited before catch/alive markers.
The CLI's fixed-year ordinary output is unchanged and invalid options still exit
1; invalid-error stdout/stderr is not claimed identical.

## Validation and limits

Fresh full and production npm audits remain **34** and **3** package entries,
respectively, with every advisory object unchanged. The original version remains
flagged by version-based auditing despite the behavioral backport. There is no
audit suppression or scanner-clear claim. Raw Anthropic SDK filesystem-helper
applicability and the verified-unused sanitizer dependency remain separate work;
development-only dependency entries also remain.

Clean installs, repeated installs with scripts disabled, actual PostCSS and Next
production-build compatibility, static/agentic/full checks and the current shared
SQL inventory are recorded in the exact-head release receipt and CI. Browser/UI,
provider/storage requests, production data/settings, credentials and migrations
are outside this outcome. This backport does not provide an application-input
sandbox or change browser support policy. A future upstream release must pass the
retained compatibility controls before replacing the local artifact.
