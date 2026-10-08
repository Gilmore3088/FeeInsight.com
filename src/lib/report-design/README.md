# Report design

One look for every report surface: the Hamilton briefing PDF, state and national reports,
the market study, the merger screen, Pro answer exhibits, the regulatory watch and competitor
alerts. James asked for this on Oct 7, 2026 ("cohesive reports, look and feel and consistency").

## Where things live

- `tokens.ts`: `RD` colours, `RD_FONTS`, `RD_TYPE` sizes, `RD_PDF*` for React-PDF.
  `src/lib/charts/style.ts` re-exports these as `CHART` / `CHART_FONTS` for older imports.
- `css.ts`: `REPORT_DESIGN_CSS`, scoped to `.rd`.
- `html.ts`: the structure as HTML strings (`rdDocument`, `rdHeader`, `rdExhibit`, `rdLegend`,
  `rdResponsive`) and its types (`RdDocument`, `RdExhibit`, `RdHero`).
- `src/components/report-design/index.tsx`: the same structure for React (`ReportDocument`,
  `ReportDesign`, `ReportHeader`, `HeroFigures`, `Exhibit`, `Legend`). Same class names.

## The pattern

A report is an eyebrow, a title, an italic deck, and at most four headline figures. Each
exhibit then has:

1. a label ("Exhibit 2 · Fees");
2. a headline that states what the data shows, computed from the data;
3. an optional italic sub-line;
4. a legend;
5. one or two chart panels, or an `rd-table`;
6. a plain notice when the data is missing;
7. a source line with the data date.

Lead with the exhibit, and keep prose short.

## Chart marks

- The subject bank, or banks in general, is a filled terra mark.
- Credit unions are a hollow ink ring.
- A median is a dark tick.
- The peers' middle half is a light terra band.
- Everything else is context grey.
- Named competitors after the subject use `RD.series` in order: ink, blue, green, purple.
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
