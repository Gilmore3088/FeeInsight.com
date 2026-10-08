/**
 * Hamilton's merger screen: two banks screened as one. Five exhibits (footprint map, profile,
 * earnings, local competition, fees), each with a title that states its finding, computed
 * from the figures it draws. Pure functions: data in (src/lib/data-store/merger-screen.ts),
 * SVG strings and sentences out. Every chart is drawn twice, 960 wide for desktop and paper
 * and 400 wide for a phone, in the shared chart style (src/lib/charts/style.ts). When a
 * figure is missing the exhibit says so; nothing is estimated.
 */
import type { RdDocument } from "@/lib/report-design/html";
import { geoBounds, geoConicConformal, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, MultiLineString } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countiesTopology from "us-atlas/counties-10m.json";
import { CHART, CHART_FONTS } from "@/lib/charts/style";
import { escapeHtml } from "@/lib/report-templates/base/components";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { FIPS_TO_STATE } from "@/lib/geo/state-fips";
import { institutionValue } from "@/lib/data-store/fee-stats";
import { buildMarket, HHI_HIGH, HHI_MODERATE, hhiWord } from "@/lib/hamilton/brief-context";
import type { LocalMarketMember } from "@/lib/data-store/custom-report-market";
import type {
  CountyMarket,
  FeeAmounts,
  MergerBranch,
  MergerScreenData,
  QuarterRecord,
} from "@/lib/data-store/merger-screen";

export const WIDE_W = 960;
export const NARROW_W = 400;

export interface ChartSize {
  narrow?: boolean;
}

/** The subject bank is terra, its partner ink. */
export const BANK_COLORS = [CHART.terra, CHART.ink] as const;

// ─── Small helpers ────────────────────────────────────────────────────────────

const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const MINUS = "−";
/** Land on the footprint map: the brand paper tone, so the map reads apart from the white card. */
const LAND = "#FAF7F2";

interface TextOpts {
  size?: number;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  font?: keyof typeof CHART_FONTS;
  fill?: string;
  halo?: boolean;
}

function text(x: number, y: number, body: string, opts: TextOpts = {}): string {
  const font = CHART_FONTS[opts.font ?? "sans"].replace(/"/g, "'");
  const halo = opts.halo ? ` stroke="${CHART.paper}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke"` : "";
  const nums = opts.font === "mono" ? ` font-variant-numeric="tabular-nums"` : "";
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${font}" font-size="${opts.size ?? 11}" text-anchor="${opts.anchor ?? "start"}"${opts.weight ? ` font-weight="${opts.weight}"` : ""} fill="${opts.fill ?? CHART.inkSoft}"${nums}${halo}>${escapeHtml(body)}</text>`;
}

/** Rough text width for layout (Geist and Geist Mono run near 0.6 em a character). */
function textWidth(body: string, size: number): number {
  return body.length * size * 0.6;
}

function svg(width: number, height: number, body: string, label: string): string {
  return `<svg class="rd-chart" viewBox="0 0 ${width} ${Math.ceil(height)}" width="100%" role="img" aria-label="${escapeHtml(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/**
 * A chart drawn twice: at report width for paper and desktop, and at phone width with larger
 * type and labels above the marks. CSS shows one or the other; print uses the wide one.
 */
export function responsive(draw: (size: ChartSize) => string | null): string | null {
  const wide = draw({});
  if (!wide) return null;
  const narrow = draw({ narrow: true });
  return narrow ? `<div class="sc-wide">${wide}</div><div class="sc-narrow">${narrow}</div>` : wide;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

export function countWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : n.toLocaleString("en-US");
}

export function ordinal(n: number): string {
  return n >= 1 && n <= ORDINALS.length ? ORDINALS[n - 1] : `number ${n}`;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Dollars from a figure in thousands: $5.6B, $23.8M, −$4.4M, $0. */
export function moneyK(v: number): string {
  if (v === 0) return "$0";
  const sign = v < 0 ? MINUS : "";
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}B`;
  if (a >= 1e3) {
    const m = a / 1e3;
    return `${sign}$${Number.isInteger(Math.round(m * 10) / 10) ? Math.round(m) : m.toFixed(1)}M`;
  }
  return `${sign}$${Math.round(a)}K`;
}

export function money(v: number): string {
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

/** Round tick values covering lo..hi in about `count` steps. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-9)!;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function niceCeil(v: number, step: number): number {
  return Math.ceil((v + 1e-9) / step) * step;
}

const GENERIC_SHORT = new Set(["first", "citizens", "peoples", "farmers", "united", "community", "american", "security", "home", "national", "state", "bank", "the", "union"]);

/** A bank's short name for titles: "Orrstown Bank" → "Orrstown", "The Ephrata National Bank" → "Ephrata". */
export function shortBankName(name: string): string {
  const clean = name
    .replace(/,?\s+National Association$/i, "")
    .replace(/,?\s+N\.\s?A\.?$/i, "")
    .replace(/^The\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = clean.replace(/\s+(National Bank|Bank|National|Trust|Savings|Federal|Community|State Bank|Banking)\b.*$/i, "").trim();
  if (!cut || cut === clean || GENERIC_SHORT.has(cut.toLowerCase()) || cut.length < 3) return clean;
  return cut;
}

// ─── Counties ─────────────────────────────────────────────────────────────────

type CountyFeature = Feature<Geometry, { name: string }> & { id: string };
type Topo = Topology<{ counties: GeometryCollection<{ name: string }>; states: GeometryCollection }>;

let countyCache: CountyFeature[] | null = null;
let boundsCache: Map<string, [[number, number], [number, number]]> | null = null;
let stateLines: MultiLineString | null = null;

function allCounties(): CountyFeature[] {
  if (!countyCache) {
    const topo = countiesTopology as unknown as Topo;
    countyCache = (feature(topo, topo.objects.counties) as FeatureCollection<Geometry, { name: string }>).features.map((f) => ({
      ...f,
      id: String(f.id).padStart(5, "0"),
    })) as CountyFeature[];
  }
  return countyCache;
}

function countyBounds(): Map<string, [[number, number], [number, number]]> {
  if (!boundsCache) boundsCache = new Map(allCounties().map((f) => [f.id, geoBounds(f) as [[number, number], [number, number]]]));
  return boundsCache;
}

function stateBorders(): MultiLineString {
  if (!stateLines) {
    const topo = countiesTopology as unknown as Topo;
    stateLines = mesh(topo, topo.objects.states, (a, b) => a !== b) as MultiLineString;
  }
  return stateLines;
}

const CITY_COUNTY_STATES = new Set(["24", "29", "32", "51"]);

/** "Lancaster County", "Orleans Parish", "Baltimore city"; the FIPS code when the county is unknown. */
export function countyName(fips: string): string {
  const f = allCounties().find((c) => c.id === fips);
  if (!f) return `County ${fips}`;
  const name = f.properties.name;
  const st = fips.slice(0, 2);
  if (st === "22") return `${name} Parish`;
  if (st === "02" || /\b(city|City|Borough|Census Area|Municipality)$/.test(name)) return name;
  if (CITY_COUNTY_STATES.has(st) && Number(fips.slice(2)) >= 510) return `${name} city`;
  return `${name} County`;
}

// ─── Exhibit 1: footprint map ────────────────────────────────────────────────

export interface FootprintInput {
  names: [string, string];
  branches: MergerBranch[];
  overlap: string[];
}

/** Both banks' branches on a county map, sized by deposits, the shared counties shaded. */
export function footprintMap(input: FootprintInput, size: ChartSize = {}): string | null {
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW_W : WIDE_W;
  const located = input.branches.filter((b) => b.lat != null && b.lon != null);
  const bounds = countyBounds();
  const home = [...new Set(input.branches.map((b) => b.fips))].filter((f) => bounds.has(f));
  if (home.length === 0 && located.length === 0) return null;

  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (lon: number, lat: number) => {
    x0 = Math.min(x0, lon);
    x1 = Math.max(x1, lon);
    y0 = Math.min(y0, lat);
    y1 = Math.max(y1, lat);
  };
  for (const f of home) {
    const [[a, b], [c, d]] = bounds.get(f)!;
    grow(a, b);
    grow(c, d);
  }
  for (const b of located) grow(b.lon!, b.lat!);
  const pad = Math.max(0.06 * (x1 - x0), 0.06 * (y1 - y0), 0.12);
  const box = { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad };
  const frame: Feature<Geometry> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPoint",
      coordinates: [
        [box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1],
        [(box.x0 + box.x1) / 2, box.y0], [(box.x0 + box.x1) / 2, box.y1],
      ],
    },
  };
  const midLat = (box.y0 + box.y1) / 2;
  const projection = geoConicConformal()
    .rotate([-(box.x0 + box.x1) / 2, 0])
    .parallels([midLat - 2, midLat + 2]);
  projection.fitWidth(w - 8, frame);
  const fit = geoPath(projection).bounds(frame);
  const h = Math.round(Math.min(narrow ? 460 : 600, Math.max(narrow ? 260 : 340, fit[1][1] - fit[0][1])));
  projection.fitExtent([[4, 4], [w - 4, h - 4]], frame);
  const path = geoPath(projection).digits(1);

  const overlap = new Set(input.overlap);
  const context = allCounties().filter((f) => {
    const b = bounds.get(f.id)!;
    return b[1][0] >= box.x0 - 0.3 && b[0][0] <= box.x1 + 0.3 && b[1][1] >= box.y0 - 0.3 && b[0][1] <= box.y1 + 0.3;
  });
  const clipId = `merger-map-clip-${narrow ? "n" : "w"}`;
  let body = `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#${clipId})">`;
  for (const f of context) {
    if (overlap.has(f.id)) continue;
    body += `<path d="${path(f) ?? ""}" fill="${LAND}" stroke="${CHART.rule2}" stroke-width="0.8"/>`;
  }
  body += `<path d="${path(stateBorders()) ?? ""}" fill="none" stroke="${CHART.muted}" stroke-width="1.1"/>`;
  for (const f of context) {
    if (!overlap.has(f.id)) continue;
    body += `<path d="${path(f) ?? ""}" fill="${CHART.terraSoft}" stroke="${CHART.terra}" stroke-width="2"><title>${escapeHtml(`${countyName(f.id)}: both banks have branches here`)}</title></path>`;
  }

  // Branches, largest first so small ones stay visible on top.
  const maxDep = Math.max(1, ...located.map((b) => b.depositsK));
  const rMax = narrow ? 11 : 16;
  const radius = (d: number) => 2.5 + (rMax - 2.5) * Math.sqrt(Math.max(0, d) / maxDep);
  for (const b of [...located].sort((p, q) => q.depositsK - p.depositsK)) {
    const pt = projection([b.lon!, b.lat!]);
    if (!pt) continue;
    const tip = `${input.names[b.bank]}: ${b.name}${b.city ? `, ${b.city}` : ""}. Deposits ${moneyK(b.depositsK)}`;
    body += `<circle cx="${r1(pt[0])}" cy="${r1(pt[1])}" r="${r1(radius(b.depositsK))}" fill="${BANK_COLORS[b.bank]}" fill-opacity="0.85" stroke="${CHART.paper}" stroke-width="1"><title>${escapeHtml(tip)}</title></circle>`;
  }
  body += "</g>";

  // Labels: shared counties first (largest combined deposits), then the largest others.
  const depByCounty = new Map<string, number>();
  for (const b of input.branches) depByCounty.set(b.fips, (depByCounty.get(b.fips) ?? 0) + b.depositsK);
  const stateDeposits = new Map<string, number>();
  for (const b of input.branches) stateDeposits.set(b.fips.slice(0, 2), (stateDeposits.get(b.fips.slice(0, 2)) ?? 0) + b.depositsK);
  const mainState = [...stateDeposits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const labelFor = (fips: string) => `${countyName(fips)}${fips.slice(0, 2) !== mainState ? `, ${FIPS_TO_STATE[fips.slice(0, 2)] ?? ""}` : ""}`;
  const boxes: Array<[number, number, number, number]> = [];
  const place = (fips: string, strong: boolean): string => {
    const f = context.find((c) => c.id === fips);
    if (!f) return "";
    const [[bx0, by0], [bx1, by1]] = path.bounds(f);
    const [cx, cy] = path.centroid(f);
    if (!Number.isFinite(cx)) return "";
    const fs = strong ? (narrow ? 18 : 14) : narrow ? 15 : 11;
    const label = labelFor(fips);
    const tw = textWidth(label, fs);
    const x = Math.min(Math.max(cx, tw / 2 + 4), w - tw / 2 - 4);
    // A shared county's name sits just above its outline; others at their centre.
    const y = strong ? Math.max(fs + 2, by0 - 6) : cy + fs / 3;
    const bb: [number, number, number, number] = [x - tw / 2 - 3, y - fs, x + tw / 2 + 3, y + 4];
    if (bb[1] < 0 || bb[3] > h || boxes.some((o) => bb[0] < o[2] && bb[2] > o[0] && bb[1] < o[3] && bb[3] > o[1])) return "";
    if (!strong && (bx1 < 0 || bx0 > w || by1 < 0 || by0 > h)) return "";
    boxes.push(bb);
    return text(x, y, label, { size: fs, anchor: "middle", font: strong ? "serif" : "sans", weight: strong ? 600 : undefined, fill: strong ? CHART.ink : CHART.inkSoft, halo: true });
  };
  let labels = "";
  const shared = [...input.overlap].sort((a, b) => (depByCounty.get(b) ?? 0) - (depByCounty.get(a) ?? 0));
  for (const f of shared.slice(0, narrow ? 2 : 3)) labels += place(f, true);
  const others = [...depByCounty.entries()].filter(([f]) => !overlap.has(f)).sort((a, b) => b[1] - a[1]);
  let count = 0;
  for (const [f] of others) {
    if (count >= (narrow ? 3 : 7)) break;
    const l = place(f, false);
    if (l) count++;
    labels += l;
  }
  return svg(w, h, body + labels, `Branches of ${input.names[0]} and ${input.names[1]}`);
}

// ─── Dumbbell rows (profile and fees) ────────────────────────────────────────

interface DumbbellValue {
  bank: 0 | 1;
  value: number | null;
}

/**
 * Value labels for two dots on a phone row, placed above the marks: the lower value ends at
 * its dot, the higher starts at its dot, pushed apart when the dots sit close.
 */
function labelsAbove(lo: { x: number; text: string }, hi: { x: number; text: string } | null, y: number, w: number, fs: number, strongHi = false): string {
  if (!hi) {
    const tw = textWidth(lo.text, fs);
    const x = Math.min(Math.max(lo.x, tw / 2), w - tw / 2);
    return text(x, y, lo.text, { size: fs, anchor: "middle", font: "mono", fill: CHART.ink, weight: 600 });
  }
  const wl = textWidth(lo.text, fs);
  const wh = textWidth(hi.text, fs);
  let loEnd = lo.x + 4;
  let hiStart = hi.x - 4;
  if (hiStart - loEnd < 8) {
    const mid = (lo.x + hi.x) / 2;
    loEnd = mid - 4;
    hiStart = mid + 4;
  }
  if (loEnd - wl < 0) {
    hiStart += wl - loEnd;
    loEnd = wl;
  }
  if (hiStart + wh > w) {
    const shift = hiStart + wh - w;
    hiStart -= shift;
    loEnd = Math.min(loEnd, hiStart - 8);
  }
  return (
    text(loEnd, y, lo.text, { size: fs, anchor: "end", font: "mono" }) +
    text(hiStart, y, hi.text, { size: fs, anchor: "start", font: "mono", fill: CHART.ink, weight: strongHi ? 600 : 500 })
  );
}

function dot(x: number, y: number, bank: 0 | 1, r: number, tip: string): string {
  return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${BANK_COLORS[bank]}" stroke="${CHART.paper}" stroke-width="1.5"><title>${escapeHtml(tip)}</title></circle>`;
}

// ─── Exhibit 2: profile ──────────────────────────────────────────────────────

export interface ProfileRow {
  label: string;
  hint?: string;
  values: [number | null, number | null];
  format: (v: number) => string;
  /** Smallest scale the row is drawn on; widened when a value falls outside it. */
  domain: [number, number];
}

function rowDomain(row: ProfileRow): [number, number] {
  const vals = row.values.filter((v): v is number => v != null);
  const lo = Math.min(row.domain[0], ...vals);
  const hiRaw = Math.max(row.domain[1], ...vals);
  const step = hiRaw > 50 ? 10 : hiRaw > 10 ? 2 : 0.5;
  return [lo < 0 ? -niceCeil(-lo, step) : lo, hiRaw > row.domain[1] ? niceCeil(hiRaw, step) : hiRaw];
}

/** Each measure on its own scale: two dots joined by a bar, the values written beside them. */
export function profileChart(rows: ProfileRow[], names: [string, string], size: ChartSize = {}): string | null {
  const usable = rows.filter((r) => r.values.some((v) => v != null));
  if (usable.length === 0) return null;
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW_W : WIDE_W;
  const L = narrow ? 10 : 290;
  const R = narrow ? 10 : 60;
  const rh = narrow ? 78 : 46;
  let out = "";
  usable.forEach((row, i) => {
    const y = 6 + i * rh;
    const [lo, hi] = rowDomain(row);
    const x = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (w - L - R);
    const cy = narrow ? y + 56 : y + 16;
    if (narrow) {
      out += text(0, y + 18, row.label, { size: 18, font: "serif", fill: CHART.ink, weight: 500 });
      if (row.hint) out += text(w, y + 18, row.hint, { size: 14.5, anchor: "end" });
    } else {
      out += text(0, y + 18, row.label, { size: 14, font: "serif", fill: CHART.ink, weight: 500 });
      if (row.hint) out += text(0, y + 33, row.hint, { size: 11 });
    }
    out += `<line x1="${L}" x2="${w - R}" y1="${cy}" y2="${cy}" stroke="${CHART.rule}"/>`;
    const pts: DumbbellValue[] = row.values.map((value, k) => ({ bank: k as 0 | 1, value }));
    const known = pts.filter((p): p is { bank: 0 | 1; value: number } => p.value != null);
    if (known.length === 2) {
      const [a, b] = known;
      out += `<line x1="${r1(x(Math.min(a.value, b.value)))}" x2="${r1(x(Math.max(a.value, b.value)))}" y1="${cy}" y2="${cy}" stroke="${CHART.rule2}" stroke-width="5"/>`;
    }
    for (const p of [...known].reverse()) out += dot(x(p.value), cy, p.bank, 7, `${names[p.bank]}: ${row.format(p.value)}`);
    const missing = pts.filter((p) => p.value == null).map((p) => `${shortBankName(names[p.bank])}: not reported`);
    const sorted = [...known].sort((p, q) => p.value - q.value);
    if (narrow) {
      const loP = sorted[0];
      const hiP = sorted.length > 1 ? sorted[1] : null;
      out += labelsAbove({ x: x(loP.value), text: row.format(loP.value) }, hiP ? { x: x(hiP.value), text: row.format(hiP.value) } : null, cy - 13, w, 15.5, true);
      if (missing.length) out += text(w, cy + 24, missing.join(" · "), { size: 14.5, anchor: "end" });
    } else {
      if (sorted.length === 2) {
        out += text(x(sorted[1].value) + 13, cy + 4.5, row.format(sorted[1].value), { size: 12.5, font: "mono", fill: CHART.ink, weight: 600 });
        out += text(x(sorted[0].value) - 13, cy + 4.5, row.format(sorted[0].value), { size: 12.5, font: "mono", anchor: "end" });
      } else if (sorted.length === 1) {
        out += text(x(sorted[0].value) + 13, cy + 4.5, row.format(sorted[0].value), { size: 12.5, font: "mono", fill: CHART.ink, weight: 600 });
      }
      if (missing.length) out += text(w, cy - 9, missing.join(" · "), { size: 11, anchor: "end" });
    }
  });
  return svg(w, 6 + usable.length * rh + (narrow ? 0 : 4), out, `${names[0]} and ${names[1]} side by side`);
}

// ─── Exhibit 3: earnings lines ───────────────────────────────────────────────

export interface QuarterPoint {
  date: string;
  value: number;
}

export interface LineNote {
  date: string;
  value: number;
  lines: string[];
  /** Set the note under its point (true) or over it (false); by default it goes where there is room. */
  below?: boolean;
}

export function quarterLabel(iso: string): string {
  return `Q${Math.ceil(Number(iso.slice(5, 7)) / 3)} ${iso.slice(0, 4)}`;
}

/** Two banks' quarterly series on one scale, with end labels and an optional note. */
export function quarterLines(
  series: [QuarterPoint[], QuarterPoint[]],
  names: [string, string],
  opts: { format: (v: number) => string; label: string; note?: LineNote | null },
  size: ChartSize = {},
): string | null {
  const narrow = Boolean(size.narrow);
  if (series.every((s) => s.length === 0)) return null;
  const W = narrow ? NARROW_W : 460;
  const H = narrow ? 290 : 240;
  const fs = narrow ? 15 : 10.5;
  const L = narrow ? 62 : 48;
  const R = narrow ? 80 : 64;
  const T = 14;
  const B = narrow ? 32 : 26;
  const dates = [...new Set(series.flat().map((p) => p.date))].sort();
  const values = series.flat().map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (d: string) => L + (dates.length > 1 ? dates.indexOf(d) / (dates.length - 1) : 0.5) * (W - L - R);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  let out = "";
  for (const t of ticks) {
    out += `<line x1="${L}" x2="${W - R}" y1="${r1(y(t))}" y2="${r1(y(t))}" stroke="${t === 0 && yMin < 0 ? CHART.muted : CHART.rule}"/>`;
    out += text(L - 6, y(t) + fs / 3, opts.format(t), { size: fs, anchor: "end", font: "mono" });
  }
  // One date label a year, at the second quarter, as in the call reports' midyear.
  const mids = dates.filter((d) => d.slice(5, 7) === "06");
  const shown = mids.length >= 2 ? mids : [dates[0], dates[dates.length - 1]];
  for (const d of [...new Set(shown)]) out += text(x(d), H - 8, quarterLabel(d), { size: fs, anchor: "middle", font: "mono" });
  const ends: Array<{ bank: 0 | 1; y: number; text: string; x: number }> = [];
  for (const bank of [1, 0] as const) {
    const pts = series[bank];
    if (pts.length === 0) continue;
    const color = BANK_COLORS[bank];
    const width = bank === 0 ? 2.5 : 1.8;
    if (pts.length > 1) out += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${r1(x(p.date))} ${r1(y(p.value))}`).join("")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;
    for (const p of pts) out += `<circle cx="${r1(x(p.date))}" cy="${r1(y(p.value))}" r="${narrow ? 3.2 : 3}" fill="${color}"><title>${escapeHtml(`${names[bank]}, ${quarterLabel(p.date)}: ${opts.format(p.value)}`)}</title></circle>`;
    const last = pts[pts.length - 1];
    ends.push({ bank, y: y(last.value) + fs / 3, text: opts.format(last.value), x: x(last.date) + 7 });
  }
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < fs + 3) {
    const [top, bottom] = ends[0].y <= ends[1].y ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const mid = (top.y + bottom.y) / 2;
    top.y = mid - (fs + 3) / 2;
    bottom.y = mid + (fs + 3) / 2;
  }
  for (const e of ends) out += text(e.x, e.y, e.text, { size: narrow ? 16 : 11.5, font: "mono", fill: e.bank === 0 ? CHART.terraText : CHART.ink, weight: 600 });
  const note = opts.note;
  if (note && dates.includes(note.date)) {
    const px = x(note.date);
    const py = y(note.value);
    const nfs = narrow ? 15 : 11;
    const lw = Math.max(...note.lines.map((l) => textWidth(l, nfs)));
    // Beside the point where it fits; otherwise pulled back inside the chart.
    const right = px + 10 + lw <= W - 2 || px < W / 2;
    const tx = right ? Math.min(px + 10, W - 2 - lw) : Math.max(px - 10, lw + 2);
    const below = note.below ?? py < (T + H - B) / 2;
    let ty = below ? py + nfs + 4 : py - 8 - (note.lines.length - 1) * (nfs + 3);
    ty = Math.min(Math.max(ty, T + nfs), H - B + 2 - (note.lines.length - 1) * (nfs + 3));
    note.lines.forEach((line, i) => {
      out += text(tx, ty + i * (nfs + 3), line, { size: nfs, anchor: right ? "start" : "end", fill: i ? CHART.inkSoft : CHART.ink, weight: i ? undefined : 600, halo: true });
    });
  }
  return svg(W, H, out, opts.label);
}

// ─── Exhibit 4: local deposit shares and HHI ─────────────────────────────────

export interface ShareRow {
  name: string;
  share: number;
  combined: boolean;
  /** For the combined row: each bank's own share. */
  parts?: [number, number];
}

/** The county's largest holders by deposit share, the combined bank as one stacked bar. */
export function shareBars(rows: ShareRow[], size: ChartSize = {}): string | null {
  if (rows.length === 0) return null;
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW_W : 460;
  const max = Math.max(...rows.map((r) => r.share)) || 1;
  let out = "";
  if (narrow) {
    const rh = 50;
    const bw = w - 76;
    rows.forEach((r, i) => {
      const y = i * rh;
      out += text(0, y + 17, r.name, { size: 16, fill: CHART.ink, weight: r.combined ? 600 : 500 });
      out += bars(r, 0, y + 25, bw / max, 14);
      out += text(bw * (r.share / max) + 6, y + 37, `${r.share.toFixed(1)}%`, { size: 15, font: "mono", fill: r.combined ? CHART.ink : CHART.inkSoft, weight: r.combined ? 600 : undefined });
    });
    return svg(w, rows.length * rh, out, "Share of county deposits");
  }
  const rh = 26;
  const L = 160;
  const bw = w - L - 56;
  rows.forEach((r, i) => {
    const y = 6 + i * rh;
    const room = Math.floor((L - 14) / (12.5 * 0.6));
    const label = r.name.length > room ? `${r.name.slice(0, room - 1).trimEnd()}…` : r.name;
    out += text(L - 10, y + 14, label, { size: 12.5, anchor: "end", fill: r.combined ? CHART.ink : CHART.inkSoft, weight: r.combined ? 600 : undefined });
    out += bars(r, L, y + 3, bw / max, 14);
    out += text(L + bw * (r.share / max) + 6, y + 15, `${r.share.toFixed(1)}%`, { size: 11.5, font: "mono", fill: r.combined ? CHART.ink : CHART.inkSoft, weight: r.combined ? 600 : undefined });
  });
  return svg(w, rows.length * rh + 10, out, "Share of county deposits");
}

function bars(r: ShareRow, x: number, y: number, scale: number, h: number): string {
  if (r.combined && r.parts) {
    const a = r.parts[0] * scale;
    const b = r.parts[1] * scale;
    return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(a)}" height="${h}" fill="${BANK_COLORS[0]}"/><rect x="${r1(x + a)}" y="${r1(y)}" width="${r1(b)}" height="${h}" fill="${BANK_COLORS[1]}"/>`;
  }
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(1.5, r.share * scale))}" height="${h}" fill="${CHART.rule2}"/>`;
}

export interface HhiRow {
  place: string;
  pre: number;
  post: number;
}

/** Each shared county's HHI today (dashed) and combined (terra) against the guideline bands. */
export function hhiChart(rows: HhiRow[], size: ChartSize = {}): string | null {
  if (rows.length === 0) return null;
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW_W : 460;
  const pad = narrow ? 4 : 10;
  const top = Math.max(2600, niceCeil(Math.max(...rows.map((r) => r.post)) * 1.08, 200));
  const x = (v: number) => pad + (v / top) * (w - 2 * pad);
  const fs = narrow ? 15 : 11;
  let out = "";
  const zones: Array<[number, number, string, string]> = [
    [0, HHI_MODERATE, "Unconcentrated", CHART.paper],
    [HHI_MODERATE, HHI_HIGH, "Moderate", CHART.terraSoft],
    [HHI_HIGH, top, "High", CHART.band],
  ];
  for (const [a, b, label] of zones) out += text((x(a) + x(b)) / 2, fs + 2, label, { size: fs, anchor: "middle" });
  for (const v of [HHI_MODERATE, HHI_HIGH]) out += text(x(v), fs * 2 + 8, v.toLocaleString("en-US"), { size: fs - 0.5, anchor: "middle", font: "mono" });
  const head = fs * 2 + 14;
  const rh = narrow ? 84 : 62;
  rows.forEach((r, i) => {
    const y = head + i * rh;
    const change = r.post - r.pre;
    const summary = `${r.pre.toLocaleString("en-US")} to ${r.post.toLocaleString("en-US")}, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toLocaleString("en-US")}`;
    out += text(0, y + fs + 2, r.place, { size: narrow ? 17 : 13, font: "serif", fill: CHART.ink, weight: 500 });
    if (!narrow) out += text(w, y + fs + 2, summary, { size: 11.5, anchor: "end", font: "mono", fill: CHART.ink });
    const by = y + fs + 9;
    const bh = narrow ? 24 : 26;
    for (const [a, b, , fill] of zones) out += `<rect x="${r1(x(a))}" y="${r1(by)}" width="${r1(x(b) - x(a))}" height="${bh}" fill="${fill}" stroke="${CHART.rule2}"/>`;
    out += `<line x1="${r1(x(r.pre))}" x2="${r1(x(r.pre))}" y1="${r1(by - 3)}" y2="${r1(by + bh + 3)}" stroke="${CHART.inkSoft}" stroke-width="2" stroke-dasharray="3 2"><title>${escapeHtml(`${r.place} today: ${r.pre}`)}</title></line>`;
    out += `<line x1="${r1(x(r.post))}" x2="${r1(x(r.post))}" y1="${r1(by - 4)}" y2="${r1(by + bh + 4)}" stroke="${CHART.terra}" stroke-width="3"><title>${escapeHtml(`${r.place} combined: ${r.post}`)}</title></line>`;
    if (narrow) out += text(0, by + bh + 21, summary, { size: 15, font: "mono", fill: CHART.ink });
  });
  return svg(w, head + rows.length * rh + (narrow ? 4 : -8), out, "Market concentration before and after");
}

// ─── Exhibit 5: fees ─────────────────────────────────────────────────────────

export interface FeeRow {
  category: string;
  label: string;
  values: [number, number];
  /** True when the bank lists more than one price for the fee. */
  several: [boolean, boolean];
}

/** Fees above this sit on their own scale so the many small fees stay readable. */
const SMALL_FEE_MAX = 60;

function feeGroup(list: FeeRow[], names: [string, string], max: number, step: number, narrow: boolean, title: string | null): string {
  const w = narrow ? NARROW_W : WIDE_W;
  const L = narrow ? 16 : 250;
  const R = narrow ? 26 : 70;
  const x = (v: number) => L + (v / max) * (w - L - R);
  const fs = narrow ? 14.5 : 10.5;
  const headH = (title ? (narrow ? 28 : 22) : 0) + 22;
  const rh = narrow ? 72 : 34;
  const height = headH + list.length * rh + 6;
  let out = "";
  if (title) out += text(0, narrow ? 17 : 14, title, { size: narrow ? 16 : 12, fill: CHART.ink, weight: 600 });
  const axisY = headH - 6;
  const tickStep = narrow && (max / step) * 34 > w - L - R ? step * 2 : step;
  for (let v = 0; v <= max + 1e-9; v += tickStep) {
    out += `<line x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${axisY + 4}" y2="${height}" stroke="${CHART.rule}"/>`;
    out += text(x(v), axisY, `$${v}`, { size: fs, anchor: "middle", font: "mono" });
  }
  list.forEach((r, i) => {
    const y = headH + i * rh;
    const [a, b] = r.values;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const gap = Math.round((hi - lo) * 100) / 100;
    const gapText = gap === 0 ? "same" : `${money(gap)} apart`;
    const label = `${r.label}${r.several.some(Boolean) ? " *" : ""}`;
    const cy = narrow ? y + 52 : y + 16;
    if (narrow) {
      out += text(0, y + 17, label, { size: 16.5, fill: CHART.ink, weight: 500 });
      out += text(w, y + 17, gapText, { size: 14.5, anchor: "end", font: "mono" });
    } else {
      out += text(0, cy - 1, label, { size: 13, fill: CHART.ink, weight: 500 });
      out += text(0, cy + 13, gapText, { size: 11, font: "mono" });
    }
    out += `<line x1="${r1(x(lo))}" x2="${r1(x(hi))}" y1="${cy}" y2="${cy}" stroke="${CHART.rule2}" stroke-width="5"/>`;
    // The partner first, so the subject's dot sits on top when they tie.
    for (const bank of [1, 0] as const) out += dot(x(r.values[bank]), cy, bank, narrow ? 7 : 6.5, `${names[bank]}, ${r.label}: ${money(r.values[bank])}`);
    if (narrow) {
      out += gap === 0
        ? labelsAbove({ x: x(lo), text: `both ${money(lo)}` }, null, cy - 13, w, 15)
        : labelsAbove({ x: x(lo), text: money(lo) }, { x: x(hi), text: money(hi) }, cy - 13, w, 15);
    } else if (gap === 0) {
      out += text(x(hi) + 12, cy + 4, `both ${money(hi)}`, { size: 11.5, font: "mono" });
    } else {
      out += text(x(hi) + 12, cy + 4, money(hi), { size: 11.5, font: "mono", fill: CHART.ink, weight: 600 });
      out += text(x(lo) - 12, cy + 4, money(lo), { size: 11.5, font: "mono", anchor: "end" });
    }
  });
  return svg(w, height, out, title ?? "Fees side by side");
}

/** Every fee both banks publish, largest difference first; large fees on their own scale. */
export function feeChart(rows: FeeRow[], names: [string, string], size: ChartSize = {}): string | null {
  if (rows.length === 0) return null;
  const narrow = Boolean(size.narrow);
  const small = rows.filter((r) => Math.max(...r.values) <= SMALL_FEE_MAX);
  const big = rows.filter((r) => Math.max(...r.values) > SMALL_FEE_MAX);
  const parts: string[] = [];
  if (small.length) {
    const max = Math.max(10, niceCeil(Math.max(...small.flatMap((r) => r.values)), 10));
    parts.push(feeGroup(small, names, max, max > 30 ? 10 : 5, narrow, null));
  }
  if (big.length) {
    const top = Math.max(...big.flatMap((r) => r.values));
    const step = top > 1000 ? 250 : top > 400 ? 100 : 50;
    parts.push(feeGroup(big, names, niceCeil(top, step), step, narrow, small.length ? "Larger fees, on their own scale" : null));
  }
  return `<div class="rd-stack">${parts.join("")}</div>`;
}

// ─── The screen: findings, titles and exhibits ───────────────────────────────

export interface HeroFigure {
  figure: string;
  unit?: string;
  label: string;
  detail: string;
}

export interface MergerExhibit {
  key: "footprint" | "profile" | "earnings" | "competition" | "fees";
  kicker: string;
  title: string;
  sub: string | null;
  /** Legend entries: the two banks, plus any extra note. */
  legend: string[] | null;
  /** Chart HTML (one or two panels); null when there is nothing to draw. */
  panels: Array<{ heading: string | null; html: string }>;
  /** Plain words shown in place of a chart, when data is missing. */
  notice: string | null;
  source: string;
}

export interface MergerScreen {
  names: [string, string];
  shortNames: [string, string];
  title: string;
  deck: string;
  heroes: HeroFigure[];
  exhibits: MergerExhibit[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

export interface MarketFinding {
  fips: string;
  place: string;
  /** Holders by share, the two banks merged into one combined row. */
  combinedRank: number;
  combinedShare: number;
  shares: [number, number];
  holders: number;
  /** Names of the holders ahead of the combined bank. */
  ahead: string[];
  pre: number;
  post: number;
  depositsK: number;
  rows: ShareRow[];
}

function toMembers(market: CountyMarket, ids: [number, number], merge: boolean): LocalMarketMember[] {
  const members: LocalMarketMember[] = [];
  let combined = 0;
  for (const h of market.holders) {
    const ours = h.institutionId === ids[0] || h.institutionId === ids[1];
    if (merge && ours) {
      combined += h.depositsK;
      continue;
    }
    members.push({
      institution_id: h.institutionId ?? -members.length - 1,
      institution_name: h.name,
      city: null,
      state_code: null,
      charter_type: null,
      market_deposits: h.depositsK * 1000,
      is_subject: !merge && h.institutionId === ids[0],
    });
  }
  if (merge && combined > 0) {
    members.push({ institution_id: ids[0], institution_name: "Combined bank", city: null, state_code: null, charter_type: null, market_deposits: combined * 1000, is_subject: true });
  }
  return members;
}

/** HHI before and after, and the combined bank's rank, in one shared county. */
export function marketFinding(market: CountyMarket, ids: [number, number], names: [string, string], sodYear: number): MarketFinding | null {
  const total = market.holders.reduce((s, h) => s + h.depositsK, 0);
  if (total <= 0) return null;
  const place = countyName(market.fips);
  const asMarket = (merge: boolean) =>
    buildMarket({ basis: "branch_counties", places: [place], county_fips: [market.fips], sod_year: sodYear, members: toMembers(market, ids, merge) }, names[0]);
  const before = asMarket(false);
  const after = asMarket(true);
  if (!before || !after) return null;
  const dep = (id: number) => market.holders.filter((h) => h.institutionId === id).reduce((s, h) => s + h.depositsK, 0);
  const shares: [number, number] = [(dep(ids[0]) / total) * 100, (dep(ids[1]) / total) * 100];
  const others = market.holders
    .filter((h) => h.institutionId !== ids[0] && h.institutionId !== ids[1])
    .map((h) => ({ name: h.name, share: (h.depositsK / total) * 100 }));
  const combinedShare = shares[0] + shares[1];
  const ahead = others.filter((o) => o.share > combinedShare).sort((a, b) => b.share - a.share);
  const combinedRank = ahead.length + 1;
  const list: ShareRow[] = [
    ...others.map((o) => ({ name: shortBankName(o.name), share: o.share, combined: false })),
    { name: `${shortBankName(names[0])} + ${shortBankName(names[1])}`, share: combinedShare, combined: true, parts: shares },
  ].sort((a, b) => b.share - a.share);
  const cutoff = Math.max(7, combinedRank);
  const rows = list.slice(0, cutoff);
  return {
    fips: market.fips,
    place,
    combinedRank,
    combinedShare,
    shares,
    holders: market.holders.length,
    ahead: ahead.map((a) => shortBankName(a.name)),
    pre: before.hhi,
    post: after.hhi,
    depositsK: dep(ids[0]) + dep(ids[1]),
    rows,
  };
}

function rankPhrase(f: MarketFinding): string {
  if (f.combinedRank === 1) return `hold the most deposits, ${Math.round(f.combinedShare)}% of them`;
  const behind = f.ahead.length <= 2 ? listJoin(f.ahead) : `${countWord(f.ahead.length)} larger holders`;
  return `rank ${ordinal(f.combinedRank)}, behind ${behind}`;
}

/** The latest quarter both banks filed. */
function commonLatest(fin: [QuarterRecord[], QuarterRecord[]]): string | null {
  const b = new Set(fin[1].map((q) => q.date));
  const both = fin[0].map((q) => q.date).filter((d) => b.has(d));
  return both.length ? both[both.length - 1] : null;
}

function previousQuarter(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (m === 3) return `${y - 1}-12-31`;
  const pm = m - 3;
  return `${y}-${String(pm).padStart(2, "0")}-${pm === 6 || pm === 9 ? 30 : 31}`;
}

/** Sum of the four quarters ending at `end`; null unless all four are on file. */
export function trailingFour(quarters: QuarterRecord[], end: string, pick: (q: QuarterRecord) => number | null): number | null {
  let date = end;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const q = quarters.find((r) => r.date === date);
    const v = q ? pick(q) : null;
    if (v == null) return null;
    sum += v;
    date = previousQuarter(date);
  }
  return sum;
}

const pctFmt = (digits: number) => (v: number) => `${v.toFixed(digits)}%`;

function profileTitle(rows: { roa: [number | null, number | null]; eff: [number | null, number | null]; t1: [number | null, number | null] }, short: [string, string]): string {
  const claims: Array<{ bank: 0 | 1; phrase: string }> = [];
  const pick = (v: [number | null, number | null], higherWins: boolean, min: number): 0 | 1 | null => {
    if (v[0] == null || v[1] == null || Math.abs(v[0] - v[1]) < min) return null;
    return (v[0] > v[1]) === higherWins ? 0 : 1;
  };
  const roa = pick(rows.roa, true, 0.05);
  if (roa != null) claims.push({ bank: roa, phrase: "earns more on its assets" });
  const eff = pick(rows.eff, false, 1);
  if (eff != null) claims.push({ bank: eff, phrase: "at a lower cost" });
  const t1 = pick(rows.t1, true, 0.25);
  if (t1 != null) claims.push({ bank: t1, phrase: "holds more capital" });
  if (claims.length === 0) return "The two banks look much alike on returns, cost and capital";
  const sentence = (bank: 0 | 1) => {
    const own = claims.filter((c) => c.bank === bank).map((c) => c.phrase);
    if (own.length === 0) return null;
    // "at a lower cost" follows "earns more on its assets"; on its own it needs a verb.
    const parts =
      own[0] === "earns more on its assets" && own[1] === "at a lower cost"
        ? [`${own[0]} ${own[1]}`, ...own.slice(2)]
        : own.map((p) => (p === "at a lower cost" ? "runs at a lower cost" : p));
    return `${short[bank]} ${listJoin(parts)}`;
  };
  return [sentence(claims[0].bank), sentence(claims[0].bank === 0 ? 1 : 0)].filter(Boolean).join("; ");
}

function earningsTitle(series: [QuarterPoint[], QuarterPoint[]], short: [string, string]): string | null {
  const grew = series.map((s) => (s.length >= 2 ? s[s.length - 1].value > s[0].value : null));
  if (grew[0] == null || grew[1] == null) return null;
  const since = series[0][0].date.slice(0, 4);
  if (grew[0] && grew[1]) return `Both banks have grown quarterly earnings since ${since}`;
  if (!grew[0] && !grew[1]) return `Neither bank earns more a quarter than it did early in ${since}`;
  const up = grew[0] ? 0 : 1;
  return `${short[up]} has grown quarterly earnings since ${since}; ${short[up ? 0 : 1]} earns less a quarter than it did then`;
}

/** The largest quarter-on-quarter rise in assets, when one bank's grew by more than a quarter. */
function assetJump(series: [QuarterPoint[], QuarterPoint[]], short: [string, string]): LineNote | null {
  let best: { bank: 0 | 1; prev: QuarterPoint; cur: QuarterPoint; rise: number } | null = null;
  series.forEach((s, bank) => {
    for (let i = 1; i < s.length; i++) {
      const rise = s[i - 1].value > 0 ? s[i].value / s[i - 1].value - 1 : 0;
      if (rise > 0.25 && (!best || rise > best.rise)) best = { bank: bank as 0 | 1, prev: s[i - 1], cur: s[i], rise };
    }
  });
  if (!best) return null;
  const b = best as { bank: 0 | 1; prev: QuarterPoint; cur: QuarterPoint };
  return {
    date: b.cur.date,
    value: b.cur.value,
    lines: [`${quarterLabel(b.cur.date)}: ${short[b.bank]}'s assets`, `rose from ${moneyK(b.prev.value)} to ${moneyK(b.cur.value)}`],
    below: true,
  };
}

/** The first quarter with a loss, the subject's first. */
function lossNote(series: [QuarterPoint[], QuarterPoint[]], short: [string, string]): LineNote | null {
  for (const bank of [0, 1] as const) {
    const p = series[bank].find((q) => q.value < 0);
    if (p) return { date: p.date, value: p.value, lines: [`${quarterLabel(p.date)}: ${short[bank]} ${moneyK(p.value)}`], below: true };
  }
  return null;
}

function sentenceCase(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z]{2,}$/.test(word.replace(/[^A-Za-z]/g, "")) ? word : word.toLowerCase()))
    .join(" ");
}

export function feeRows(fees: [FeeAmounts, FeeAmounts]): FeeRow[] {
  const shared = Object.keys(fees[0]).filter((c) => fees[1][c]?.length && fees[0][c]?.length);
  return shared
    .map((category) => {
      const values: [number, number] = [institutionValue(category, fees[0][category]), institutionValue(category, fees[1][category])];
      const several: [boolean, boolean] = [new Set(fees[0][category]).size > 1, new Set(fees[1][category]).size > 1];
      return { category, label: getDisplayName(category), values, several };
    })
    .sort((a, b) => Math.abs(b.values[0] - b.values[1]) - Math.abs(a.values[0] - a.values[1]) || a.label.localeCompare(b.label));
}

function stateList(branches: MergerBranch[]): string[] {
  const dep = new Map<string, number>();
  for (const b of branches) dep.set(b.fips.slice(0, 2), (dep.get(b.fips.slice(0, 2)) ?? 0) + b.depositsK);
  return [...dep.entries()].sort((a, b) => b[1] - a[1]).map(([st]) => STATE_NAMES_BY_FIPS[st] ?? FIPS_TO_STATE[st] ?? st);
}

const STATE_NAMES_BY_FIPS: Record<string, string> = {
  "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California", "08": "Colorado", "09": "Connecticut",
  "10": "Delaware", "11": "the District of Columbia", "12": "Florida", "13": "Georgia", "15": "Hawaii", "16": "Idaho", "17": "Illinois",
  "18": "Indiana", "19": "Iowa", "20": "Kansas", "21": "Kentucky", "22": "Louisiana", "23": "Maine", "24": "Maryland",
  "25": "Massachusetts", "26": "Michigan", "27": "Minnesota", "28": "Mississippi", "29": "Missouri", "30": "Montana",
  "31": "Nebraska", "32": "Nevada", "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York",
  "37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma", "41": "Oregon", "42": "Pennsylvania",
  "44": "Rhode Island", "45": "South Carolina", "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah",
  "50": "Vermont", "51": "Virginia", "53": "Washington", "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming",
};

const SOURCE_CALL = "FFIEC call reports via the FDIC";

/** Build the whole screen from the data read for the pair. */
export function buildMergerScreen(data: MergerScreenData): MergerScreen {
  const names: [string, string] = [data.banks[0].name, data.banks[1].name];
  let short: [string, string] = [shortBankName(names[0]), shortBankName(names[1])];
  if (short[0] === short[1]) short = names;
  const ids: [number, number] = [data.banks[0].id, data.banks[1].id];
  const sodDate = data.sodYear ? `June 30, ${data.sodYear}` : null;
  const legendBanks = [...names];

  // Footprint and markets.
  const countiesOf = (bank: 0 | 1) => new Set(data.branches.filter((b) => b.bank === bank).map((b) => b.fips));
  const second = countiesOf(1);
  const overlap = [...countiesOf(0)].filter((f) => second.has(f));
  const findings = data.sodYear
    ? data.markets.map((m) => marketFinding(m, ids, names, data.sodYear!)).filter((f): f is MarketFinding => f != null).sort((a, b) => b.depositsK - a.depositsK)
    : [];
  const lead = findings[0] ?? null;
  const offices = [0, 1].map((k) => data.branches.filter((b) => b.bank === k).length);

  // Financials.
  const latest = commonLatest(data.financials);
  const at = (bank: 0 | 1) => (latest ? data.financials[bank].find((q) => q.date === latest) ?? null : null);
  const qa = at(0);
  const qb = at(1);
  const ttmNi = latest ? data.financials.map((f) => trailingFour(f, latest, (q) => q.netIncome)) : [null, null];
  const ttmSc = latest ? data.financials.map((f) => trailingFour(f, latest, (q) => q.serviceCharges)) : [null, null];

  // Cover.
  const heroes: HeroFigure[] = [];
  if (qa?.assets != null && qb?.assets != null) {
    const sum = qa.assets + qb.assets;
    heroes.push({ figure: `$${(sum / 1e6).toFixed(1)}`, unit: "B", label: `Combined assets, ${dayLabel(latest!)}`, detail: `${short[0]} ${moneyK(qa.assets)} · ${short[1]} ${moneyK(qb.assets)}` });
  }
  if (qa?.deposits != null && qb?.deposits != null) {
    const sum = qa.deposits + qb.deposits;
    heroes.push({
      figure: `$${(sum / 1e6).toFixed(2)}`,
      unit: "B",
      label: "Combined deposits",
      detail: data.branches.length ? `${offices[0] + offices[1]} branches (${offices[0]} + ${offices[1]})` : "Branch count not on file",
    });
  }
  if (ttmNi[0] != null && ttmNi[1] != null) {
    const sum = ttmNi[0] + ttmNi[1];
    heroes.push({ figure: `${sum < 0 ? MINUS : ""}$${Math.round(Math.abs(sum) / 1000)}`, unit: "M", label: "Combined net income, last four quarters", detail: "Before any merger costs or savings" });
  }
  if (lead) {
    heroes.push({
      figure: lead.post.toLocaleString("en-US"),
      label: `${lead.place} HHI after combining`,
      detail: `${lead.post >= lead.pre ? "Up" : "Down"} ${Math.abs(lead.post - lead.pre).toLocaleString("en-US")} from ${lead.pre.toLocaleString("en-US")}`,
    });
  }

  const states = stateList(data.branches);
  const deckParts: string[] = [];
  if (qa?.assets != null && qb?.assets != null) {
    const billions = (qa.assets + qb.assets) / 1e6;
    const amount = billions >= 1 ? `$${billions >= 10 ? Math.round(billions) : Math.round(billions * 10) / 10} billion` : `$${Math.round(billions * 1000)} million`;
    deckParts.push(`Together they would hold about ${amount} in assets${states.length ? ` across branches in ${states.length <= 5 ? listJoin(states) : `${states.slice(0, 4).join(", ")} and ${countWord(states.length - 4)} other states`}` : ""}.`);
  }
  if (!data.sodYear || data.branches.length === 0) deckParts.push("Branch deposit figures for the pair are not loaded, so their footprints are not compared.");
  else if (overlap.length === 0) deckParts.push("Their branch footprints do not share a county.");
  else if (overlap.length === 1 && lead) deckParts.push(`Their footprints meet only in ${lead.place}, where the combined bank would ${rankPhrase(lead)}.`);
  else if (lead) deckParts.push(`Their footprints overlap in ${countWord(overlap.length)} counties; in ${lead.place}, the largest, the combined bank would ${rankPhrase(lead)}.`);

  const exhibits: MergerExhibit[] = [];

  // Exhibit 1.
  const mapHtml = responsive((size) => footprintMap({ names, branches: data.branches, overlap }, size));
  const shadeNote =
    overlap.length === 0
      ? "No county has branches of both."
      : overlap.length === 1
        ? `${countyName(overlap[0])}, the one county where both have branches, is shaded.`
        : `The ${countWord(overlap.length)} counties where both have branches are shaded.`;
  exhibits.push({
    key: "footprint",
    kicker: "Exhibit 1 · Footprint",
    title:
      data.branches.length === 0
        ? "Branch locations are not on file for this pair"
        : overlap.length === 0
          ? "The branch networks do not share a county"
          : overlap.length === 1
            ? "The branch networks touch in one county"
            : `The branch networks overlap in ${countWord(overlap.length)} counties`,
    sub: data.branches.length ? `Every branch of both banks, sized by deposits. ${shadeNote}` : null,
    legend: data.branches.length ? [...legendBanks, "Circle area shows deposits"] : null,
    panels: mapHtml ? [{ heading: null, html: mapHtml }] : [],
    notice: mapHtml ? null : "The FDIC Summary of Deposits has no located branches for these two banks yet, so there is no map.",
    source: `FDIC Summary of Deposits${sodDate ? `, ${sodDate}` : ""}. Offices with no reported deposits are drawn at the smallest size.`,
  });

  // Exhibit 2.
  const ratio = (num: number | null | undefined, den: number | null | undefined, scale: number) => (num != null && den ? (num / den) * scale : null);
  const profile: ProfileRow[] = [
    { label: "Return on assets", hint: "higher earns more", values: [qa?.roa ?? null, qb?.roa ?? null], format: pctFmt(2), domain: [0, 2.5] },
    { label: "Efficiency ratio", hint: "lower costs less", values: [qa?.efficiency ?? null, qb?.efficiency ?? null], format: pctFmt(1), domain: [0, 100] },
    { label: "Net interest margin", values: [qa?.nim ?? null, qb?.nim ?? null], format: pctFmt(2), domain: [0, 5] },
    { label: "Tier 1 capital ratio", values: [qa?.tier1 ?? null, qb?.tier1 ?? null], format: pctFmt(1), domain: [0, 16] },
    { label: "Fee income per $1,000 of deposits", values: [ratio(ttmSc[0], qa?.deposits, 1000), ratio(ttmSc[1], qb?.deposits, 1000)], format: (v) => `$${v.toFixed(2)}`, domain: [0, 3] },
    { label: "Uninsured share of deposits", values: [ratio(qa?.uninsured, qa?.deposits, 100), ratio(qb?.uninsured, qb?.deposits, 100)], format: pctFmt(0), domain: [0, 40] },
    { label: "Loans to deposits", values: [ratio(qa?.loans, qa?.deposits, 100), ratio(qb?.loans, qb?.deposits, 100)], format: pctFmt(0), domain: [0, 100] },
  ];
  const profileHtml = latest ? responsive((size) => profileChart(profile, names, size)) : null;
  exhibits.push({
    key: "profile",
    kicker: "Exhibit 2 · Profile",
    title: profileHtml ? profileTitle({ roa: profile[0].values, eff: profile[1].values, t1: profile[3].values }, short) : "The two banks have no call report quarter in common",
    sub: latest ? `Quarter ended ${dayLabel(latest)}. Each row's bar shows the two banks on the same scale.` : null,
    legend: profileHtml ? legendBanks : null,
    panels: profileHtml ? [{ heading: null, html: profileHtml }] : [],
    notice: profileHtml ? null : "Call report figures for a shared quarter are not on file for both banks, so they are not compared.",
    source: `${SOURCE_CALL}${latest ? `, quarter ended ${dayLabel(latest)}` : ""}. Efficiency ratio is noninterest expense over revenue; lower is better. Fee income is deposit service charges over the last four quarters per $1,000 of deposits.`,
  });

  // Exhibit 3.
  const seriesOf = (pick: (q: QuarterRecord) => number | null): [QuarterPoint[], QuarterPoint[]] =>
    data.financials.map((f) => f.flatMap((q) => (pick(q) == null ? [] : [{ date: q.date, value: pick(q)! }]))) as [QuarterPoint[], QuarterPoint[]];
  const ni = seriesOf((q) => q.netIncome);
  const assets = seriesOf((q) => q.assets);
  const niHtml = responsive((size) => quarterLines(ni, names, { format: moneyK, label: "Net income per quarter", note: lossNote(ni, short) }, size));
  const assetHtml = responsive((size) => quarterLines(assets, names, { format: moneyK, label: "Total assets", note: assetJump(assets, short) }, size));
  const allDates = [...new Set([...ni[0], ...ni[1]].map((p) => p.date))].sort();
  exhibits.push({
    key: "earnings",
    kicker: "Exhibit 3 · Earnings",
    title: earningsTitle(ni, short) ?? "Quarterly earnings are not on file for both banks",
    sub: null,
    legend: niHtml || assetHtml ? legendBanks : null,
    panels: [
      ...(niHtml ? [{ heading: "Net income per quarter", html: niHtml }] : []),
      ...(assetHtml ? [{ heading: "Total assets", html: assetHtml }] : []),
    ],
    notice: niHtml || assetHtml ? null : "No call report quarters since 2024 are on file for these banks.",
    source: `${SOURCE_CALL}${allDates.length ? `, quarters ended ${dayLabel(allDates[0])} to ${dayLabel(allDates[allDates.length - 1])}` : ""}.`,
  });

  // Exhibit 4.
  const shown = findings.slice(0, 8);
  const sharesHtml = lead ? responsive((size) => shareBars(lead.rows, size)) : null;
  const hhiHtml = shown.length ? responsive((size) => hhiChart(shown.map((f) => ({ place: f.place, pre: f.pre, post: f.post })), size)) : null;
  const biggest = findings.length ? findings.reduce((m, f) => (f.post - f.pre > m.post - m.pre ? f : m)) : null;
  const highAfter = findings.filter((f) => f.post > HHI_HIGH && f.post - f.pre > 100).length;
  let compTitle: string;
  if (!data.sodYear || data.branches.length === 0) compTitle = "Local deposit shares are not on file for this pair";
  else if (!lead) compTitle = "With no shared county, the pair does not change any local market's concentration";
  else if (findings.length === 1) compTitle = `In ${lead.place} the combined bank would ${rankPhrase(lead)}`;
  else compTitle = `In ${lead.place}, their largest shared county, the combined bank would ${rankPhrase(lead)}`;
  const compSub = lead
    ? findings.length === 1
      ? `${lead.holders} institutions hold deposits there. Combining would move the HHI from ${lead.pre.toLocaleString("en-US")} to ${lead.post.toLocaleString("en-US")}, ${hhiWord(lead.post)}.`
      : `${findings.length > shown.length ? `The chart shows the ${shown.length} of ${findings.length} shared counties where the two banks hold the most deposits.` : `The chart shows all ${findings.length} shared counties.`} The largest rise in HHI is ${biggest!.post - biggest!.pre}, in ${biggest!.place} (${biggest!.pre.toLocaleString("en-US")} to ${biggest!.post.toLocaleString("en-US")}). ${highAfter === 0 ? "No shared county would end" : `${countWord(highAfter).replace(/^./, (c) => c.toUpperCase())} shared ${highAfter === 1 ? "county would end" : "counties would end"}`} above ${HHI_HIGH.toLocaleString("en-US")} with a rise of more than 100.`
    : null;
  exhibits.push({
    key: "competition",
    kicker: "Exhibit 4 · Competition",
    title: compTitle,
    sub: compSub,
    legend: null,
    panels: [
      ...(sharesHtml && lead ? [{ heading: `Share of ${lead.place} deposits`, html: sharesHtml }] : []),
      ...(hhiHtml ? [{ heading: findings.length > 1 ? "Market concentration (HHI) by shared county" : "Market concentration (HHI)", html: hhiHtml }] : []),
    ],
    notice: sharesHtml || hhiHtml ? null : lead || !data.sodYear || data.branches.length === 0 ? "Branch deposit figures for the shared counties are not on file." : "The two banks have no branches in the same county, so no local market changes hands.",
    source: `FDIC Summary of Deposits${sodDate ? `, ${sodDate}` : ""}, all branches in each county. HHI is the sum of squared deposit shares. The 2023 federal merger guidelines call a market of ${HHI_MODERATE.toLocaleString("en-US")} to ${HHI_HIGH.toLocaleString("en-US")} moderately concentrated and above ${HHI_HIGH.toLocaleString("en-US")} highly concentrated, and presume harm where a highly concentrated market rises by more than 100.`,
  });

  // Exhibit 5.
  const fees = feeRows(data.fees);
  const feeHtml = responsive((size) => feeChart(fees, names, size));
  const differing = fees.filter((r) => Math.abs(r.values[0] - r.values[1]) >= 0.005);
  const feeCounts = [Object.keys(data.fees[0]).length, Object.keys(data.fees[1]).length];
  let feeTitle: string;
  if (fees.length === 0) {
    const missing = [0, 1].filter((k) => feeCounts[k] === 0).map((k) => short[k]);
    feeTitle = missing.length ? `${listJoin(missing)} ${missing.length > 1 ? "have" : "has"} no published fees in the index yet` : "The two banks publish no fee in common";
  } else if (differing.length === 0) feeTitle = "The two fee schedules match on every fee both publish";
  else feeTitle = `The two fee schedules differ most on ${listJoin(differing.slice(0, 3).map((r) => sentenceCase(r.label)))}`;
  const several = fees.some((r) => r.several.some(Boolean));
  exhibits.push({
    key: "fees",
    kicker: "Exhibit 5 · Fees",
    title: feeTitle,
    sub: fees.length ? `Every fee both banks publish, largest difference first. A combined bank would carry one schedule.` : null,
    legend: feeHtml ? legendBanks : null,
    panels: feeHtml ? [{ heading: null, html: feeHtml }] : [],
    notice: feeHtml
      ? null
      : feeCounts[0] === 0 || feeCounts[1] === 0
        ? `The Bank Fee Index has no verified fee schedule for ${listJoin([0, 1].filter((k) => feeCounts[k] === 0).map((k) => names[k]))} yet, so the schedules are not compared.`
        : "The two banks' published fee schedules have no fee in common.",
    source: `Bank Fee Index published fees, each from the bank's own current fee schedule. A $0 fee is shown as the bank published it.${several ? " * The bank lists more than one price for this fee; the dot shows its middle price (for overdraft, its standard, highest price)." : ""}`,
  });

  return {
    names,
    shortNames: short,
    title: `${names[0]} and ${names[1]}`,
    deck: deckParts.join(" "),
    heroes,
    exhibits,
  };
}

// ─── Page styles ─────────────────────────────────────────────────────────────

/**
 * The screen's own stylesheet: one report column of exhibit cards. Charts are drawn twice;
 * `.sc-wide` shows on desktop and paper, `.sc-narrow` on a phone. Each exhibit stays whole on
 * paper and its heading never ends a page.
 */
/** The screen in the shared report design: the two banks keep their colours in every legend. */
export function mergerDocument(screen: MergerScreen): RdDocument {
  return {
    eyebrow: "Hamilton · Merger screen",
    title: screen.title,
    deck: screen.deck,
    heroes: screen.heroes.map((h) => ({ figure: h.figure, unit: h.unit, label: h.label, note: h.detail })),
    exhibits: screen.exhibits.map((ex) => ({
      key: ex.key,
      label: ex.kicker,
      title: ex.title,
      sub: ex.sub,
      legend: ex.legend?.map((label, i) => (i < 2 ? { label, color: BANK_COLORS[i], mark: "dot" as const } : { label })),
      panels: ex.panels.map((p) => ({ heading: p.heading ?? undefined, html: p.html })),
      notice: ex.notice,
      source: ex.source,
    })),
  };
}
