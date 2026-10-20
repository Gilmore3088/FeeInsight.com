# 2026-10-19: signed-in institution profiles failed when their financial charts loaded

**What happened:** James saw institution profiles load, then switch to “Something went
wrong.” Reproduced in his signed-in Chrome session on `/institution/281` at 17:58 UTC.
The browser logged React error 441. The matching production POST logged `Could not find
the module "[project]/src/app/(public)/institution/[id]/financial-profile.tsx#FinancialProfileCharts"
in the React Client Manifest` (digest `1927529991`). The same error appeared on several
institutions and deployments. Clean signed-out visits to 82 and 281 remained usable during
the check; production also has separate read-deadline failures under database load.

**Cause:** The ISR change moved the session-specific financial section into a server
action. That action returned a React tree containing a client chart component that was
reachable only through the action. The route's client manifest omitted the chart reference.
After hydration, a Pro visitor's action result introduced that unresolved reference and
the page's error boundary replaced the otherwise working public profile. A successful
initial GET or a signed-out visit did not exercise this path.

**Fix:** #2319: keep the premium check and reads on the server, return financial data,
and render the section through an explicit, lazy client import. Keep SQL imports out of
that presentation graph. Public profiles remain cached and Pro data remains session gated.

**Lesson:** A post-hydration server action returning UI must be tested through the built
client/server boundary. Unit tests that replace the returned component can conceal a
missing client-manifest entry. Returning data makes ownership of client rendering explicit.

**Guard:** Viewer-action tests require a JSON-round-trippable financial payload and no
financial reads for anonymous/free visitors. Viewer-island tests cover loading, a resolved
financial profile, rejected reads, and changing institutions. A fresh production build and
signed-in browser visit must exercise the lazy financial section before release signoff.
