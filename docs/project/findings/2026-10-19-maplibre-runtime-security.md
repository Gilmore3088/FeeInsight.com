# City map runtime needed a patched MapLibre release

Issue: [#2141](https://github.com/Gilmore3088/FeeInsight.com/issues/2141), the F14 dependency residual after the separate Next update #2114. The lock resolved MapLibre 5.24.0. The [maintainer advisory](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579) covers versions through 6.4.0, with the first fix in 6.4.1. This is an affected dependency and reachable sanitizer boundary, not evidence of a production exploit.

The city branch map loads a fixed external OpenFreeMap style and creates an AttributionControl. Third-party source attribution therefore reaches the affected sanitizer. Customers cannot select arbitrary styles through this component. Its institution popups already use DOM elements and `textContent`; they do not pass bank names to `setHTML`.

The package is now pinned and locked to **6.15.0**, the maintained release confirmed from the npm registry and [maintainer release](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.15.0) on 2026-10-19. Only MapLibre and its dependency subtree changed in the lock: vector-tile, style-spec, unitbezier, bidi-js and protobuf resolution/hoisting; unused whoots-js was removed. No other dependency family is upgraded by this change.

## Compatibility changes and owner reconciliation

The [6.15.0 migration guide](https://github.com/maplibre/maplibre-gl-js/blob/v6.15.0/docs/guides/v5-to-v6-migration-guide.md) documents ESM-only exports and bundler worker setup. The existing namespace import and client-only dynamic map remain compatible. The necessary application changes are:

- Configure `setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString())`. The [tagged installation guide](https://github.com/maplibre/maplibre-gl-js/blob/v6.15.0/docs/index.md#installation) documents this Next 15+ pattern. Next 16 emits the installed worker as a same-origin, hashed asset. The actual 6.15.0 worker is self-contained; the produced module has no static imports. No CDN worker, manual vendored copy, lifecycle copy script or security-header change is needed.
- Probe WebGL2, which v6 requires. Missing support goes to the existing branch-list fallback.
- Type the paint helper's property and value from `Map.setPaintProperty` parameters; v6's stricter declarations reject the old `string`/`unknown` helper. Paint values, branch records and restyling behavior are unchanged.

The fixed style, bounds, layers, cooperative gestures, required OpenFreeMap/OpenMapTiles/OpenStreetMap credit, safe popup construction and list fallback are preserved. MapLibre's changed overzoom behavior does not change a numerical product output here: source-feature queries only test whether street/boundary features exist.

Open explorer PR [#1780](https://github.com/Gilmore3088/FeeInsight.com/pull/1780), reviewed at `e1a55cfff81c15ac363e3bae1583487dc0bdea76`, changes the separate state-city-map/explorer and city-name read paths. Its full body and changed-path inventory were read: it changes neither dependency manifest nor branch-map-gl, and excludes city-page redesign. Its noted local MapLibre type warning is relevant context; the setter narrowing above resolves the actual new-version type error in this branch. This PR does not absorb its redesign or assert acceptance of its unpublished head.

## Verification and limits

The installed library's public AttributionControl is exercised in synthetic DOM tests, without starting a browser or requesting a style. Consecutive event attributes and script-scheme/foreign markup are removed while independent legitimate source credits remain. A separate safe before-fix probe of the registry's 5.24.0 package retained `onmouseover` from the identical three-attribute anchor; no sentinel code was executed. This demonstrates the sanitizer regression without a live exploit request.

City/geo tests cover the used runtime methods and module/CSS assets, actual component configuration with an injected map, branch GeoJSON, literal popup text, map construction/style/street failures, timeout/unmount cleanup, WebGL2 refusal and the complete plain-list fallback including unplaced branches. These tests distinguish the actual library sanitizer/control from the injected map used to avoid WebGL.

The production build runs against an owned loopback-only TLS PostgreSQL fixture using the repository schema snapshot, with no production credentials. Static-asset HTTP checks on that built server verify that the worker is served with JavaScript MIME and bytes identical to the installed 6.15.0 worker, that the city client chunk references its emitted asset, and that MapLibre attribution/popup CSS is bundled and served. The module parses successfully with no static dependency. The build's existing 14 canonical admin-route checks also run.

A dated production dependency scan changes from **13 to 12 affected package entries**, with critical entries **1 to 0** and no remaining MapLibre advisory. The other 12 entries remain: these are package counts, not counts of exploitable application paths. Full dependency hygiene, source egress #2136, legacy-password migration and health exception disclosure remain separate work.

No browser, real WebGL context, live tile/style request, screenshot or visual acceptance was performed or is claimed under the authorized code-and-data-only scope. The tests and build do not certify GPU/device behavior, tile rendering, keyboard/visual presentation or live provider availability. No application migration, production database mutation, paid provider, production exploit request or permission/security-setting change occurred. Exact-head local gate and independent review/CI receipts accompany the PR.

**Guard:** `src/lib/geo/maplibre-runtime.test.ts:24` (the installed MapLibre attribution control strips consecutive dangerous attributes, which the 5.24.0 sanitizer kept)
