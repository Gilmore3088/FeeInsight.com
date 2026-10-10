# H01 preview build: Google font parser failure

Tracked technical issue: [#1003](https://github.com/Gilmore3088/FeeInsight.com/issues/1003).
The existing #993 deployment for `19bc0f777ef0fb20b3ffe67406394a72ab0e36f4`
failed in `npm run build` with Next.js 16.1.6/Turbopack. Its Newsreader CSS used
Google's extensionless `/l/font?kit=...&skey=...&v=v26` URL and produced:

```text
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
next/font/google queries have exactly one entry
```

## Repeated local reproduction

A minimal app used the installed Next.js 16.1.6 and the original Newsreader
options (weights 300/400/500/600, normal/italic, Latin, `display: swap`). The
`NEXT_FONT_GOOGLE_MOCKED_RESPONSES` fixture returned a font face whose source was
`https://fonts.gstatic.com/l/font?kit=synthetic&skey=synthetic&v=v26`. This
reproduced the two exact parser errors above twice, with exit code 1 each time.
No provider, live database, authentication, or network font request was used.
The local receipts are `font-repro/build-extensionless.log` and
`font-repro/build-extensionless-repeat.log` in the task scratch directory.

This matches upstream [vercel/next.js#99114](https://github.com/vercel/next.js/issues/99114):
the font URL's query separators break Turbopack's encoded font-loader query.
The workaround keeps the existing compiler and font families.

## Fix and provenance

`src/app/layout.tsx` now uses `next/font/local` for Newsreader and JetBrains Mono.
The official Google Fonts binaries and SIL Open Font Licenses are in
`public/fonts`; `public/fonts/README.md` records upstream paths and Git blob
hashes. Newsreader's optical-size axis is fixed at 16, matching the original
Google loader default; its weight axis and both styles are retained. JetBrains
Mono is the unchanged official variable font. CSS variables, requested weight
ranges, and `display: swap` remain the same. Geist is unchanged.

The same minimal app using those exact local files built successfully with the
same installed Next.js version, including type checking and static generation
(exit code 0, receipt `font-repro/build-local-font-control.log`).

## Local dependency-root limitation

The first two full-checkout `npm run build` attempts failed before compilation:

```text
TurbopackInternalError: Symlink node_modules is invalid, it points out of the filesystem root
```

The checkout's `node_modules` symlink pointed to a sibling checkout's dependency
directory outside Turbopack's application root. The exact repeated receipts are
`h01-combined-build.log` and `h01-combined-build-repeat.log`. This is a local
dependency layout failure; it is separate from the deployment's Google parser
failure and does not establish a source/type-check failure. The local setup
blocker is tracked separately in [#1004](https://github.com/Gilmore3088/FeeInsight.com/issues/1004).

With authorization, the symlink was replaced by a hardlinked local directory,
preserving the original symlink in scratch. No package installation, dependency
file write, compiler switch, repository configuration change, production write,
or safety-restriction bypass was used.

## Remaining Google font request

After fixing the local dependency root, two full-checkout build attempts failed
on the remaining `next/font/google` import in `src/app/subscribe/page.tsx`:

```text
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap
Failed to fetch `Plus Jakarta Sans` from Google Fonts.
```

Both attempts exited 1, with the loader describing the connection error as
TLS-related. The receipts are `h01-combined-build-materialized.log` and
`h01-combined-build-materialized-repeat.log`. This related font build blocker
is recorded on #1003.

The subscribe page now self-hosts the unchanged official Plus Jakarta Sans
variable font, with its SIL license and provenance included in `public/fonts`.
It preserves weights 400–700, normal style, `--font-jakarta`, and `display: swap`.
`rg -n 'next/font/google' src` finds no remaining active Google loader imports.
The browser's Material Symbols stylesheet remains unchanged; it is a runtime
stylesheet, not a build-time font loader.

## Contaminated local verification discarded

The first combined build after self-hosting all three families compiled
successfully in 73 seconds, then printed `Running TypeScript ...` and `Killed`
(exit 137; `h01-combined-build-final.log`, last updated 20:56:13 UTC). A temporary
dependency copy inside the checkout was being discovered by the concurrent
TypeScript, lint, and test scans. That directory was moved out, then a recreated
partial copy was observed. Verification stopped while the local dependency
layout was cleaned again; a subsequent build was interrupted deliberately
(exit 130, `h01-combined-build-clean-final.log`). These runs are not release proof.
The resource failure is recorded on #1004. Root removed the temporary dependency
copies and confirmed their absence in sequential checks. Clean TypeScript and
diff checks passed afterward. The isolated local-font control build passed, but
the clean full-checkout build was held until the clean lint and full-suite
checks finished, then run sequentially.

## Clean full-checkout build passed

The normal `NEXT_TELEMETRY_DISABLED=1 npm run build` completed with exit code 0
on the combined checkout after cleanup and the final H01 edits. Next.js
16.1.6/Turbopack compiled successfully in 25.2 seconds, completed TypeScript,
generated all 74 static pages, and finalized optimization. The normal postbuild
check verified all 12 canonical admin routes. The exact receipt is
`h01-combined-build-clean-release.log` in the task scratch directory.

Local `DATABASE_URL` was unset, so prerendering used the application's existing
unavailable-data fallbacks. This build confirms compilation, type checking,
static generation, and the admin-route packaging check. It does not establish
authenticated preview acceptance or live database/provider behavior.
