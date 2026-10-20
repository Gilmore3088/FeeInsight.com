# Brand headings rendered in a system font, not Geist

**Date:** 2026-10-15
**Found by:** builder session on PR #1286, while measuring heading line breaks.

## What happened
- `src/brand/tokens/tokens.css` declares `--fi-font-sans: var(--font-geist-sans, Geist), ...` on `:root`.
- `next/font` sets `--font-geist-sans` through a class, and `src/app/layout.tsx` put that class on `<body>`.
- A custom property that reads another one resolves where it is declared. At `:root` the Geist variable did not exist, so `--fi-font-sans` fell back to a family named "Geist" that nothing loads, then to Helvetica Neue, Arial or the system font.
- Everything styled with `var(--fi-font-sans)` (display headings, buttons, tags) showed in that fallback. Body text using Tailwind's `font-sans` was unaffected.
- `main` did not show it, because `main` does not load the brand tokens yet; #1286 brings them in.

## Fix
- `layout.tsx` puts the `next/font` variable classes on `<html>`, so every token declared on `:root` can read them. Checked on a local production build: `--fi-font-sans` resolves to `GeistSans` and headings compute to `GeistSans`.

## Rule
- Put `next/font` variable classes on `<html>`, never only on `<body>`, whenever a token on `:root` refers to them.

**Guard:** `src/app/layout-fonts.test.tsx:20` (renders the root layout: the `next/font` variable classes are on `<html>`)
