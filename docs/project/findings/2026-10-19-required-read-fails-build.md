# 2026-10-19: a required read on a prerendered page failed the deploy

**What happened.** Two Vercel preview builds (#1864 at f8248ad9f on Oct 18, #2039 at c869fc4d7 on Oct 19) failed while prerendering `/institutions`: `public stats read missed its 15000 ms deadline`. Neither PR touched that page (#1988).

**Cause.** #1957 made `/institutions` ISR, so it renders at build time. Its headline-count read used `budget.required`, which throws when the deadline passes. A slow database during a build (several preview builds at once, plus agent load) then fails the build, and would fail a production deploy the same way.

**Fix.** The stats read is `budget.optional` with `UNAVAILABLE_PUBLIC_STATS` (every label unavailable, never "0"). A fallback or an incomplete count shortens that render's cache life to one minute, and the intro line that quotes the count is hidden while it is unavailable. Test: `src/app/(public)/institutions/directory-deadline.test.tsx`.

**Lesson.** On a page that prerenders at build time, use `budget.required` only for a read the page cannot exist without (an institution page's own row). Everything else is `budget.optional` with an honest fallback.
