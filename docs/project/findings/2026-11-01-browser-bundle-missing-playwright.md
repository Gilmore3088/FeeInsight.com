# 2026-11-01: The browser step never rendered a page on prod

**What happened:** `MAGELLAN_BROWSER=on` after #2765 merged (Oct 27). From Oct 27 09:00 to Oct 29
01:24 UTC the fetch step logged 117 `fetch.browser_render` attempts at 112 banks. All 117 failed
with `Cannot find module '/var/task/node_modules/playwright-core/browsers.json'` (outcome
`network_error`, 0 bytes). No page was rendered. After Oct 29 there were no attempts at all.

**Cause:** Two problems.
1. `playwright-core` is a server external package, and it loads `browsers.json` (and other files
   of its own) by `require(path.join(packageRoot, "browsers.json"))`. File tracing cannot follow a
   computed path, and `outputFileTracingIncludes` listed only `@sparticuz/chromium/bin/**`. Tests
   and `next build` see the whole of `node_modules`, so everything passed locally.
2. The launch ran inside each bank's fetch, so the failure was recorded as the bank's own failed
   fetch: `consecutive_failures` went up and its 30-day browser retry window started. The pool of
   JavaScript-page banks ran out within two days, so the step went quiet while still switched on.

**Fix:** `next.config.ts` ships `./node_modules/playwright-core/**` with the agent routes, and
`src/lib/agents/magellan/browser-bundle.test.ts` fails when `browsers.json`, `package.json` or the
bundles are missing from that list (it fails on the old config). `runBrowserFetch` starts the
browser once before any bank (`browserStartError`). If the browser can't start, it tries no bank
and reports `launchError` on the step. `BROWSER_FETCH_STRATEGY` is now v2, and the retry window
counts only v2 renders, so the 112 banks are tried again.

**Proof on prod (after merge):** `fetch.browser_render` attempts at `strategy_version = 2` with
outcome `ok` or `unchanged`, then Rosetta texts and live fees from those documents (the
`browserRenders` health numbers).

**Lesson:** a package that loads its own files by a computed path must be listed in
`outputFileTracingIncludes`, with a test that reads the list. A failure of our own tooling must
never count as a bank's failure.

**Guard:** `src/lib/agents/magellan/browser-bundle.test.ts`

**Agent lesson:** magellan/browser-start-failure-is-ours-not-the-banks
