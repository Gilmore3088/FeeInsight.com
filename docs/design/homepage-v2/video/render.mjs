// Renders composition.html to frames and an MP4 with the pre-installed Chromium and ffmpeg.
// Usage: node render.mjs <assets-dir with report-01..10.png> <out-dir> [fps] [chromium path]
// The page images come from the Index-look sample PDF:
//   pdftoppm -r 150 -png public/reports/competitive-fee-position-sample.pdf <assets-dir>/report
// Nothing here talks to a provider or a database; it is a deterministic render of the composition.
import { chromium } from "playwright";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const [assetsDir, outDir, fpsArg, exe] = process.argv.slice(2);
if (!assetsDir || !outDir) throw new Error("usage: node render.mjs <assets-dir> <out-dir> [fps] [chromium]");
const fps = Number(fpsArg ?? 30);
const DURATION = 30;
const fonts = resolve(here, "../../../../Reports/studio/fonts");
mkdirSync(join(outDir, "frames"), { recursive: true });

const html = readFileSync(join(here, "composition.html"), "utf8")
  .replaceAll("__ASSETS__", "file://" + resolve(assetsDir))
  .replaceAll("__FONTS__", "file://" + fonts);
const pagePath = join(outDir, "composition.resolved.html");
writeFileSync(pagePath, html);

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto("file://" + pagePath, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const total = DURATION * fps;
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.seek(t), i / fps);
  await page.screenshot({ path: join(outDir, "frames", `f${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 92 });
  if (i % 150 === 0) console.log(`frame ${i}/${total}`);
}
// Poster: the settled cover frame.
await page.evaluate((t) => window.seek(t), 20.6);
await page.screenshot({ path: join(outDir, "poster.png"), type: "png" });
await browser.close();

execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(fps), "-i", join(outDir, "frames", "f%04d.jpg"),
  "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(outDir, "hamilton-walkthrough.mp4")]);
console.log("wrote", join(outDir, "hamilton-walkthrough.mp4"));
