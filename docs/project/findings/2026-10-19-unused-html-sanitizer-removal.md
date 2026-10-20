# Remove unused sanitizer dependencies while preserving the active parser

Issue: #2182, Foundation #1048. Code/data-only dependency maintenance.

The root declared `sanitize-html` 2.17.1 and `@types/sanitize-html` 2.16.1 without
source, script, test or configuration consumers. Installing a sanitizer does not
establish a sanitization boundary. The three sanitizer advisory records are one
moderate production package entry; no application invocation or deployed XSS path
was established. Maintainer advisories cover
[URI-bearing attributes](https://github.com/apostrophecms/apostrophe/security/advisories/GHSA-vccv-cmxp-4j9h),
[SVG animation URL lists](https://github.com/apostrophecms/apostrophe/security/advisories/GHSA-g8qq-57p8-ggw5)
and [malformed textarea closes](https://github.com/apostrophecms/apostrophe/security/advisories/GHSA-jxwj-j7wr-gfrw).

## Bounded removal

Remove the two unused declarations and only these six unreachable lock entries:

| Entry | Previous parent |
| --- | --- |
| `sanitize-html` 2.17.1 | Root dependency |
| `@types/sanitize-html` 2.16.1 | Root development dependency |
| Its nested `htmlparser2` 10.1.0 | `@types/sanitize-html` |
| Its nested `entities` 7.0.1 | The nested parser |
| `is-plain-object` 5.0.0 | `sanitize-html` |
| `parse-srcset` 1.0.2 | `sanitize-html` |

No dependency is added or upgraded. npm derives `dev: true` for retained
`deepmerge` 4.3.1 and `escape-string-regexp` 4.0.0 because their sole production
parent disappears and their remaining parents are development tools. These are
the only retained-object changes; versions, resolution, integrity, dependencies
and all other fields remain identical. Reachability checks retain those shared
packages and establish that precisely the six removed entries become unreachable.

The direct **htmlparser2 8.0.2** remains necessary: Rosetta HTML DOM normalization,
JavaScript fallbacks, regulatory state enforcement and uploaded-table XML import
it. All four callers still resolve to the same package; all 36 installed parser
files remain byte-identical. The seven installed browser-mapping backport files,
its immutable archive and lock resolution also remain byte-identical. No
application, parser, sanitization configuration, model, prompt or provider setting
changes.

## Meaningful compatibility guards

**Guard:** Existing `src/lib/agents/rosetta/html-dom.test.ts`,
`src/lib/agents/rosetta/js-fallback.test.ts`,
`src/lib/agents/rosetta/table-rows.test.ts`,
`src/lib/regulatory/state-enforcement.test.ts` and
`src/lib/agents/magellan/registry/state-enforcement.test.ts` preserve table/cell
pairing, entities, embedded/fallback data and regulatory row/link selection using
in-memory fixtures. Existing `src/lib/hamilton/uploads/uploads.test.ts`,
`src/lib/hamilton/uploads/parse-bounds.test.ts` and
`src/lib/hamilton/uploads/service.test.ts` cover legitimate zero/cached/inline/shared
values, sparse/ZIP/XML/CSV bounds, malformed input rejection and failure before
preview persistence. The browser backport and actual source-map/PostCSS suites
also remain unchanged. These ten suites pass 171 tests before and after removal;
no test merely asserting package deletion was added.

Clean repeated installs, production-only reachability, exact installed-file
comparisons, the current 20 SQL suites, full/agentic/static checks and isolated
production build/14 canonical routes are recorded in the exact-head release
receipt and required CI. Tests use injected effects or owned loopback fixtures;
no browser, bank, provider, storage or production-data/settings actions are needed.

## Audit result and remaining scope

Fresh full npm audit entries fall **34 → 33** and production entries **3 → 2**.
Only the `sanitize-html` entry disappears; every retained advisory object is
identical. These are package-entry counts, not demonstrated exploit counts.
The active raw Anthropic Messages SDK remains separate from its unused affected
filesystem-memory helper. The original browser-mapping version remains honestly
flagged after its independently guarded behavior backport. Development dependency
families, application response-memory budgets and broader egress applicability
remain separate work. This removal neither introduces an HTML sanitization policy
nor establishes whole-application security completion.
