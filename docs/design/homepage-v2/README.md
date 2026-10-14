# Homepage v2: the Index look

The homepage (`src/app/page.tsx`, `src/components/home/`) and its two assets share one look:
navy `#0e1a2b` for words and primary buttons, white and `#f3f5f8` surfaces, signal green
`#0b6b4f` (`#3ccf98` on navy) as the only accent, Geist for words, Geist Mono for every number,
4px corners on controls and 8px on cards. The web tokens are `--color-index-*` in
`src/app/globals.css`; the report and the video carry the same values.

## The sample report

`Reports/studio/sample/sample-competitive-fee-position-index.html` is the Index-look edition of
`sample-competitive-fee-position.html`: the same content, figures and dates (Sample Community
Bank, Oct 3, 2026, 60 peers), only the stylesheet changes. Fonts are the Geist files in
`Reports/studio/fonts/` (SIL OFL, `geist-OFL.txt`).

To render it (Chromium prints the PDF; Poppler rasterizes the pages):

```sh
# PDF, 10 pages, Letter
node -e '
const { chromium } = require("playwright");
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto("file://" + process.cwd() + "/Reports/studio/sample/sample-competitive-fee-position-index.html", { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: "public/reports/competitive-fee-position-sample.pdf", preferCSSPageSize: true, printBackground: true });
  await b.close(); })();'
# pages 1 to 3 for the homepage spread, 1200px wide, AVIF and WebP
pdftoppm -f 1 -l 3 -r 150 -png public/reports/competitive-fee-position-sample.pdf /tmp/page
# then resize each to 1200px and save as public/reports/sample-preview/page-N.{avif,webp}
```

`src/components/home/home-assets.test.ts` reads the served PDF and fails when its page count,
institution, date or first finding stop matching what the page states.

## The walkthrough video

`video/composition.html` is the 30-second walkthrough at 1920×1080: one HTML stage whose
`window.seek(t)` sets every element for time `t`, so a render is deterministic. The scenes are
the question, Hamilton's answer with the sample's figures ($18 against a $5 peer median; 2.2
against 1.7 basis points), the revenue-lens page as evidence, the create-report step, the
cover, the position map, the executive summary and the ten-page strip. Every page shown is a
raster of the PDF above; the chrome around them is authored, and the frame says so
("Illustrative walkthrough · figures from the sample report · fictional institution").

```sh
pdftoppm -r 150 -png public/reports/competitive-fee-position-sample.pdf /tmp/assets/report
node docs/design/homepage-v2/video/render.mjs /tmp/assets /tmp/out 30
# writes /tmp/out/hamilton-walkthrough.mp4 (H.264, no audio) and /tmp/out/poster.png (the cover frame)
```

Then copy the MP4 to `public/videos/hamilton-walkthrough.mp4`, save the poster as WebP at
`public/videos/hamilton-walkthrough-poster.webp`, and keep `hamilton-walkthrough.vtt` in step
with the scenes. The video is muted and has no audio track; the page shows a poster and a play
button and never autoplays.
