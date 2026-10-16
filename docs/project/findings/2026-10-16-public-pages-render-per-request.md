# Public pages render per request because each page opts in, not because of the header

Found 2026-10-16 while working #1168 (site punch list, item 3).

## What #1168 assumed
Public pages answered `no-store` with a cache MISS on every visit, and the likely cause was a
session-aware shared header reading cookies, which would force every page under it dynamic.

## What main shows (commit 273cf1b)
The shared chrome reads no request data:
- `src/app/layout.tsx` reads no cookies, headers or session.
- `src/app/(public)/layout.tsx:6-10` says so on purpose, and renders `ConsumerNav`, `CustomerFooter`,
  `SearchModal` and `AdminViewBanner` only.
- `src/components/consumer-nav.tsx:13-20`: the header is a server shell; everything that depends on
  who is signed in is a client island resolving the session after hydration
  (`src/components/use-session-chrome.ts`). `AdminViewBanner` and `SearchModal` are `"use client"`.
- No layout under `src/app/(public)/` calls `cookies()`, `headers()`, `getCurrentUser` or sets
  `force-dynamic`.

So the header fix #1168 proposes is already on main. Each measured route makes itself dynamic:

| Route | What makes it render per request |
|---|---|
| `/` | Nothing; ISR every 15 min since #1502 (`src/app/page.tsx:15`). A failed read opts that render out (`src/app/page.tsx:113`; #1572). |
| `/for-institutions` | `force-dynamic` (`src/app/for-institutions/page.tsx:2`) and awaits `searchParams` (`:63`) |
| `/reports` | Awaits `searchParams` (`src/app/(public)/reports/page.tsx:171`), which overrides its `revalidate = 3600` (`:31`) |
| `/subscribe` | `force-dynamic` (`src/app/subscribe/page.tsx:1`), `getCurrentUser()` (`:178`), `searchParams` (`:179`) |
| `/about` | `force-dynamic` (`src/app/(public)/about/page.tsx:1`) |
| `/contact` | Passes `searchParams` to the client form, which reads it with `use()` (`src/app/(public)/contact/page.tsx:41`, `contact-form.tsx:36`) |
| `/research` | `force-dynamic` (`src/app/(public)/research/(index)/page.tsx:1`) |
| state page | `force-dynamic` (`src/app/(public)/research/state/[code]/page.tsx:1`), `getCurrentUser()` (`:80`) |
| city page | `force-dynamic` (`src/app/(public)/fees/city/[state]/[city]/page.tsx:1`) |
| institution page | `force-dynamic` (`src/app/(public)/institution/[id]/page.tsx:1`), `searchParams` (`:130`), `getCurrentUser()` (`:151`) |
| `/guides` | `force-dynamic` (`src/app/(public)/guides/page.tsx:15`); the comment above it explains why: no params to skip prerender when the database is down at build time |

This is read from the code, not from a build's route table: no local build was run (no
`node_modules` in the session) and the live site and Vercel previews were unreachable from the
session's network, so no TTFB or cache header was measured.

## What would fix it
Per page, not shared. Each route needs its own change, following the homepage pattern from #1502:
drop `force-dynamic`, set `revalidate`, never cache a render whose reads failed, and move any
`searchParams` or signed-in reads into a client island. Pages that show signed-in state
(`/subscribe`, state page, institution page) need that part moved client-side first. These files
belong to the open page-template PRs (#1464, #1467, #1470, #1471, #1477, #1481, #1488, #1491,
#1503, #1530, #1532, #1535, #1564), so the change belongs in each of them, not in one cross-cutting PR.
Before copying the homepage pattern, #1572 (homepage cold-cache 500) should be decided, since the
same failure mode would apply to every page converted.
