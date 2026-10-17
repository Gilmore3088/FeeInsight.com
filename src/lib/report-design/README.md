# Report design

One look for every report surface: the Hamilton briefing PDF, state and national reports,
the market study, the merger screen, Pro answer exhibits, the regulatory watch and competitor
alerts. James asked for this on Oct 7, 2026 ("cohesive reports, look and feel and consistency").

## Where things live

- `tokens.ts`: `RD` colours (read from the brand tokens in `src/brand/tokens`), `RD_FONTS`
  (Geist and Geist Mono), `RD_TYPE` sizes, `RD_PDF*` for React-PDF.
  `src/lib/charts/style.ts` re-exports these as `CHART` / `CHART_FONTS` for older imports.
- `css.ts`: `REPORT_DESIGN_CSS`, scoped to `.rd`.
- `html.ts`: the structure as HTML strings (`rdDocument`, `rdHeader`, `rdExhibit`, `rdLegend`,
  `rdResponsive`) and its types (`RdDocument`, `RdExhibit`, `RdHero`).
- `src/components/report-design/index.tsx`: the same structure for React (`ReportDocument`,
  `ReportDesign`, `ReportHeader`, `HeroFigures`, `Exhibit`, `Legend`). Same class names.

## The pattern

A report is an eyebrow, a title, a deck, and at most four headline figures. Each
exhibit then has:

1. a label ("Exhibit 2 · Fees");
2. a headline that states what the data shows, computed from the data;
3. an optional sub-line;
4. a legend;
5. one or two chart panels, or an `rd-table`;
6. a plain notice when the data is missing;
7. a source line with the data date.

Lead with the exhibit, and keep prose short.

## Chart marks

- The subject bank, or banks in general, is a filled brick mark.
- Credit unions are a hollow ink ring.
- A median is a dark tick.
- The peers' middle half is a light brick band.
- Everything else is context grey.
- Named competitors after the subject use `RD.series` in order: ink, blue, below-market green, purple.
  The fifth and later go in grey.
- Labels sit on the marks, and numbers use tabular figures.

## Phone and print

- Draw each chart twice, wide (960) and narrow (400, larger type), and wrap the pair with
  `rdResponsive`.
- Below 640px only the narrow drawing shows. Print always uses the wide one.
- An exhibit never splits across a printed page, unless it is marked `flow` (a long ladder).
- Labels, headlines and legends never end a page.
- Table rows don't split across pages.

## Wording

- Use "lower/higher", never "cheaper".
- No em-dashes.
- Never recommend a price.
- A headline says what the data shows, not what to do.

## Hamilton answer screens

How the Pro workspace answers use this design system (#980, H05-T02). They add no new tokens or colours. Four choices wait for James (#1725): the key figure and section heading sizes, the report exhibit look replacing the boxed card, stacked cards for tables on phones, and one numeral face. Baseline findings and screenshots: `docs/project/findings/2026-10-17-hamilton-presentation-contract.md`.

### Order (answer first)
Already enforced by #1705 (H05-T04, `answer-order.test.tsx`): the requested result comes first.
A lookup leads with the fact and its source, a peer request with criteria and the table, a
comparison with the rows and limitations, and narrative follows. This contract adds no order rule.

### Type scale
One face: Geist Sans (`SERIF` in `memo.tsx` is a legacy name for it). Sizes come from
`ANSWER_TYPE` in `memo.tsx`:

| Role | Treatment | Component |
|---|---|---|
| Question (page h1) | 20px phone / 24px desktop when long, bold, centred on phones | `MemoHeader compact` |
| "The answer" kicker | 12px semibold capitals, brick | `AnswerLead` |
| Governing thought | 22px / 24px from sm, regular, brick rule on the left | `AnswerLead` (`ANSWER_TYPE.lead`) |
| Key figure | 24px, or 20px when longer than 8 characters; label 13px under it | `KeyFigures` (`figureSize`) |
| Exhibit label | 11px bold capitals, brick ("Exhibit 2") | `ExhibitShell` |
| Exhibit headline | report-design h2: 23px bold, 20px on phones | `ExhibitShell` |
| Section heading in an answer | 20px bold | `SectionHeading` (`ANSWER_TYPE.section`) |
| Body: findings, takeaways, memo text | 16px, relaxed leading | `ANSWER_TYPE.body` |
| Captions, evidence line, source line | 12px, warm grey | `ANSWER_TYPE.caption`, `.rd-source` |

### Heading order
Page h1 (the question), exhibit h2 (each exhibit's headline), h3 for sections inside an answer.
Headings balance (global `text-wrap: balance`); no component overrides it.

### Numbers and dates

| Value | Format | Helper |
|---|---|---|
| A fee | `$32`, `$2.50`; `$0` for a published zero | `fmtMoney` |
| A fee that is not published | "Not published" (never "Free", never "$0") | `fmtMoney(null)` |
| A fee with no amount on the schedule | "Amount not stated" | `PeerListView` (#1705) |
| A rate fee | as stated ("1.5% of the transfer ($5 minimum)"), its own line, never pooled with dollars | `PeerListView` (#1705) |
| Assets (registry, thousands) | `$3.0T`, `$48.3B`, `$950M`; missing reads "Not available" | `fmtAssets` |
| A change | `+$2.50`, `−$32` (true minus sign) | `fmtSignedPrice`, `fmtSignedMoney` |
| A range | `$27 to $34`; never broken inside a figure | `figureSize`, money-at-stake spans |
| A count against a total | `12 of 18` | text |
| Source date | `Sep 2026`; with " · Source over a year old" when old | `sourceDateWithAge` |
| Event date | `Mar 1, 2025` | `dayDate` |
| Sample size | `n=412` on the source badge | `SourceChip` |

### Tables
- Figures: Geist Sans with tabular digits (`ANSWER_TYPE.num`), right-aligned in a number column.
  Inside `.hamilton-shell` the site-wide `.tabular-nums` class and the report stylesheet's
  `--rd-mono` keep the sans face (`globals.css`). Public reports and admin are unchanged.
- Column headings: 12px medium capitals, warm grey (`ANSWER_TYPE.th`).
- The research institution's row is tinted brick and sits first.
- Phones: no table scrolls sideways. Below `sm` (segment table, structure matrix) or `md` (peer
  list, peer fee table) each row becomes a card of label and value; a column a phone hides folds
  into a line under the name, so its source link stays reachable. A scroll region kept on wider
  screens has a label and keyboard focus.

### Source badges
- A short answer (one exhibit): a source badge (`SourceChip`: label · `Sep 2026` · `n=`) at the end
  of each finding, through the one `FactList` (inline, or boxed for findings with nothing to draw).
- A storyline: a numbered note beside each line and one numbered source list at the foot.
- Every exhibit: "Source: label, Sep 2026" as its last line.

### Warnings and limitations
- A limitation sits before the text it qualifies, in a `Callout` (brick rule, tinted), never only
  inside an expandable section. Example: "Check these figures: ... could not be traced to the data
  Hamilton looked up for this answer. Treat them as unverified." (`after-ask-written-390.png`).
- Hamilton's own reading sits under its label, apart from the facts (#1705).
- Status changes (loading, writing, saved, failed) are announced with `role="status"` or
  `role="alert"`.
- Optional narrative ("Read the full answer", "1 more finding") sits behind `More`; a missing or
  stale-data caveat never does.

### Width
Analyze, Research and Reports use `MemoPage` at its default width (`max-w-5xl`, 1024px; the
`reading` width, 768px, is used by no answer screen). Exhibits, callouts, boxed findings and the
composer run the column's full width (`ExhibitShell` overrides the report sheet's own 960px
centring). Running text keeps the site measure of about 75 characters (34em, `globals.css`,
James 2026-10-09); on a written answer the next-step buttons sit beside the commentary from `lg`
up, so the measure leaves no empty column. The lead sentence keeps `max-w-[68ch]`.
