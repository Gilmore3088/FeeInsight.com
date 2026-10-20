# Patch the Next runtime without hiding remaining security work

Issue #2110, under Foundation #1048. Main pinned Next and its ESLint configuration to 16.1.6. Maintainer advisories cover App Router/proxy bypass and resource exhaustion; conditional native-image/cache vulnerabilities also require newer patched dependencies. The October 14 advisories are absent from the original npm audit's Next list, so its advisory ranges alone are not a complete patch floor.

The focused patch pins Next and eslint-config-next to 16.4.2. The lock resolves sharp 0.35.5 and PostCSS 8.5.23, with matching Next SWC packages. React stays 19.2.3. No application source, authentication design, provider control or database migration changes.

Official evidence:
- [Next 16.4.2 release](https://github.com/vercel/next.js/releases/tag/v16.4.2).
- [App Router transport/proxy advisory](https://github.com/vercel/next.js/security/advisories/GHSA-267c-6grr-h53f).
- [October cache advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr).
- [October native-image advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).

An affected package version does not prove each exploit is reachable. The app does not enable Cache Components; Windows-only conditions do not describe Vercel's Linux deployment. No production exploit request was made.

## Lint compatibility remains visible

The required Hooks analyzer changes from 7.0.1 to 7.1.1. Both old and new configurations enable the same compiler rule families at error, but the newer analyzer emits 40 diagnostics on ten unchanged files where the old analyzer emitted none. This establishes a detection change, not that all findings are false positives or repaired.

The configuration keeps these known file/rule combinations at warning for gradual adoption; all other files/rules retain their defaults. `rules-of-hooks` remains error and `exhaustive-deps` remains warning. No source directory is ignored and CI runs the same lint command. [React documents gradual handling of compiler diagnostics](https://react.dev/reference/eslint-plugin-react-hooks).

| Existing component | Diagnostic baseline | Owning area |
| --- | --- | --- |
| City market-table | 1 set-state-in-effect | Public pages |
| atlas-live-status | 1 set-state-in-effect | Operator UI |
| magellan-console | 1 set-state-in-effect | Operator UI |
| InstitutionPicker | 2 set-state-in-effect | Hamilton |
| AnalyzeWorkspace | 23 preserve-manual-memoization, 5 refs, 2 immutability | Hamilton |
| PeerAwareStructuredAsk | 1 set-state-in-effect | Hamilton |
| StructuredAsk | 1 refs | Hamilton |
| WatchlistPanel | 1 set-state-in-effect | Hamilton |
| ReportWorkspace | 1 set-state-in-effect | Hamilton |
| search-modal | 1 set-state-in-effect | Public pages |

These 40 diagnostics remain work to assess in their owning components. Remove each scoped warning exception as that area is repaired; the security patch does not claim to resolve them. It does not expand compiler adoption or rewrite unrelated active UI work.

## Verification and residual risk

A clean install and production build against the CI schema in a disposable loopback PostgreSQL database pass, including 14 canonical admin route checks. A built-server HTTP exercise uses synthetic active and inactive users: normal and RSC/prefetch requests preserve operator denial/allow behavior, safe login returns, public directory rendering and image optimization (27 checks). RSC transport normalization is followed only on the same local origin. No browser/visual review or authenticated production test is claimed.

The local full suite passes 12,362 tests; the agentic suite passes 1,606. Typecheck and legacy guards pass. The final lint result retains 37 existing warnings plus 40 newly visible analyzer warnings; no warning-free claim is made.

The dated dependency scan falls from 49 to 45 total package entries and 17 to 13 production entries; no Next advisory remains in that scan. These are package counts, not independent exploit counts. MapLibre's major upgrade, other runtime packages and development tooling remain separate security work. Login throttling, inactive API-key checks, XLSX bounds, safe fetching, legacy-password rehash and safe health errors also remain open.

**Guard:** `src/lib/next-version-floor.test.ts:29` (`next` and `eslint-config-next` pinned at or above 16.4.2; `:34` the lockfile resolves `next` and its Linux SWC binary at or above it)
