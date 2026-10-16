# 2026-10-15: a 404 thrown in a layout is drawn by the browser, not the server

**What happened:** #1267 reported that the 404s added by #1261 (institution, district, city)
come back as `<html id="__next_error__">` with an empty server-rendered body and the site's
default title. A local production build (`next build --webpack`, `next start`, Next 16.1.6)
showed the same for `/fees/city/zz` and `/institution/abc`:
- status 404 and `noindex`, as intended;
- the server HTML body holds no page, only the RSC payload; the not-found page is in that
  payload and React draws it after the scripts load. In headless Chromium the visitor sees the
  normal 404 page, with the nav and footer;
- an ordinary unknown URL (`/no-such-page`) is rendered on the server as usual.

Moving the `notFound()` out of the page's `generateMetadata` did not change this (tested by
editing `fees/city/[state]/(directory)/page.tsx` locally and rebuilding; reverted).

**Cause:** the check runs in a layout with no loading boundary above it, which is what makes the
status 404 (`2026-10-14-loading-boundary-locks-200.md`). Next therefore meets `notFound()` while
rendering the shell itself, so it sends its error shell with the 404 status and leaves the
not-found page to the client. The two goals pull against each other: a Suspense boundary above
the check would give a server-rendered body and a 200.

**Fix in #1267's PR:** the public `not-found.tsx` sets its title both ways: metadata (the
server HTML now says "Page not found | Fee Insight") and a React `<title>` (the browser tab,
after the client draws the page). Status, noindex and the visible page were already right.

**Lesson:** a layout-level 404 trades a server-rendered body for a correct status. Search
engines get the 404 and noindex they need; a visitor without JavaScript sees a blank page.
Keep that trade unless a later Next version renders not-found boundaries during the shell.
