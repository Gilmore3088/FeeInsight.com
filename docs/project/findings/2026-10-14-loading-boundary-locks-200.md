# 2026-10-14: a loading skeleton above a route locks its status at 200
**What happened:** after #1187 moved `notFound()` into `generateMetadata`, the checkpoint for
2026-10-13 recorded that a browser fetch of a missing institution still got 200 with noindex.
A minimal Next 16.1.6 app (`next build --webpack`, `next start`, curl with a Chrome, a Googlebot
and a bingbot user agent) showed why:
- `loading.tsx` above the route, `notFound()` in `generateMetadata` and the page: 200 for all
  three user agents, with `<meta name="robots" content="noindex">`;
- no `loading.tsx` at all: 404 for all three;
- `loading.tsx` in the route's own folder, check only in `generateMetadata` and the page: 200;
- `loading.tsx` in the route's own folder, with the check in that folder's `layout.tsx`: 404 for
  all three;
- the same, plus a `loading.tsx` one folder up: 200 again.

**Cause:** `loading.tsx` is a Suspense boundary. Next sends the shell (layouts plus the
skeleton) with status 200 before anything inside the boundary runs, and that includes the page
and, for user agents that get streamed metadata, `generateMetadata`. `(public)/loading.tsx`,
`fees/loading.tsx`, `research/loading.tsx` and `fees/city/[state]/loading.tsx` sat above every
route that calls `notFound()`.

**Fix:** #1165 follow-up PR (lane C). No `loading.tsx` sits above the four routes that answer 404
(institution, district, city state directory, city); each checks its record in its own
`layout.tsx`. The other public pages keep the same skeletons through per-folder `loading.tsx`
files and the `(index)` and `(directory)` route groups. `src/app/not-found-status.test.ts`
guards the layout.

**Lesson:** a route that must answer 404 does its existence check in a layout with no loading
boundary above it. Adding a `loading.tsx` to a parent folder silently turns its 404s into 200s.
