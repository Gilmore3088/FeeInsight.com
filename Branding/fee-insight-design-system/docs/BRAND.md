# Fee Insight brand guidelines

The rules behind every token and component in this package. Token names here (`ink`, `brick`, `paper`…) map to CSS variables `--fi-ink`, `--fi-brick`, `--fi-paper` and Tailwind colours `ink`, `brick`, `paper`.

Fee Insight is the company; it makes two products. **Bank Fee Index** is free public fee data for consumers. **Hamilton** is the B2B fee intelligence product. One letter carries the whole family: the capital **I drawn as a box plot**, the chart that shows a fee's spread across banks. The palette is **Oxford Navy and brick terracotta on parchment**: an established research firm, not a fintech startup. Type is **Geist**, set heavy.

## The three marks

| Mark | What it is | Lockup | App icon / avatar |
| --- | --- | --- | --- |
| Fee Insight | The company: corporate pages, invoices, report covers, email | "Fee" centred above "Insight"; the box-plot I starts line two (`fee-insight-stacked-*`). A one-line version for short headers | Box-plot I on a navy tile (`app-icon-fee-insight`) |
| Bank Fee Index | Free public fee data: consumer data pages and the site footer (the feeinsight.com header carries Fee Insight) | One line, box-plot I in "Index", "Powered by Fee Insight" beneath (`bank-fee-index-lockup-*`) | Horizontal range bar on a brick tile (`app-icon-bank-fee-index`) |
| Hamilton | B2B fee intelligence: Hamilton site header, sales material | "Hamilton" in plain bold, "Powered by Fee Insight" beneath (`hamilton-lockup-*`) | The HI badge: H + box-plot I on a navy tile (`app-icon-hamilton`). Also the chat avatar |

- Use the `-light` file on `paper` (parchment) or `surface-0`; use the `-reverse` file on navy. Never place a mark on `brick` or a photo without a paper or navy plate.
- Keep the names and their casing exactly. Bank Fee Index and Hamilton both carry the same endorsement line: "Powered by Fee Insight". Hamilton's wordmark never gets a box plot. "HI" is a badge, not a product name.
- The box-plot I is a letter first: it must read as "I" at a glance. Its parts are fixed: top and bottom bars (min and max), a stem, a `brick` box over the middle (the middle half of the market) split by a thin `paper` median line. On navy, the box is the lighter brick #e0716a.
- Clear space: the height of the box-plot I's box on every side. Minimum sizes: stacked Fee Insight 32px tall; one-line wordmarks 16px cap height; app icons 16px (favicon cut).
- Don't: recolour the box to anything but `brick`; outline, stretch or add effects; use a box plot in Hamilton; bring back bank columns, arrows, rising bars, magnifying glasses, pie slices or price tags.
- The logo files are your drafts (outlined from Inter Display ExtraBold) recoloured to navy and brick; final art is being redrawn in Geist by a designer.

## Content fundamentals

- Plain, numerate and calm. Lead with the figure, then the meaning: "$35 overdraft fee. That's $8 above the peer median."
- Sentence case for headings and buttons; Title Case only for product names (Fee Insight, Bank Fee Index, Hamilton).
- "You" for the reader; "we" for Fee Insight. No exclamation marks, no emoji.
- Always name the source and date of a number in `small` under it ("Bank Fee Index · Q3 2026").
- Fees in dollars with cents under $100 ($12.50); percentages to one decimal (-8.2%).

## Colour

- Three brand colours: `ink` (Oxford Navy #132338), `brick` (#b23a32) and `paper` (parchment #f3efe6). `muted` (pewter #55606f) carries the endorsement line and metadata.
- Pages are parchment and navy. Brick appears once or twice per view: the box-plot I, the subject bank in a chart, focus rings, links, at most one brick button.
- Raise content onto `surface-0`; sink secondary areas into `surface-200`; separate with `border` hairlines before reaching for `shadow-1`.
- Primary buttons are navy (`ink` fill, `on-ink` text). Put `on-brick` text on a brick fill.
- The dark theme is the navy reverse: `paper` becomes navy, `ink` becomes parchment, brick lightens to #e0716a. Logos switch to their `-reverse` files.
- No other hues except the three chart encodings below.

## Data visualisation

- The box plot is the house chart: a `control-border` whisker (min–max), a `brick-tint` interquartile box, an `ink` median tick, and the subject bank as a `brick` dot. See FeeRange.
- Market position has three encodings, used only for data: `above-market` (brick), `in-range` (pewter slate), `below-market` (sage cypress). Always pair them with a word or ▲ ● ▼, never colour alone.
- One subject bank per chart or table; everything else in navy and greys.
- Gridlines in `border`; axis labels in `small` + `muted`; every figure in Geist Mono.

## Type

- Geist for everything (Google Fonts: `Geist` 400–800, `Geist Mono` 400–600): `https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap`.
- Headlines heavy and tight (`display`, `h1` at 800, negative tracking); the brand wants weight and confidence, never thin or austere type.
- Running text in `body`; `body-lg` for leads; `small` for sources and metadata; `label` (uppercase) for eyebrows and column headers; `endorsement` for "Powered by Fee Insight".
- Every fee, percentage and count is set in Geist Mono (`figure`, `figure-lg`), tabular and right-aligned in tables.

## Layout, shape and motion

- 4px base grid: `space-1` … `space-24`. Card padding `space-6`; section gaps `space-12`.
- Modest corners: `radius-md` for controls, `radius-lg` for cards, `radius-sm` for tags; app tiles use `radius-tile` (22%).
- Focus ring: 2px solid `brick` with a 2px offset.
- Motion is quick and functional (120–200ms ease-out); no decorative animation.

## Hamilton chat

- Hamilton's answers carry the HI badge and end with a source line in `muted`. User messages sit right, on navy.
- Voice: the number first, then what it means, then the source. Short paragraphs; offer a chart (FeeRange) when comparing more than two fees.

## Imagery and iconography

- Real product screenshots and short product videos over illustration, framed on parchment with one brick highlight per shot. No stock imagery of bank buildings, coins or handshakes.
- Icons: 1.5px-stroke outline set in `ink` or `muted`, 16/20/24px (Lucide is a close match). No icon fonts, no emoji.
- The box-plot I is the only brand symbol; don't invent others.
