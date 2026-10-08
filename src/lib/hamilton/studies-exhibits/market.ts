/**
 * Hamilton's new market study, drawn from MarketStudyData: a footprint map, deposit shares and
 * history, the bank's fees beside the county's competitors, and households. Pure functions
 * returning HTML and SVG strings in the shared chart style; every title is computed from the
 * data. Each chart is drawn at report width and at phone width (see `responsive`).
 */
import { geoConicConformal, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { CHART, CHART_FONTS } from "@/lib/charts/style";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { countyCentroid, countyFeature, countyLabel, countyNeighbors, milesBetween, type CountyFeature } from "@/lib/geo/counties";
import type { MarketStudyData, MarketStudyFee, MarketStudyHousehold, MarketStudyMember } from "@/lib/data-store/market-study";

export interface ChartSize {
  narrow?: boolean;
}

const WIDE = 960;
const NARROW = 400;
const HALF = 460;

/** Competitors in deposit order take these colours; the rest share the context grey. */
const COMPETITOR_COLOURS = [CHART.ink, "#4F7CAC", "#6B8F5E", "#8A6FA8"] as const;
/** HHI above this is "highly concentrated" under the 2023 federal merger guidelines. */
export const HHI_HIGH = 1800;
export const HHI_MODERATE = 1000;
/** A fee row needs at least this many competitors with a published amount. */
export const FEE_MIN_COMPETITORS = 2;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();
export const money = (v: number): string => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

export function dollarsShort(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

function text(x: number, y: number, body: string, o: { size?: number; anchor?: "start" | "middle" | "end"; weight?: number; font?: keyof typeof CHART_FONTS; fill?: string; halo?: boolean } = {}): string {
  const font = CHART_FONTS[o.font ?? "sans"].replace(/"/g, "'");
  const halo = o.halo ? ` stroke="${CHART.paper}" stroke-width="3" paint-order="stroke"` : "";
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${font}" font-size="${o.size ?? 12}" text-anchor="${o.anchor ?? "start"}"${o.weight ? ` font-weight="${o.weight}"` : ""} fill="${o.fill ?? CHART.inkSoft}"${halo}>${esc(body)}</text>`;
}

function svg(width: number, height: number, body: string, label: string): string {
  return `<svg class="rd-chart" viewBox="0 0 ${width} ${Math.ceil(height)}" width="100%" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Draw at report width and at phone width; CSS shows the one that fits. */
export function responsive(draw: (size: ChartSize) => string | null): string | null {
  const wide = draw({});
  if (!wide) return null;
  const narrow = draw({ narrow: true });
  return narrow ? `<div class="sc-wide">${wide}</div><div class="sc-narrow">${narrow}</div>` : wide;
}

export function shortBankName(name: string): string {
  return name
    .replace(/,? National Association$/i, "")
    .replace(/,? N\.A\.$/i, "")
    .replace(/Federal Credit Union/i, "FCU")
    .replace(/^The /, "");
}

// ─── Colours and figures ──────────────────────────────────────────────────────

export interface BankStyle {
  key: number;
  name: string;
  colour: string;
  subject: boolean;
}

/** One colour per bank: the subject is terra, the four largest competitors get their own. */
export function bankStyles(d: MarketStudyData): Map<number, BankStyle> {
  const out = new Map<number, BankStyle>();
  out.set(d.subject.institution_id, { key: d.subject.institution_id, name: shortBankName(d.subject.name), colour: CHART.terra, subject: true });
  let i = 0;
  for (const m of d.members) {
    if (m.institution_id === d.subject.institution_id) continue;
    out.set(m.key, { key: m.key, name: shortBankName(m.name), colour: COMPETITOR_COLOURS[i] ?? CHART.context, subject: false });
    i++;
  }
  return out;
}

export interface MarketFigures {
  countyName: string;
  total: number;
  branches: number;
  hhi: number;
  concentration: "highly concentrated" | "moderately concentrated" | "unconcentrated";
  peak: { year: number; deposits: number };
  /** Subject's branches already in the county. */
  subjectBranchesInCounty: number;
  /** Miles from the county's centre to the subject's nearest branch outside it, with its city. */
  nearest: { miles: number; city: string | null } | null;
  target: MarketStudyHousehold | null;
  state: MarketStudyHousehold | null;
}

export function marketFigures(d: MarketStudyData): MarketFigures {
  const total = d.members.reduce((s, m) => s + m.deposits, 0);
  const hhi = total > 0 ? Math.round(d.members.reduce((s, m) => s + ((m.deposits / total) * 100) ** 2, 0)) : 0;
  const peak = d.totals.reduce((a, b) => (b.deposits > a.deposits ? b : a), d.totals[0]);
  const centre = countyCentroid(d.county_fips);
  const outside = d.subject_branches.filter((b) => b.county_fips !== d.county_fips && b.latitude !== null && b.longitude !== null);
  const nearest =
    centre && outside.length > 0
      ? outside
          .map((b) => ({ miles: milesBetween(centre, [b.longitude!, b.latitude!]), city: b.city }))
          .reduce((a, b) => (b.miles < a.miles ? b : a))
      : null;
  return {
    countyName: countyLabel(d.county_fips) ?? `County ${d.county_fips}`,
    total,
    branches: d.branches.length,
    hhi,
    concentration: hhi > HHI_HIGH ? "highly concentrated" : hhi >= HHI_MODERATE ? "moderately concentrated" : "unconcentrated",
    peak,
    subjectBranchesInCounty: d.branches.filter((b) => b.institution_id === d.subject.institution_id).length,
    nearest,
    target: d.households.find((h) => h.role === "target") ?? null,
    state: d.households.find((h) => h.role === "state") ?? null,
  };
}

// ─── Exhibit 1: footprint map ─────────────────────────────────────────────────

export function footprintMap(d: MarketStudyData, styles: Map<number, BankStyle>, size: ChartSize = {}): string | null {
  const target = countyFeature(d.county_fips);
  if (!target) return null;
  const shown = [target, ...countyNeighbors(d.county_fips).map(countyFeature).filter((f): f is CountyFeature => f !== null)];
  const collection: FeatureCollection<Geometry, { name: string }> = { type: "FeatureCollection", features: shown };
  const w = size.narrow ? NARROW : WIDE;
  const centre = countyCentroid(d.county_fips)!;
  const projection = geoConicConformal().rotate([-centre[0], 0]).parallels([centre[1] - 2, centre[1] + 2]);
  // Fit the width, then size the height to the shape (capped), so no band of empty space is left.
  projection.fitWidth(w - 16, collection);
  const bounds = geoPath(projection).bounds(collection);
  const h = Math.min(size.narrow ? 420 : 560, Math.max(size.narrow ? 220 : 320, bounds[1][1] - bounds[0][1] + 16));
  projection.fitExtent([[8, 8], [w - 8, h - 8]], collection);
  const path = geoPath(projection).digits(1);
  const shownIds = new Set(shown.map((f) => f.id));

  let out = "";
  for (const f of shown) {
    const isTarget = f.id === d.county_fips;
    out += `<path d="${path(f) ?? ""}" fill="${isTarget ? CHART.terraSoft : CHART.paper}" stroke="${isTarget ? CHART.terra : CHART.rule2}" stroke-width="${isTarget ? 2 : 1}"/>`;
  }
  const subjectId = d.subject.institution_id;
  const dots = [
    ...d.branches.filter((b) => b.institution_id !== subjectId),
    ...d.subject_branches.filter((b) => shownIds.has(b.county_fips)),
    ...d.branches.filter((b) => b.institution_id === subjectId && !d.subject_branches.some((s) => s.cert === b.cert && s.branch_name === b.branch_name)),
  ]
    .filter((b) => b.latitude !== null && b.longitude !== null)
    .sort((a, b) => b.deposits - a.deposits);
  // Circle area follows deposits on one scale per map, capped so a head office that books a
  // bank's deposits at one address does not cover the county.
  const maxDeposits = Math.max(1, ...dots.map((b) => b.deposits));
  const [rMin, rMax] = size.narrow ? [2.5, 15] : [3, 26];
  const radius = (dollars: number) => rMin + (rMax - rMin) * Math.sqrt(Math.max(dollars, 0) / maxDeposits);
  for (const b of dots) {
    const p = projection([b.longitude!, b.latitude!]);
    if (!p) continue;
    const key = b.institution_id ?? -b.cert;
    const style = styles.get(key);
    const own = key === subjectId;
    const colour = style?.colour ?? CHART.context;
    const tip = `<title>${esc(`${style?.name ?? "Bank"}: ${b.branch_name ?? "branch"}, ${b.city ?? ""}. Deposits ${dollarsShort(b.deposits)}`)}</title>`;
    out += own
      ? `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="${r1(radius(b.deposits))}" fill="${CHART.paper}" fill-opacity="0.85" stroke="${CHART.terra}" stroke-width="2">${tip}</circle>`
      : `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="${r1(radius(b.deposits))}" fill="${colour}" fill-opacity="0.85" stroke="${CHART.paper}" stroke-width="1">${tip}</circle>`;
  }
  // County names go on top of the branch circles so they stay readable.
  for (const f of shown) {
    const [x, y] = path.centroid(f);
    if (!Number.isFinite(x) || x < 30 || x > w - 30 || y < 20 || y > h - 20) continue;
    const isTarget = f.id === d.county_fips;
    out += text(x, isTarget ? y - (size.narrow ? 28 : 46) : y, f.properties.name, {
      size: isTarget ? (size.narrow ? 16 : 15) : size.narrow ? 12 : 11.5,
      anchor: "middle",
      font: isTarget ? "serif" : "sans",
      weight: isTarget ? 600 : undefined,
      fill: isTarget ? CHART.ink : CHART.muted,
      halo: true,
    });
  }

  return svg(w, h, out, `Branches in and around ${target.properties.name} County`);
}

export function footprintLegend(d: MarketStudyData, styles: Map<number, BankStyle>): string {
  const subjectOutside = d.branches.every((b) => b.institution_id !== d.subject.institution_id);
  const items = [...styles.values()]
    .filter((s) => s.subject || s.colour !== CHART.context)
    .map((s) =>
      s.subject
        ? `<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="${CHART.paper}" stroke="${CHART.terra}" stroke-width="2"/></svg>${esc(s.name)}${subjectOutside ? " (outside the county)" : ""}</span>`
        : `<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="${s.colour}"/></svg>${esc(s.name)}</span>`,
    );
  if ([...styles.values()].some((s) => s.colour === CHART.context)) {
    items.push(`<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="${CHART.context}"/></svg>Other banks</span>`);
  }
  items.push("<span>Circle area shows deposits</span>");
  return `<div class="rd-legend">${items.join("")}</div>`;
}

// ─── Exhibit 2: shares and history ────────────────────────────────────────────

const SHARE_ROWS = 6;

export function shareBars(d: MarketStudyData, styles: Map<number, BankStyle>, size: ChartSize = {}): string | null {
  const total = d.members.reduce((s, m) => s + m.deposits, 0);
  if (total <= 0) return null;
  const shown = d.members.slice(0, SHARE_ROWS);
  const rest = d.members.slice(SHARE_ROWS);
  const rows: Array<MarketStudyMember & { colour: string }> = shown.map((m) => ({ ...m, colour: styles.get(m.key)?.colour ?? CHART.context }));
  if (rest.length > 0) {
    rows.push({
      key: 0,
      institution_id: null,
      name: `${rest.length} other ${rest.length === 1 ? "bank" : "banks"}`,
      deposits: rest.reduce((s, m) => s + m.deposits, 0),
      deposits_earlier: null,
      branches: rest.reduce((s, m) => s + m.branches, 0),
      colour: CHART.context,
    });
  }
  const w = size.narrow ? 380 : HALF;
  const fs = size.narrow ? 1.1 : 1;
  const rh = 50 * fs;
  const bar = w - 70;
  let out = "";
  rows.forEach((r, i) => {
    const y = 6 + i * rh;
    const share = r.deposits / total;
    const change = r.deposits_earlier ? r.deposits / r.deposits_earlier - 1 : null;
    out += text(0, y + 13 * fs, shortBankName(r.name).slice(0, 44), { size: 13.5 * fs, fill: CHART.ink, weight: 600 });
    const detail = `${dollarsShort(r.deposits)} · ${r.branches} ${r.branches === 1 ? "branch" : "branches"}${
      change !== null ? ` · ${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)}% since ${d.earlier_year}` : r.key !== 0 && r.deposits_earlier === null ? ` · new since ${d.earlier_year}` : ""
    }`;
    out += text(0, y + 28 * fs, detail, { size: 11.5 * fs, font: "mono" });
    out += `<rect x="0" y="${r1(y + 33 * fs)}" width="${bar}" height="${r1(11 * fs)}" fill="${CHART.rule}"/>`;
    out += `<rect x="0" y="${r1(y + 33 * fs)}" width="${r1(Math.max(1.5, bar * share))}" height="${r1(11 * fs)}" fill="${r.colour}"/>`;
    out += text(bar * share + 6, y + 43 * fs, `${(share * 100).toFixed(1)}%`, { size: 13 * fs, font: "mono", fill: CHART.ink, weight: 600 });
  });
  return svg(w, rows.length * rh + 10, out, "Share of the county's deposits");
}

export function depositHistory(d: MarketStudyData, size: ChartSize = {}): string | null {
  const t = d.totals.filter((p) => p.deposits > 0);
  if (t.length < 2) return null;
  const w = size.narrow ? 380 : HALF;
  const fs = size.narrow ? 1.15 : 1;
  const H = 250;
  const L = 52;
  const R = 62;
  const T = 18;
  const B = 26;
  const values = t.map((p) => p.deposits);
  const unit = Math.max(...values) >= 2e9 ? 1e9 : Math.max(...values) >= 2e8 ? 1e8 : 1e7;
  const lo = Math.floor((Math.min(...values) * 0.95) / unit) * unit;
  const hi = Math.ceil((Math.max(...values) * 1.03) / unit) * unit;
  const first = t[0].year;
  const last = t[t.length - 1].year;
  const x = (yr: number) => L + ((yr - first) / Math.max(1, last - first)) * (w - L - R);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  let out = "";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = lo + ((hi - lo) * i) / steps;
    out += `<line x1="${L}" x2="${w - R}" y1="${r1(y(v))}" y2="${r1(y(v))}" stroke="${CHART.rule}"/>` + text(L - 6, y(v) + 4, dollarsShort(v), { size: 10.5 * fs, anchor: "end", font: "mono" });
  }
  const span = last - first;
  const every = span > 12 ? 4 : span > 6 ? 2 : 1;
  for (let yr = last; yr >= first; yr -= every) out += text(x(yr), H - 8, String(yr), { size: 10.5 * fs, anchor: "middle", font: "mono" });
  out += `<path d="${t.map((p, i) => `${i ? "L" : "M"}${r1(x(p.year))} ${r1(y(p.deposits))}`).join("")}" fill="none" stroke="${CHART.terra}" stroke-width="2.5" stroke-linejoin="round"/>`;
  for (const p of t) out += `<circle cx="${r1(x(p.year))}" cy="${r1(y(p.deposits))}" r="3" fill="${CHART.terra}"><title>${p.year}: ${dollarsShort(p.deposits)}</title></circle>`;
  const end = t[t.length - 1];
  out += text(x(end.year) + 6, y(end.deposits) + 4, dollarsShort(end.deposits), { size: 12 * fs, font: "mono", fill: CHART.ink, weight: 600 });
  const peak = t.reduce((a, b) => (b.deposits > a.deposits ? b : a));
  if (peak.year !== end.year) {
    const px = x(peak.year);
    const left = px > w - 150;
    out += text(px + (left ? -6 : 6), y(peak.deposits) - 8, `Peak ${peak.year}: ${dollarsShort(peak.deposits)}`, { size: 11.5 * fs, anchor: left ? "end" : "start", fill: CHART.ink, weight: 600, halo: true });
  }
  return svg(w, H, out, "County deposits by year");
}

// ─── Exhibit 3: fees ──────────────────────────────────────────────────────────

export function feeRows(d: MarketStudyData): MarketStudyFee[] {
  return d.fees.filter((f) => f.subject !== null && f.competitors.length >= FEE_MIN_COMPETITORS);
}

export type FeePosition = "above" | "below" | "within" | "same";

export function feePosition(f: MarketStudyFee): FeePosition {
  const vals = f.competitors.map((c) => c.amount);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const own = f.subject!;
  if (own > hi) return "above";
  if (own < lo) return "below";
  return lo === hi && own === hi ? "same" : "within";
}

function positionLine(f: MarketStudyFee, subject: string): string {
  const vals = f.competitors.map((c) => c.amount);
  const own = f.subject!;
  switch (feePosition(f)) {
    case "above":
      return `${subject} ${money(Math.round((own - Math.max(...vals)) * 100) / 100)} above the highest`;
    case "below":
      return `${subject} ${money(Math.round((Math.min(...vals) - own) * 100) / 100)} below the lowest`;
    case "same":
      return "Same as every competitor";
    default:
      return "Within the competitors' range";
  }
}

export function feeComparison(d: MarketStudyData, styles: Map<number, BankStyle>, size: ChartSize = {}): string | null {
  const rows = feeRows(d);
  if (rows.length === 0) return null;
  const subject = shortBankName(d.subject.name);
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW : WIDE;
  const left = narrow ? 16 : 230;
  const right = narrow ? 30 : 70;
  const top = Math.max(...rows.flatMap((f) => [f.subject!, ...f.competitors.map((c) => c.amount)]));
  const max = Math.max(10, Math.ceil((top + 0.01) / 10) * 10);
  const x = (v: number) => left + (v / max) * (w - left - right);
  const rh = narrow ? 84 : 50;
  const head = 24;
  let out = "";
  const height = head + rows.length * rh;
  for (let v = 0; v <= max; v += max > 60 ? 20 : 10) {
    out += `<line x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${head - 6}" y2="${height}" stroke="${CHART.rule}"/>` + text(x(v), 12, `$${v}`, { size: narrow ? 12 : 11, anchor: "middle", font: "mono" });
  }
  rows.forEach((f, i) => {
    const y0 = head + i * rh;
    const cy = narrow ? y0 + 50 : y0 + 18;
    if (narrow) {
      out += text(0, y0 + 16, getDisplayName(f.category), { size: 15, font: "serif", fill: CHART.ink, weight: 600 });
      out += text(0, y0 + 32, positionLine(f, subject), { size: 12, font: "mono" });
    } else {
      out += text(0, cy + 2, getDisplayName(f.category), { size: 14, font: "serif", fill: CHART.ink, weight: 600 });
      out += text(0, cy + 18, positionLine(f, subject), { size: 11.5, font: "mono" });
    }
    const vals = f.competitors.map((c) => c.amount);
    out += `<line x1="${r1(x(Math.min(...vals)))}" x2="${r1(x(Math.max(...vals)))}" y1="${cy}" y2="${cy}" stroke="${CHART.rule2}" stroke-width="6" stroke-linecap="round"/>`;
    const seen = new Map<number, number>();
    for (const c of [...f.competitors].sort((a, b) => a.amount - b.amount)) {
      const n = seen.get(c.amount) ?? 0;
      seen.set(c.amount, n + 1);
      const style = styles.get(c.institution_id);
      // Tied competitors stack; on a phone they stack downward, away from the text above.
      out += `<circle cx="${r1(x(c.amount))}" cy="${r1(cy + (narrow ? n : -n) * 11)}" r="6" fill="${style?.colour ?? CHART.context}" stroke="${CHART.paper}" stroke-width="1.5"><title>${esc(`${style?.name ?? "Competitor"}: ${money(c.amount)}`)}</title></circle>`;
    }
    const own = f.subject!;
    const flip = x(own) > w - right - 40;
    out += `<circle cx="${r1(x(own))}" cy="${cy}" r="9" fill="${CHART.paper}" stroke="${CHART.terra}" stroke-width="3"><title>${esc(`${subject}: ${money(own)}`)}</title></circle>`;
    out += text(x(own) + (flip ? -14 : 14), cy + 5, money(own), { size: 13, anchor: flip ? "end" : "start", font: "mono", fill: CHART.terraText, weight: 700, halo: true });
  });
  return svg(w, height + 4, out, `${subject}'s fees beside the county's competitors`);
}

export function feeLegend(d: MarketStudyData, styles: Map<number, BankStyle>): string {
  const ids = new Set(feeRows(d).flatMap((f) => f.competitors.map((c) => c.institution_id)));
  const subject = styles.get(d.subject.institution_id)!;
  const items = [
    `<span><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="${CHART.paper}" stroke="${CHART.terra}" stroke-width="2.5"/></svg>${esc(subject.name)}</span>`,
    ...[...ids].map((id) => styles.get(id)).filter((s): s is BankStyle => !!s).map((s) => `<span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="${s.colour}"/></svg>${esc(s.name)}</span>`),
    `<span><svg width="26" height="10" aria-hidden="true"><line x1="3" y1="5" x2="23" y2="5" stroke="${CHART.rule2}" stroke-width="6" stroke-linecap="round"/></svg>Competitor range</span>`,
  ];
  return `<div class="rd-legend">${items.join("")}</div>`;
}

// ─── Exhibit 4: households ────────────────────────────────────────────────────

const METRICS: Array<{ title: string; get: (h: MarketStudyHousehold) => number | null; fmt: (v: number) => string; skipState?: boolean }> = [
  { title: "Median household income", get: (h) => h.income, fmt: (v) => `$${Math.round(v / 1000)}k` },
  { title: "Population", get: (h) => h.population, fmt: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`), skipState: true },
  { title: "Poverty rate", get: (h) => (h.poverty !== null && h.population ? h.poverty / h.population : null), fmt: (v) => `${(v * 100).toFixed(1)}%` },
];

export function households(rows: MarketStudyHousehold[], size: ChartSize = {}): string | null {
  const ordered = [...rows.filter((r) => r.role === "target"), ...rows.filter((r) => r.role === "subject"), ...rows.filter((r) => r.role === "state")];
  if (!ordered.some((r) => r.role === "target")) return null;
  const narrow = Boolean(size.narrow);
  const w = narrow ? NARROW : WIDE;
  const colW = narrow ? w : w / 3;
  const rowH = narrow ? 38 : 36;
  const blockH = 30 + ordered.length * rowH + (narrow ? 14 : 0);
  let out = "";
  METRICS.forEach((m, mi) => {
    const x0 = narrow ? 0 : mi * colW + (mi ? 24 : 0);
    const y0 = narrow ? mi * blockH : 0;
    const bw = (narrow ? w : colW - (mi ? 48 : 24)) - 90;
    out += text(x0, y0 + 16, m.title, { size: narrow ? 15 : 14, font: "serif", fill: CHART.ink, weight: 600 });
    const vals = ordered.filter((r) => !(m.skipState && r.role === "state")).map(m.get).filter((v): v is number => v !== null);
    const max = Math.max(...vals, 0) || 1;
    ordered.forEach((r, i) => {
      const y = y0 + 30 + i * rowH;
      const v = m.get(r);
      const target = r.role === "target";
      out += text(x0, y + 11, r.name, { size: narrow ? 13 : 12, fill: target ? CHART.ink : CHART.inkSoft, weight: target ? 600 : undefined });
      if (v === null) {
        out += text(x0, y + 27, "not on file", { size: 11.5 });
        return;
      }
      if (m.skipState && r.role === "state") {
        out += text(x0, y + 27, `${m.fmt(v)} (state)`, { size: narrow ? 12.5 : 11.5, font: "mono" });
        return;
      }
      const bwv = Math.max(2, (bw * v) / max);
      out += `<rect x="${r1(x0)}" y="${y + 16}" width="${r1(bwv)}" height="11" fill="${target ? CHART.terra : r.role === "state" ? CHART.muted : CHART.rule2}"/>`;
      out += text(x0 + bwv + 6, y + 26, m.fmt(v), { size: narrow ? 12.5 : 11.5, font: "mono", fill: target ? CHART.ink : CHART.inkSoft, weight: target ? 600 : undefined });
    });
  });
  return svg(w, narrow ? blockH * METRICS.length : blockH + 6, out, "Households in the county and its neighbours");
}

// ─── The study ────────────────────────────────────────────────────────────────

function section(label: string, title: string, sub: string | null, body: string, source: string): string {
  return `<section class="rd-exhibit"><div class="rd-label">${esc(label)}</div><h2>${esc(title)}</h2>${sub ? `<p class="rd-sub">${esc(sub)}</p>` : ""}${body}<div class="rd-source">${esc(source)}</div></section>`;
}

function notice(text: string): string {
  return `<p class="rd-notice">${esc(text)}</p>`;
}

function pctChange(now: number, before: number): string {
  const c = (now / before - 1) * 100;
  return `${c >= 0 ? "+" : "−"}${Math.abs(c).toFixed(0)}%`;
}

export interface MarketStudy {
  eyebrow: string;
  title: string;
  deck: string;
  heroes: { figure: string; label: string; note: string }[];
  html: string;
}

export function buildMarketStudy(d: MarketStudyData): MarketStudy {
  const fig = marketFigures(d);
  const styles = bankStyles(d);
  const subject = shortBankName(d.subject.name);
  const leader = d.members[0];
  const leaderShare = leader && fig.total > 0 ? (leader.deposits / fig.total) * 100 : 0;
  const nationalBanks = d.members.slice(1).length;

  const deck = leader
    ? `A ${dollarsShort(fig.total)} deposit market at ${fig.branches} branches, where ${shortBankName(leader.name)} holds ${leaderShare.toFixed(0)}% of deposits and ${nationalBanks} other ${nationalBanks === 1 ? "bank holds" : "banks hold"} the rest.`
    : `No branch deposits are on file for ${fig.countyName}.`;

  const heroes: MarketStudy["heroes"] = [
    {
      figure: dollarsShort(fig.total),
      label: `Deposits at ${fig.branches} ${fig.branches === 1 ? "branch" : "branches"}, June ${d.sod_year}`,
      note: fig.peak.year !== d.sod_year ? `${pctChange(fig.total, fig.peak.deposits)} from the ${fig.peak.year} peak` : `The highest on file`,
    },
    {
      figure: fig.hhi.toLocaleString("en-US"),
      label: `Market HHI, ${d.members.length} ${d.members.length === 1 ? "bank" : "banks"}`,
      note: fig.concentration === "highly concentrated" ? "Highly concentrated above 1,800" : fig.concentration === "moderately concentrated" ? "Moderately concentrated, 1,000 to 1,800" : "Unconcentrated below 1,000",
    },
  ];
  if (fig.target?.income != null) {
    heroes.push({
      figure: `$${fig.target.income.toLocaleString("en-US")}`,
      label: "Median household income",
      note: fig.state?.income != null ? `${fig.state.name} $${fig.state.income.toLocaleString("en-US")}` : `Census ACS ${fig.target.year}`,
    });
  }
  if (fig.subjectBranchesInCounty > 0) {
    heroes.push({ figure: String(fig.subjectBranchesInCounty), label: `${subject} branches already in the county`, note: `June ${d.sod_year}` });
  } else if (fig.nearest) {
    heroes.push({
      figure: `${fig.nearest.miles.toFixed(1)} mi`,
      label: `County centre to ${subject}'s nearest branch${fig.nearest.city ? `, ${titleCase(fig.nearest.city)}` : ""}`,
      note: `No ${subject} branch in the county`,
    });
  }

  const countyShort = fig.countyName.replace(/,\s*\w\w$/, "");
  const sections: string[] = [];

  // Exhibit 1
  const map = responsive((size) => footprintMap(d, styles, size));
  const ownCounties = new Set(d.subject_branches.map((b) => b.county_fips));
  const touching = countyNeighbors(d.county_fips).filter((f) => ownCounties.has(f)).map((f) => countyFeature(f)?.properties.name).filter(Boolean) as string[];
  const mapTitle =
    fig.subjectBranchesInCounty > 0
      ? `${subject} already has ${fig.subjectBranchesInCounty} ${fig.subjectBranchesInCounty === 1 ? "branch" : "branches"} in ${countyShort}`
      : touching.length > 0
        ? `${countyShort} borders ${subject}'s branches in ${listJoin(touching)}`
        : `${subject} has no branch in or next to ${countyShort}`;
  sections.push(
    section(
      "Exhibit 1 · Footprint",
      mapTitle,
      `Every branch in ${fig.countyName}, sized by deposits, beside ${subject}'s branches in the neighbouring counties.`,
      map ? footprintLegend(d, styles) + map : notice(`No county outline is on file for ${fig.countyName}.`),
      `FDIC Summary of Deposits, June 30, ${d.sod_year}, branch locations and deposits. Branches with no reported deposits are drawn at the smallest size.`,
    ),
  );

  // Exhibit 2
  const shares = responsive((size) => shareBars(d, styles, size));
  const history = responsive((size) => depositHistory(d, size));
  const leaderEarlier = leader?.deposits_earlier ?? null;
  const earlierTotal = d.totals.find((t) => t.year === d.earlier_year)?.deposits ?? null;
  let shareTitle = leader ? `${shortBankName(leader.name)} holds ${leaderShare.toFixed(0)}% of the county's deposits` : `No deposits on file for ${countyShort}`;
  if (leader && leaderEarlier !== null && earlierTotal) {
    const before = (leaderEarlier / earlierTotal) * 100;
    const diff = leaderShare - before;
    shareTitle += Math.abs(diff) < 1.5 ? `, about the same share as in ${d.earlier_year}` : `, ${diff > 0 ? "up" : "down"} from ${before.toFixed(0)}% in ${d.earlier_year}`;
  }
  sections.push(
    section(
      "Exhibit 2 · Market",
      shareTitle,
      null,
      `<div class="rd-pair"><div class="rd-panel"><h3 class="rd-panel-title">Share of ${esc(countyShort)} deposits, ${d.sod_year}</h3>${shares ?? notice("No deposits on file.")}</div><div class="rd-panel"><h3 class="rd-panel-title">County deposits by year</h3>${history ?? notice("Fewer than two years of deposits on file.")}</div></div>`,
      `FDIC Summary of Deposits, June 30 of each year, branches in ${fig.countyName}. HHI is the sum of squared deposit shares; the 2023 federal merger guidelines call a market above 1,800 highly concentrated. Credit unions do not report branch deposits to the FDIC.`,
    ),
  );

  // Exhibit 3
  const rows = feeRows(d);
  const fees = responsive((size) => feeComparison(d, styles, size));
  const above = rows.filter((f) => feePosition(f) === "above");
  const below = rows.filter((f) => feePosition(f) === "below");
  const od = rows.find((f) => f.category === "overdraft");
  let feeTitle: string;
  const subjectHasFees = d.fees.some((f) => f.subject !== null);
  if (!subjectHasFees) feeTitle = `${subject} has no published fees on file yet to compare`;
  else if (rows.length === 0) feeTitle = `Too few ${countyShort} competitors publish the same fees as ${subject} yet`;
  else if (od && feePosition(od) === "above") feeTitle = `${subject}'s overdraft fee would be the highest in the county`;
  else if (od && feePosition(od) === "below") feeTitle = `${subject}'s overdraft fee would be the lowest in the county`;
  else feeTitle = `${subject} would be above every competitor on ${above.length} of ${rows.length} fees and below all of them on ${below.length}`;
  const missing = d.members.filter((m) => m.institution_id !== null && m.institution_id !== d.subject.institution_id && !d.fees.some((f) => f.competitors.some((c) => c.institution_id === m.institution_id)));
  sections.push(
    section(
      "Exhibit 3 · Prices",
      feeTitle,
      `${subject}'s published fee beside each ${countyShort} competitor's, for fees at least ${FEE_MIN_COMPETITORS} of them publish.`,
      fees
        ? feeLegend(d, styles) + fees
        : notice(
            subjectHasFees
              ? `No fee is published by both ${subject} and at least ${FEE_MIN_COMPETITORS} competitors in the county yet.`
              : `${subject}'s fee schedule is not in the Bank Fee Index yet, so its prices cannot be set beside the county's.`,
          ),
      `${"Bank Fee Index published fees, each from the bank's own current fee schedule."}${
        missing.length > 0 ? ` No fee schedule is on file yet for ${listJoin(missing.slice(0, 4).map((m) => shortBankName(m.name)))}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}, so their prices are not shown.` : ""
      }`,
    ),
  );

  // Exhibit 4
  const house = responsive((size) => households(d.households, size));
  const t = fig.target;
  const s = fig.state;
  let houseTitle = `Households in ${countyShort}`;
  if (t?.income != null && s?.income != null) {
    const diff = (t.income / s.income - 1) * 100;
    houseTitle = Math.abs(diff) < 2 ? `${countyShort} households earn about the ${s.name} median` : `${countyShort} households earn ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? "more" : "less"} than the ${s.name} median`;
  }
  sections.push(
    section(
      "Exhibit 4 · Households",
      houseTitle,
      `${countyShort} beside the counties where ${subject} holds the most deposits.`,
      house ?? notice(`Census figures for ${fig.countyName} are not loaded yet.`),
      `U.S. Census Bureau, American Community Survey 5-year estimates${t ? `, ${t.year}` : ""}. Poverty rate is people below the poverty line over total population.`,
    ),
  );

  return {
    eyebrow: `Hamilton · New market study · ${subject}`,
    title: fig.countyName,
    deck,
    heroes,
    html: sections.join(""),
  };
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Styles for the study page; light, print-friendly, phone-first. */

