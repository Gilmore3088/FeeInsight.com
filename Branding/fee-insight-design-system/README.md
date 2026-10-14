# Fee Insight design system: engineering handoff

Everything needed to build Fee Insight, Bank Fee Index and Hamilton in the locked brand: **Oxford Navy + brick terracotta on parchment, Geist, the box-plot I.**

Built for a TypeScript / React / Next.js codebase with Tailwind, and it works without Tailwind too. Nothing here needs a new npm dependency: the components use React only, and the fonts come from `next/font/google`.

## Where it lives in this repo

| Package path | Repo path |
| --- | --- |
| `tokens/`, `tailwind/`, `styles/`, `components/` | `src/brand/` (import from `@/brand/components`) |
| `public/brand/` (logos, app icons, social images) | `public/brand/` |
| `public/` favicon set and `site.webmanifest` | `Branding/fee-insight-design-system/favicon/` until the site rebrand wires them in |
| `docs/`, `examples/`, this README | `Branding/fee-insight-design-system/` |

The designer brief is `Branding/designer-brief-v2.md` (PDF: `Branding/Fee Insight logo family designer brief.pdf`).
Paths in the rest of this README are the package's own.

## What's in the box

| Path | What it is |
| --- | --- |
| `tokens/tokens.css` | **Source of truth at runtime.** CSS variables (`--fi-ink`, `--fi-brick`…) for light and dark, spacing, radius, shadows, fonts, and `.fi-text-*` type classes. |
| `tokens/tokens.ts` | The same values as typed TS constants (for charts, emails, canvas, server-rendered images). |
| `tokens/tokens.json` | W3C design-token (DTCG) format, for Style Dictionary or Figma Tokens. Dark values live under `$extensions`. |
| `tailwind/preset.ts` | Tailwind **v3** preset: `bg-paper`, `text-ink`, `bg-brick`, `border-border`, `text-fi-h1`, `rounded-lg`, `shadow-fi-1`, `p-fi-6`… Opacity modifiers work (`bg-ink/10`). |
| `tailwind/theme.css` | The same mapping for Tailwind **v4** (`@theme inline`). |
| `styles/fee-insight.css` | Styles for the React components (class prefix `fi-`). |
| `components/` | React + TypeScript components: `Logo`, `AppIcon`, `Button`, `Tag`, `StatCard`, `FeeRange` (+ `FeeRangeAxis`), `FeeTable`, `SearchInput`, `ChatMessage` (+ `Figure`). Server-component safe. |
| `public/` | Drop into the app's `public/`: favicon set, web manifest, and `brand/` (all logos as SVG + PNG, app icons 16–1024px, social share images). |
| `examples/` | `layout.tsx` (fonts, metadata, icons, theme) and `header.tsx` (product headers). |
| `docs/BRAND.md` | Brand rules: logo usage, colour, type, voice, charts. Read before designing new screens. |

## Install (Next.js App Router)

1. Copy `tokens/`, `tailwind/`, `styles/` and `components/` into the app, e.g. `src/brand/`. Copy `public/*` into `public/`.
2. Load fonts and global CSS in `app/layout.tsx`. See `examples/layout.tsx`. Geist comes from `next/font/google` and is exposed as `--font-geist-sans` / `--font-geist-mono`, which the tokens pick up automatically.
3. Wire up Tailwind:
   - **v3:** in `tailwind.config.ts`, `import fiPreset from "./src/brand/tailwind/preset"`, add `presets: [fiPreset]`, and include `./src/brand/components/**/*.{ts,tsx}` in `content`.
   - **v4:** in your global CSS: `@import "tailwindcss"; @import "../brand/tokens/tokens.css"; @import "../brand/tailwind/theme.css";`
4. Import components from `@/brand/components`.

```tsx
import { Logo, StatCard, FeeRange, FeeRangeAxis, FeeTable } from "@/brand/components";

<Logo mark="bank-fee-index-lockup" height={40} />
<StatCard label="Overdraft fee" value="$35.00" delta="$8 above the median" position="above" source="Bank Fee Index · Q3 2026" />
<FeeRange label="Overdraft" min={0} q1={15} median={27} q3={34} max={38} value={35} domain={[0, 40]} />
<FeeRangeAxis ticks={[0, 10, 20, 30, 40]} />
```

## Theming

- Light (parchment) is the default. Dark is the **navy reverse**: set `data-theme="dark"` on `<html>` or on any section, e.g. a navy hero band. Everything inside switches, logos included.
- `Logo` draws inline SVG coloured by CSS variables, so it follows the theme with no extra files. Force a colourway with `tone="light" | "reverse" | "mono"` (mono uses `currentColor`).
- App icons keep fixed colours in both themes.
- Always use tokens, never hex values, in product code. The one exception is places CSS can't reach (emails, OG images, PDFs), which use `tokens.ts`.

## Which logo where

| Surface | Use |
| --- | --- |
| feeinsight.com site header | `<Logo mark="fee-insight-oneline" />`. Fee Insight is the site; Bank Fee Index is its product (James, 2026-10-14) |
| Bank Fee Index data pages and footer | `bank-fee-index-lockup` (with "Powered by Fee Insight") where a page presents the index itself |
| Hamilton site header | `<Logo mark="hamilton-wordmark" />`; the footer and sales material get `hamilton-lockup` |
| Hamilton chat avatar | `<AppIcon brand="hamilton" size={32} />` |
| Corporate pages, invoices, report covers, email | `fee-insight-stacked`; `fee-insight-oneline` for short headers |
| Favicon / PWA | Bank Fee Index site: `public/favicon.ico`, `icon.svg`, `apple-touch-icon.png`, `icon-192/512.png` (the Fee Insight I). Per-product icons are in `public/brand/icons/` (`app-icon-bank-fee-index-*`, `app-icon-hamilton-*`). |
| Social share | `public/brand/og/og-*.png` (1200×630) |

Minimum sizes: stacked Fee Insight 32px tall, one-line wordmarks 16px cap height, app icons 16px. Clear space equals the height of the box-plot I's box on every side.

## Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | #f3efe6 | #132338 | Page ground |
| `surface-0` | #fbf9f4 | #1a2c44 | Cards, tables, inputs |
| `surface-200` | #ebe5d9 | #0e1a2b | Table headers, sunken areas |
| `ink` | #132338 | #f3efe6 | Text, headings, logo letters, primary buttons |
| `on-ink` | #f3efe6 | #132338 | Text on ink fills |
| `muted` | #55606f | #a9b3c1 | Captions, metadata, endorsement line |
| `border` | #ddd5c6 | #263a55 | Hairlines (decorative) |
| `control-border` | #767c87 | #5d6f87 | Input borders, chart whiskers (3:1) |
| `brick` | #b23a32 | #e0716a | The one accent: box-plot box, subject bank, links, focus ring, one accent button |
| `on-brick` | #ffffff | #132338 | Text on brick fills |
| `brick-tint` / `brick-ink` | #f1d5d0 / #7f2620 | #4a2430 / #f3efe6 | Highlighted rows, tags, chart IQR band |
| `above-market` / `in-range` / `below-market` | brick / #5a646e / #3b6350 | brick / #a3adb8 / #7fb59b | Chart encodings only; always with a word or ▲●▼ |

All text pairs meet WCAG AA (4.5:1) in both themes; borders, icons and focus rings meet 3:1.

## Accessibility built in

- Every logo and icon has an accessible name. Pass `title=""` when it sits next to visible text with the same name (e.g. a linked header logo with an `aria-label`).
- `FeeRange` exposes its numbers via `aria-label`. `FeeTable` has a screen-reader caption, scoped headers and `aria-current` on the subject row.
- Market position is never colour alone. Focus ring: 2px brick with a 2px offset.

## Status and open items

- **Logo artwork is interim.** The SVGs are precise vector traces of the approved drafts (outlined from Inter Display ExtraBold). When the designer delivers the final Geist artwork, replace `components/logo-paths.ts` and `public/brand/*.svg` / PNGs with the same names. Nothing else changes.
- **Favicon small-size cut.** The 16/32px icons are scaled from the full mark; the designer brief asks for a simplified cut.
- **Fee Insight one-line lockup** was assembled from the stacked lockup's letters; the designer should confirm its spacing.
- The live, browsable version of this system (with previews in both themes) is the Fee Insight design system in Claude.
