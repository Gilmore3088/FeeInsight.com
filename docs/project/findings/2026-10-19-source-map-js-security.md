# Source-map indexed-map resource amplification

2026-10-19 · Foundation #2175 · code/data audit dependency residual

The lock installed source-map-js 1.2.1 through PostCSS 8.5.23 (`^1.2.1`) in
the Next/Tailwind build toolchain. The maintainer's
[patch](https://github.com/7rulnik/source-map-js/pull/79) and
[1.2.2 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
address [GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Crafted indexed maps could amplify CPU/memory work through huge section line
offsets, repeated nested `sources` getters, per-line serialization ropes, and
padding after the real generated code ended.

The actual dependency path is build tooling. A literal import/use inventory of
application source, scripts and tests found no existing source-map-js consumer
or request-controlled map path. This finding establishes the vulnerable package
and its build dependency, not an exposed HTTP input or a deployed exploit.

The change replaces only the source-map-js lock node with verified registry
1.2.2. PostCSS's existing range accepts it; the leaf adds no dependencies and
retains its Node engine and license. Package declarations, framework, PostCSS,
configuration, application runtime and unrelated lock nodes stay the same.

**Guard:** `src/lib/source-map-js-security.test.ts` uses the installed library
exports and real PostCSS. Final fixtures fail 23 cases on a clean 1.2.1 install
while five normal controls pass; all 28 pass on a clean 1.2.2 install. Invalid
line/column types and integers, an over-limit line offset, and nested summed
offsets are checked in the constructor before any mapping expansion. A six-level
fixture counts actual getter reads without timing assertions. A 12-line offset
proves code exhaustion stops padding and preserves source contents. Ordinary
positions/names, code round trips, small serialized line gaps, valid boundary
offset lookup and PostCSS previous-map provenance remain compatible. Large
offset checks do not serialize their mappings. The maintainer's flat-string
gap rewrite is reviewed directly; no giant allocation or exhaustion probe runs.

Clean before/after full audits report 35 → 34 package entries and production-only
audits 4 → 3. Exactly source-map-js disappears; every remaining advisory object
is byte-equivalent as parsed JSON. These are package entries, not independent
exploit counts. Three moderate production entries remain: raw Anthropic SDK,
sanitize-html and baseline-browser-mapping; their feature applicability remains
separate work. External audit, install, initial failing-regression and local
validation receipts are retained with the audit evidence.

The upstream line-offset ceiling is 10,000,000, including summed nested section
offsets. Valid maps can still require output-sized memory, and arbitrary nesting,
map size or application response budgets are not newly sandboxed. The positive
gap test checks correct small output, not a heap guarantee. No provider/storage
request, production data/settings change, migration or browser action is part
of this outcome. Required repository checks, isolated production build, exact
head independent review and CI remain release gates.
