/**
 * Designed SVG exhibits for the State Index report: a county map, a fee ladder with every
 * institution as a dot, the state's largest deposit holders, a banks-against-credit-unions
 * dumbbell and annotated lines. Pure functions returning SVG strings, drawn in the shared chart
 * style (src/lib/charts/style.ts). Every mark sits on one scale per chart; nothing is invented
 * when data is missing, the chart says so instead.
 */
import { geoConicConformal, geoPath, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countiesTopology from "us-atlas/counties-10m.json";
import { CHART, CHART_FONTS } from "@/lib/charts/style";
import { escapeHtml } from "./components";

const W = 960;
/** Phone drawing width: drawn near the screen's own width so type stays at its set size. */
export const NARROW_W = 400;

/** Draw a chart for paper and desktop (960 wide) or for a phone (NARROW_W wide). */
export interface ChartSize {
  narrow?: boolean;
}

const fmtMoney = (v: number): string => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();

function text(x: number, y: number, body: string, opts: { size?: number; anchor?: "start" | "middle" | "end"; weight?: number; font?: keyof typeof CHART_FONTS; fill?: string; halo?: boolean } = {}): string {
  const font = CHART_FONTS[opts.font ?? "sans"].replace(/"/g, "'");
  const halo = opts.halo ? ` stroke="${CHART.paper}" stroke-width="3" paint-order="stroke"` : "";
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${font}" font-size="${opts.size ?? 11}" text-anchor="${opts.anchor ?? "start"}"${opts.weight ? ` font-weight="${opts.weight}"` : ""} fill="${opts.fill ?? CHART.inkSoft}"${halo}>${escapeHtml(body)}</text>`;
}

function svgWrap(height: number, body: string, label: string, width = W): string {
  return `<svg class="state-chart" viewBox="0 0 ${width} ${Math.ceil(height)}" width="100%" role="img" aria-label="${escapeHtml(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── County map ───────────────────────────────────────────────────────────────

export interface CountyValue {
  fips: string;
  /** Deposit-weighted overdraft fee; null when no branch in the county has one on file. */
  value: number | null;
  deposits: number;
  covered_deposits: number;
}

/** Fee steps shared by every state, so two state maps can be read side by side. */
export const MAP_BREAKS = [26, 29, 31, 33, 35] as const;
export const MAP_LEGEND = ["Under $26", "$26 to $29", "$29 to $31", "$31 to $33", "$33 to $35", "$35 and up"] as const;
const MAP_LABELS = 4;

type CountyFeature = Feature<Geometry, { name: string }> & { id: string };

let countyCache: CountyFeature[] | null = null;
function allCounties(): CountyFeature[] {
  if (!countyCache) {
    const topo = countiesTopology as unknown as Topology<{ counties: GeometryCollection<{ name: string }> }>;
    countyCache = (feature(topo, topo.objects.counties) as FeatureCollection<Geometry, { name: string }>).features.map((f) => ({
      ...f,
      id: String(f.id).padStart(5, "0"),
    })) as CountyFeature[];
  }
  return countyCache;
}

export function mapStep(value: number): number {
  return MAP_BREAKS.filter((b) => value >= b).length;
}

/**
 * The state's counties shaded by the overdraft fee at their branches. Counties with no
 * covered branch are hatched. The largest counties by deposits carry their name and fee.
 */
export function countyFeeMap(stateFips: string, counties: CountyValue[], size: ChartSize = {}): string | null {
  const w = size.narrow ? NARROW_W : W;
  const hatchId = `state-map-hatch-${size.narrow ? "n" : "w"}-${stateFips}`;
  const fontSize = size.narrow ? 13 : 12;
  const features = allCounties().filter((f) => f.id.startsWith(stateFips));
  if (features.length === 0) return null;
  const collection: FeatureCollection<Geometry, { name: string }> = { type: "FeatureCollection", features };
  const [lon, lat] = geoCentroid(collection);
  const projection = geoConicConformal().rotate([-lon, 0]).parallels([lat - 2, lat + 2]);
  // Fit the width first to find the state's shape, then cap the height.
  projection.fitWidth(w - 8, collection);
  const fit = geoPath(projection).bounds(collection);
  const h = size.narrow ? Math.min(460, Math.max(150, fit[1][1] - fit[0][1])) : Math.min(560, Math.max(220, fit[1][1] - fit[0][1]));
  projection.fitExtent([[4, 4], [w - 4, h - 4]], collection);
  const path = geoPath(projection).digits(1);
  const byFips = new Map(counties.map((c) => [c.fips, c]));

  const shapes = features
    .map((f) => {
      const c = byFips.get(f.id);
      const fill = c && c.value !== null ? CHART.ramp[mapStep(c.value)] : `url(#${hatchId})`;
      return `<path d="${path(f) ?? ""}" fill="${fill}" stroke="${CHART.paper}" stroke-width="0.8"><title>${escapeHtml(
        `${f.properties.name}: ${c && c.value !== null ? fmtMoney(Math.round(c.value * 100) / 100) : "no verified overdraft fee yet"}`,
      )}</title></path>`;
    })
    .join("");

  // Label the largest counties by deposits, skipping any label that would overlap one already
  // placed (neighbouring metro counties sit close together).
  const boxes: Array<[number, number, number, number]> = [];
  const labelled = [...counties]
    .filter((c) => c.value !== null)
    .sort((a, b) => b.deposits - a.deposits)
    .flatMap((c) => {
      if (boxes.length >= (size.narrow ? 3 : MAP_LABELS)) return [];
      const f = features.find((x) => x.id === c.fips);
      if (!f) return [];
      const [x, y] = path.centroid(f);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      const label = `${f.properties.name} ${fmtMoney(Math.round(c.value! * 100) / 100)}`;
      const width = label.length * fontSize * 0.6;
      const edge = Math.min(120, width / 2 + 4);
      const anchor = x > w - edge ? "end" : x < edge ? "start" : "middle";
      const left = anchor === "end" ? x - width : anchor === "start" ? x : x - width / 2;
      const box: [number, number, number, number] = [left - 4, y - 21, left + width + 4, y + 4];
      if (boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) return [];
      boxes.push(box);
      return [`<circle cx="${r1(x)}" cy="${r1(y)}" r="2.6" fill="${CHART.ink}"/>${text(x, y - 7, label, { size: fontSize, weight: 600, fill: CHART.ink, anchor, halo: true })}`];
    })
    .join("");

  const hatch = `<defs><pattern id="${hatchId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${CHART.paper}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${CHART.noData}" stroke-width="2.4"/></pattern></defs>`;
  return svgWrap(h, hatch + shapes + labelled, "Overdraft fee by county", w);
}

export function mapLegend(): string {
  const swatch = (fill: string) => `<svg width="16" height="12" aria-hidden="true"><rect width="16" height="12" fill="${fill}"/></svg>`;
  const items = CHART.ramp.map((c, i) => `<span>${swatch(c)}${MAP_LEGEND[i]}</span>`);
  items.push(
    `<span><svg width="16" height="12" aria-hidden="true"><defs><pattern id="state-legend-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="${CHART.paper}"/><line x1="0" y1="0" x2="0" y2="5" stroke="${CHART.noData}" stroke-width="2"/></pattern></defs><rect width="16" height="12" fill="url(#state-legend-hatch)" stroke="${CHART.rule2}"/></svg>No verified fee yet</span>`,
  );
  return `<div class="state-chart-legend">${items.join("")}</div>`;
}

// ─── Fee ladder ───────────────────────────────────────────────────────────────

export interface LadderPoint {
  value: number;
  charter: "bank" | "credit_union";
  name: string;
}

export interface LadderRow {
  label: string;
  points: LadderPoint[];
  /** Nationwide middle half and median, when the index has them. */
  national: { p25: number; median: number; p75: number } | null;
}

const LADDER_LABEL = 230;
const DOT = 4.2;
const DOT_STEP = 2 * DOT + 0.8;

/** Shared dollar scale: the next $5 above the largest value shown. */
export function ladderMax(rows: LadderRow[]): number {
  const top = Math.max(0, ...rows.flatMap((r) => [...r.points.map((p) => p.value), r.national?.p75 ?? 0]));
  return Math.max(10, Math.ceil((top + 0.01) / 5) * 5);
}

/** Dots stacked above and below the line before a tie spreads into side-by-side columns. */
const LADDER_STACK = 4;

/**
 * Every institution as a dot on one dollar scale, one row per fee. Tied amounts stack up to
 * LADDER_STACK dots each side of the line, then spread into columns a dot apart, so a row's
 * height stays bounded however many institutions charge the same amount. Each row is its own
 * SVG on the shared scale (axis first), so a long ladder breaks between rows on paper.
 */
export function feeLadder(rows: LadderRow[], stateCode: string, size: ChartSize = {}): string | null {
  const shown = rows.filter((r) => r.points.length > 0);
  if (shown.length === 0) return null;
  const max = ladderMax(shown);
  // On a phone the labels sit above each strip, and the strip takes the full width.
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW_W : W;
  const left = narrow ? 12 : LADDER_LABEL;
  const right = narrow ? 14 : 24;
  const top = narrow ? 52 : 0;
  const x = (v: number) => left + (v / max) * (w - left - right);
  const tick = max > 60 ? 20 : max > 30 ? 10 : 5;
  const perColumn = 2 * LADDER_STACK + 1;
  const grid = (h: number) => {
    let g = "";
    for (let v = 0; v <= max; v += tick) g += `<line x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${top}" y2="${h}" stroke="${CHART.rule}" stroke-width="1"/>`;
    return g;
  };

  let axis = "";
  const axisStep = narrow && (max / tick) * 30 > w - left - right ? tick * 2 : tick;
  for (let v = 0; v <= max; v += axisStep) axis += text(x(v), 14, `$${v}`, { size: narrow ? 12 : 11, anchor: "middle", font: "mono" });
  const out = [`<svg class="state-chart state-ladder-axis" viewBox="0 0 ${w} 20" width="100%" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${axis}</svg>`];

  for (const row of shown) {
    const groups = new Map<number, LadderPoint[]>();
    for (const p of [...row.points].sort((a, b) => a.value - b.value)) {
      const list = groups.get(p.value) ?? [];
      list.push(p);
      groups.set(p.value, list);
    }
    let maxStack = 0;
    const placed: Array<LadderPoint & { dx: number; k: number }> = [];
    for (const list of groups.values()) {
      list.sort((a, b) => Number(a.charter === "bank") - Number(b.charter === "bank"));
      const columns = Math.ceil(list.length / perColumn);
      list.forEach((p, i) => {
        const col = Math.floor(i / perColumn);
        const j = i % perColumn;
        placed.push({ ...p, dx: (col - (columns - 1) / 2) * DOT_STEP, k: j % 2 ? -Math.ceil(j / 2) : Math.ceil(j / 2) });
      });
      maxStack = Math.max(maxStack, Math.ceil(Math.min(list.length, perColumn) / 2));
    }
    const half = Math.max(30, maxStack * DOT_STEP + 6);
    const h = top + half * 2 + 12;
    const cy = top + half + 4;
    let body = grid(h);
    if (row.national) {
      body += `<rect x="${r1(x(row.national.p25))}" y="${r1(cy - half + 4)}" width="${r1(Math.max(2, x(row.national.p75) - x(row.national.p25)))}" height="${r1(half * 2 - 8)}" fill="${CHART.band}"/>`;
      body += `<rect x="${r1(x(row.national.median) - 1)}" y="${r1(cy - half + 2)}" width="2" height="${r1(half * 2 - 4)}" fill="${CHART.ink}"/>`;
    }
    const stateMedian = median(row.points.map((p) => p.value))!;
    const high = row.points.reduce((a, b) => (b.value > a.value ? b : a));
    const highAmount = ` ${fmtMoney(high.value)}`;
    const room = (narrow ? 46 : 40) - "Highest: ".length - highAmount.length;
    const highName = high.name.length > room ? `${high.name.slice(0, room - 1).trimEnd()}…` : high.name;
    const stats = `${stateCode} ${fmtMoney(stateMedian)}${row.national ? ` · U.S. ${fmtMoney(row.national.median)}` : ""} · ${row.points.length}`;
    if (narrow) {
      body += text(0, 17, row.label, { size: 16, font: "serif", fill: CHART.ink, weight: 500 });
      body += text(0, 33, stats, { size: 12.5, font: "mono" });
      body += text(0, 48, `Highest: ${highName}${highAmount}`, { size: 12 });
    } else {
      body += text(0, cy - 8, row.label, { size: 14, font: "serif", fill: CHART.ink, weight: 500 });
      body += text(0, cy + 9, stats, { size: 11.5, font: "mono" });
      body += text(0, cy + 24, `Highest: ${highName}${highAmount}`, { size: 11 });
    }
    for (const p of placed) {
      const cx = r1(x(p.value) + p.dx);
      const py = r1(cy + p.k * DOT_STEP);
      const tip = `<title>${escapeHtml(`${p.name}: ${fmtMoney(p.value)}`)}</title>`;
      body +=
        p.charter === "bank"
          ? `<circle cx="${cx}" cy="${py}" r="${DOT}" fill="${CHART.terra}">${tip}</circle>`
          : `<circle cx="${cx}" cy="${py}" r="${DOT - 0.5}" fill="${CHART.paper}" stroke="${CHART.ink}" stroke-width="1.3">${tip}</circle>`;
    }
    body += `<line x1="0" x2="${w}" y1="${h - 1}" y2="${h - 1}" stroke="${CHART.rule}"/>`;
    out.push(
      `<svg class="state-chart state-ladder-row" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${escapeHtml(`${row.label}: every institution's fee`)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
    );
  }
  return `<div class="state-ladder">${out.join("")}</div>`;
}

export function ladderLegend(): string {
  return `<div class="state-chart-legend">
<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="${CHART.terra}"/></svg>Bank</span>
<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="${CHART.paper}" stroke="${CHART.ink}" stroke-width="1.4"/></svg>Credit union</span>
<span><svg width="26" height="12" aria-hidden="true"><rect x="0" y="2" width="26" height="8" fill="${CHART.band}"/></svg>Middle half, U.S.</span>
<span><svg width="10" height="14" aria-hidden="true"><rect x="4" y="0" width="2" height="14" fill="${CHART.ink}"/></svg>U.S. median</span>
</div>`;
}

// ─── Deposit holders ──────────────────────────────────────────────────────────

export interface HolderRow {
  name: string;
  /** Deposits at branches in the state, in dollars. */
  deposits: number;
  homeState: boolean;
  hqState: string | null;
  overdraft: number | null;
}

function shortName(name: string): string {
  return name
    .replace(/,? National Association$/i, "")
    .replace(/,? N\.A\.$/i, "")
    .replace(/Federal Credit Union/i, "FCU")
    .replace(/^The /, "");
}

function dollarsShort(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

/** The largest holders of the state's deposits, each with its published overdraft fee or "not yet". */
export function depositHolders(rows: HolderRow[], stateName: string, size: ChartSize = {}): string | null {
  if (rows.length === 0) return null;
  if (size.narrow) return depositHoldersNarrow(rows, stateName);
  const L = 250;
  const FEE = 110;
  const BAR = W - L - FEE - 150;
  const rh = 30;
  const max = Math.max(...rows.map((r) => r.deposits)) || 1;
  let out = text(L, 12, `Deposits at ${stateName} branches`, { size: 11, font: "mono" }) + text(W - 2, 12, "Overdraft fee", { size: 11, font: "mono", anchor: "end" });
  rows.forEach((r, i) => {
    const y = 26 + i * rh;
    const w = Math.max(2, (BAR * r.deposits) / max);
    out += text(L - 12, y + 14, shortName(r.name).slice(0, 34), { size: 13, anchor: "end", fill: CHART.ink, weight: 500 });
    out += `<rect x="${L}" y="${y + 3}" width="${r1(w)}" height="${rh - 12}" fill="${r.homeState ? CHART.ink : CHART.muted}"/>`;
    out += text(L + w + 8, y + 15, `${dollarsShort(r.deposits)}${!r.homeState && r.hqState ? `  ·  based in ${r.hqState}` : ""}`, { size: 12, font: "mono" });
    if (r.overdraft !== null) {
      out += `<circle cx="${W - 48}" cy="${y + 10}" r="11" fill="${CHART.terra}"/>`;
      out += text(W - 2, y + 15, fmtMoney(r.overdraft), { size: 13, anchor: "end", font: "mono", fill: CHART.ink, weight: 600 });
    } else {
      out += text(W - 2, y + 15, "not yet", { size: 11.5, anchor: "end" });
    }
  });
  return svgWrap(26 + rows.length * rh + 6, out, `Largest holders of ${stateName} deposits`);
}

/** Phone layout: the name above its bar, the fee at the right of the name line. */
function depositHoldersNarrow(rows: HolderRow[], stateName: string): string {
  const w = NARROW_W;
  const rh = 46;
  const BAR = w - 120;
  const max = Math.max(...rows.map((r) => r.deposits)) || 1;
  let out = text(0, 12, `Deposits at ${stateName} branches`, { size: 12, font: "mono" }) + text(w, 12, "Overdraft fee", { size: 12, font: "mono", anchor: "end" });
  rows.forEach((r, i) => {
    const y = 24 + i * rh;
    const bw = Math.max(2, (BAR * r.deposits) / max);
    out += text(0, y + 14, shortName(r.name).slice(0, 34), { size: 14, fill: CHART.ink, weight: 500 });
    out += r.overdraft !== null
      ? text(w, y + 14, fmtMoney(r.overdraft), { size: 14, anchor: "end", font: "mono", fill: CHART.terraText, weight: 700 })
      : text(w, y + 14, "not yet", { size: 12.5, anchor: "end" });
    out += `<rect x="0" y="${y + 21}" width="${r1(bw)}" height="12" fill="${r.homeState ? CHART.ink : CHART.muted}"/>`;
    out += text(bw + 6, y + 31, `${dollarsShort(r.deposits)}${!r.homeState && r.hqState ? ` · ${r.hqState}` : ""}`, { size: 12, font: "mono" });
  });
  return svgWrap(24 + rows.length * rh, out, `Largest holders of ${stateName} deposits`, w);
}

// ─── Charter dumbbells ────────────────────────────────────────────────────────

export interface CharterRow {
  label: string;
  bank: number;
  creditUnion: number;
}

/** Bank median against credit union median for each fee, with the gap written out. */
export function charterDumbbells(rows: CharterRow[], size: ChartSize = {}): string | null {
  if (rows.length === 0) return null;
  if (size.narrow) return charterDumbbellsNarrow(rows);
  const L = 230;
  const R = 200;
  const top = Math.max(...rows.flatMap((r) => [r.bank, r.creditUnion]));
  const max = Math.max(10, Math.ceil((top + 0.01) / 10) * 10);
  const x = (v: number) => L + (v / max) * (W - L - R);
  const rh = 36;
  const height = rows.length * rh + 28;
  let out = "";
  const step = max > 60 ? 20 : 10;
  for (let v = 0; v <= max; v += step) {
    out += `<line x1="${r1(x(v))}" x2="${r1(x(v))}" y1="20" y2="${height}" stroke="${CHART.rule}"/>` + text(x(v), 12, `$${v}`, { size: 11, anchor: "middle", font: "mono" });
  }
  rows.forEach((r, i) => {
    const y = 38 + i * rh;
    const lo = Math.min(r.bank, r.creditUnion);
    const hi = Math.max(r.bank, r.creditUnion);
    const gap = hi - lo;
    out += text(0, y + 5, r.label, { size: 14, font: "serif", fill: CHART.ink, weight: 500 });
    out += `<line x1="${r1(x(lo))}" x2="${r1(x(hi))}" y1="${y}" y2="${y}" stroke="${CHART.rule2}" stroke-width="4"/>`;
    out += `<circle cx="${r1(x(r.creditUnion))}" cy="${y}" r="6.5" fill="${CHART.paper}" stroke="${CHART.ink}" stroke-width="1.8"/>`;
    out += `<circle cx="${r1(x(r.bank))}" cy="${y}" r="7" fill="${CHART.terra}"/>`;
    const note = gap < 0.005 ? `both ${fmtMoney(hi)}` : `${r.bank > r.creditUnion ? "banks" : "credit unions"} ${fmtMoney(Math.round(gap * 100) / 100)} higher`;
    out += text(x(hi) + 14, y + 4, note, { size: 12, font: "mono" });
    if (gap >= 0.005) out += text(x(lo) - 12, y + 4, fmtMoney(lo), { size: 12, font: "mono", anchor: "end" });
  });
  return svgWrap(height, out, "Banks against credit unions");
}

/** Phone layout: each fee's name and gap on one line, its dumbbell on the next. */
function charterDumbbellsNarrow(rows: CharterRow[]): string {
  const w = NARROW_W;
  const left = 44;
  const right = 44;
  const top = Math.max(...rows.flatMap((r) => [r.bank, r.creditUnion]));
  const max = Math.max(10, Math.ceil((top + 0.01) / 10) * 10);
  const x = (v: number) => left + (v / max) * (w - left - right);
  const rh = 52;
  let out = "";
  rows.forEach((r, i) => {
    const y = i * rh;
    const lo = Math.min(r.bank, r.creditUnion);
    const hi = Math.max(r.bank, r.creditUnion);
    const gap = hi - lo;
    const note = gap < 0.005 ? `both ${fmtMoney(hi)}` : `${r.bank > r.creditUnion ? "banks" : "credit unions"} ${fmtMoney(Math.round(gap * 100) / 100)} higher`;
    out += text(0, y + 15, r.label, { size: 15, font: "serif", fill: CHART.ink, weight: 500 });
    out += text(w, y + 15, note, { size: 12, font: "mono", anchor: "end" });
    const cy = y + 34;
    out += `<line x1="${left}" x2="${w - right}" y1="${cy}" y2="${cy}" stroke="${CHART.rule}"/>`;
    out += `<line x1="${r1(x(lo))}" x2="${r1(x(hi))}" y1="${cy}" y2="${cy}" stroke="${CHART.rule2}" stroke-width="4"/>`;
    out += `<circle cx="${r1(x(r.creditUnion))}" cy="${cy}" r="6.5" fill="${CHART.paper}" stroke="${CHART.ink}" stroke-width="1.8"/>`;
    out += `<circle cx="${r1(x(r.bank))}" cy="${cy}" r="7" fill="${CHART.terra}"/>`;
    if (gap >= 0.005) out += text(x(lo) - 10, cy + 4, fmtMoney(lo), { size: 12, font: "mono", anchor: "end" });
    out += text(x(hi) + 10, cy + 4, fmtMoney(hi), { size: 12, font: "mono" });
  });
  return svgWrap(rows.length * rh, out, "Banks against credit unions", w);
}

export function charterLegend(): string {
  return `<div class="state-chart-legend">
<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${CHART.terra}"/></svg>Banks</span>
<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="${CHART.paper}" stroke="${CHART.ink}" stroke-width="1.6"/></svg>Credit unions</span>
</div>`;
}

// ─── Annotated lines ──────────────────────────────────────────────────────────

export interface LinePoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  value: number;
}

export interface LineSeries {
  label: string;
  points: LinePoint[];
  primary: boolean;
}

export interface LineNote {
  date: string;
  value: number;
  lines: string[];
}

const LINE_W = 460;

function monthIndex(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

/** Two lines on one scale with end labels and optional callouts. Half the report width. */
export function annotatedLines(
  series: LineSeries[],
  opts: { format: (v: number, end: boolean) => string; ticks: number[]; notes?: LineNote[]; label: string; narrow?: boolean },
): string | null {
  const LW = opts.narrow ? 380 : LINE_W;
  const fs = opts.narrow ? 1.15 : 1;
  const usable = series.filter((s) => s.points.length > 1);
  if (usable.length === 0) return null;
  const H = 250;
  const L = 38;
  const R = 58;
  const T = 14;
  const B = 26;
  const all = usable.flatMap((s) => s.points);
  const start = Math.min(...all.map((p) => monthIndex(p.date)));
  const end = Math.max(...all.map((p) => monthIndex(p.date)));
  const yMin = Math.min(...opts.ticks);
  const yMax = Math.max(...opts.ticks);
  const x = (iso: string) => L + ((monthIndex(iso) - start) / Math.max(1, end - start)) * (LW - L - R);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  let out = "";
  for (const t of opts.ticks) {
    out += `<line x1="${L}" x2="${LW - R}" y1="${r1(y(t))}" y2="${r1(y(t))}" stroke="${CHART.rule}"/>` + text(L - 6, y(t) + 4, opts.format(t, false), { size: fs * 10.5, anchor: "end", font: "mono" });
  }
  const firstYear = Math.floor(start / 12) + 1;
  for (let yr = firstYear; yr * 12 <= end; yr++) {
    out += text(x(`${yr}-01-01`), H - 8, `’${String(yr).slice(2)}`, { size: fs * 10.5, anchor: "middle", font: "mono" });
  }
  for (const s of [...usable].reverse()) {
    const color = s.primary ? CHART.terra : CHART.inkSoft;
    const width = s.primary ? 2.5 : 1.4;
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${r1(x(p.date))} ${r1(y(p.value))}`).join("");
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;
    const last = s.points[s.points.length - 1];
    out += `<circle cx="${r1(x(last.date))}" cy="${r1(y(last.value))}" r="${width + 1.2}" fill="${color}"/>`;
    out += text(x(last.date) + 6, y(last.value) + (s.primary ? 8 : -2), opts.format(last.value, true), { size: fs * 12, font: "mono", fill: CHART.ink, weight: 600 });
  }
  for (const n of opts.notes ?? []) {
    const px = x(n.date);
    const py = y(n.value);
    const left = px > LW - 170;
    out += `<line x1="${r1(px)}" y1="${r1(py)}" x2="${r1(px + (left ? -18 : 18))}" y2="${r1(py + 8)}" stroke="${CHART.inkSoft}" stroke-width="0.8"/>`;
    n.lines.forEach((line, i) => {
      out += text(px + (left ? -22 : 22), py + 12 + i * 14, line, { size: fs * 11.5, anchor: left ? "end" : "start", fill: i ? CHART.inkSoft : CHART.ink, weight: i ? undefined : 600 });
    });
  }
  return `<svg class="state-chart" viewBox="0 0 ${LW} ${H}" width="100%" role="img" aria-label="${escapeHtml(opts.label)}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

export function lineLegend(primary: string, secondary: string): string {
  return `<div class="state-chart-legend">
<span><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="${CHART.terra}" stroke-width="2.5"/></svg>${escapeHtml(primary)}</span>
<span><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="${CHART.inkSoft}" stroke-width="1.4"/></svg>${escapeHtml(secondary)}</span>
</div>`;
}
