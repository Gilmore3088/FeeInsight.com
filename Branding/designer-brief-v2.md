# Fee Insight logo family: designer brief (v2)

Oct 14, 2026 · James

**What changed since v1:** the palette is now **Oxford Navy + brick terracotta on parchment** (the original terracotta read as too orange), and Hamilton's endorsement line is now **"Powered by Fee Insight"**, the same as Bank Fee Index.

## The ask

Redraw three approved logos in **Geist** at production quality. The concepts, layout and colours are decided; the job is precise letterforms, spacing and optical balance, plus the final file set. The current drafts (attached as SVG) are traced from Inter Display ExtraBold as a stand-in and are not final art. Engineering has already built the product around these drafts, so keep the **file names and layer roles** in the deliverables below and the swap will be drop-in.

## The three marks

| Mark | What it is | Where it's used | Lockup | App icon / avatar |
| --- | --- | --- | --- | --- |
| Fee Insight | The company | Corporate pages, invoices, report covers, email | "Fee" centred above "Insight"; the box-plot I starts line two. A one-line version for short headers | Box-plot I on a navy tile |
| Bank Fee Index | Free public fee data | Every consumer page and the public site header | One line, box-plot I in "Index", "Powered by Fee Insight" beneath | Horizontal range bar on a brick tile |
| Hamilton | B2B fee intelligence product | Hamilton site header, sales material | "Hamilton" in plain bold, "Powered by Fee Insight" beneath | The HI badge: H + the box-plot I on a square navy tile. Also the chat avatar |

## The idea

One letter carries the whole brand: the capital **I** drawn as a box plot, the chart that shows a fee's spread across banks.

- **Anatomy of the box-plot I:** a top bar and a bottom bar (the min and max), a stem between them, and a brick box over the middle (the middle half of the market) split by a thin paper-coloured line (the median).
- **It is a letter first.** It must read as "I" in a word at a glance; the chart is the second read.
- **Where it appears:** the I in "Insight" and "Index", and the I of Hamilton's HI badge. HI is just a badge, not a product name.
- **Hamilton's wordmark has no box plot** on purpose. It shares the family through type, colour and the endorsement line.

## Keep vs refine

| Keep exactly | Refine |
| --- | --- |
| The three names, their casing, and the endorsement line "Powered by Fee Insight" on both Bank Fee Index and Hamilton | Letterforms: redraw everything in Geist at a heavy weight (around ExtraBold/Black) |
| The box-plot I's parts: bars, stem, box, median line | Box-plot I proportions so its weight matches the Geist letters next to it |
| Fee Insight stacked with "Fee" centred; a one-line variant (draft assembled from the stacked letters, so check its spacing) | Kerning around the box-plot I, especially I–n |
| Palette and roles (navy letters, brick box) | Optical sizing: a simplified box-plot I that still reads at 16px |
| Three distinct app icons: I on navy, range bar on brick, HI on navy | HI badge spacing and the H–I pairing |
| Hamilton = plain bold wordmark, no symbol in the word | Clear-space and minimum-size rules |

## Colour and type

| Role | Light | Dark (reverse) |
| --- | --- | --- |
| Ink: letters, tiles (Oxford Navy) | #132338 | #f3efe6 |
| Accent: box, Bank Fee Index tile (brick) | #b23a32 | #e0716a |
| Paper: background (parchment) | #f3efe6 | #132338 |
| Endorsement line | #55606f | #a9b3c1 |

On the navy app tiles, the box uses the lighter brick #e0716a so it holds against navy; the Bank Fee Index tile itself is #b23a32 with a navy box.

Type: **Geist** (free from Vercel / Google Fonts). Wordmarks heavy; the endorsement line Geist Medium at about a quarter of the wordmark's size.

## Already tried and rejected

- Bank imagery: columns, porticos, pillars.
- Stock fintech symbols: arrows, rising bar charts, magnifying glasses, pie slices, price tags.
- Thin, muted, "austere" type; the brand wants weight and confidence.
- A box plot in Hamilton's wordmark (a two-box-plot H, a box-plot lowercase i).
- Literal Hamilton motifs: quill, tricorne hat, portrait silhouette.
- Palettes: graphite + signal vermilion, the original orange terracotta, cobalt blue, green + gold, steel blue.

## Deliverables (keep these file names; engineering swaps them in directly)

- [ ] Fee Insight: `fee-insight-stacked`, `fee-insight-oneline`, each as default, `-reverse` and `-mono`
- [ ] Bank Fee Index: `bank-fee-index-lockup` and `bank-fee-index-wordmark`, each as default, `-reverse` and `-mono`
- [ ] Hamilton: `hamilton-lockup` and `hamilton-wordmark`, each as default, `-reverse` and `-mono`
- [ ] Box-plot I glyph: `box-plot-i`, full detail and a small-size version
- [ ] App icons: `app-icon-fee-insight`, `app-icon-bank-fee-index`, `app-icon-hamilton` at 1024px, plus a simplified 16/32px favicon cut
- [ ] Files: SVG with outlined text, one path per colour role (ink, accent, endorsement), and PNG for every item; the working source file (Figma or Illustrator)
- [ ] A one-page usage sheet: clear space, minimum sizes, do's and don'ts
