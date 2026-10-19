# A required read on a prerendered page can fail the whole deploy

**Found:** 2026-10-18 and again 2026-10-19 (#1988). Two Vercel preview builds (#1864 at f8248ad9f, #2039 at c869fc4d7) failed while prerendering `/institutions`: `public stats read missed its 15000 ms deadline`. Neither PR touched that page.

**Why:** #1957 made `/institutions` ISR, so it renders at build time. Its headline-count read used `budget.required`, which throws when the deadline passes. A slow database during a build (several preview builds at once, plus agent load) then fails the build, and the same would fail a production deploy.

**Fix:** the stats read is `budget.optional` with `UNAVAILABLE_PUBLIC_STATS` (every label is the unavailable label, never "0"); `budget.failed()` already shortens that render's cache life to one minute. Test: `src/app/(public)/institutions/directory-deadline.test.tsx`.

**Rule:** on a page that prerenders at build time, use `budget.required` only for a read the page cannot exist without (an institution page's own row). Everything else is `budget.optional` with an honest fallback.
