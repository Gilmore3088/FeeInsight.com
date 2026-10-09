# 2026-10-09: local `next dev` pages never hydrate, so client behavior goes untested
**What happened:** While retesting the PR 939 pages at 320-1440 px with Playwright against
`next dev --webpack`, every client component stayed as server HTML. The browser logged
"Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of
script" on every page, so effects never ran (for example the table scroll cue measurement and
the institution page's `?fee=` scroll). Screenshots taken that way show the first paint only.
**Cause:** `next.config.ts` sends the production Content-Security-Policy in development too.
Its `script-src` has no `'unsafe-eval'`, which webpack's development build needs. Production
builds do not use eval, so the live site is not affected.
**Fix:** none in code yet. For local checks, open pages in Playwright with
`browser.newPage({ bypassCSP: true })` (or a production `next build && next start`).
**Lesson:** before trusting a local screenshot or retest of anything interactive, check the
console for CSP errors; use `bypassCSP: true` in Playwright scripts against `next dev`.
