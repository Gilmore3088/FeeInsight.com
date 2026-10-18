"use client";

import { useMemo, useState } from "react";
import { formatCompactDollars } from "@/lib/format";
import { ASSET_BANDS, type HistoryPoint } from "@/lib/market-position";
import type { MarketPosition, MetroPosition } from "@/lib/data-store/market-position";
import { MarketProvenance } from "./market-provenance";
import { SERIF } from "./profile-serif";

/*
 * Market position for the selected metro: offices on a map with competitor toggles, the ranked
 * deposit share (FDIC SOD, banks only), the bank's own share, offices and rank over the survey
 * years, and the credit unions there (NCUA) kept separate. One accent for the subject, neutral
 * slate for everyone else (the overview's tokens from PR 1864, with the same values as fallback);
 * every chart has its numbers in text beside it.
 */
const SUBJECT = "var(--fi-subject, #2a6fc4)";
const PEER = "var(--fi-peer, #a3abb7)";
const GRID = "var(--fi-chart-grid, #e7e0d2)";
const METRO_FILL = "#EEF1F5";
const AROUND_FILL = "#F7F5F0";

/** "June 30, 2026" for an SOD year. */
export function sodDate(year: number): string {
  return `June 30, ${year}`;
}

function formatDay(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const LABEL = "text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted";

export function MarketPositionCard({
  position,
  institutionName,
  selectedCode,
  onSelect,
}: {
  position: MarketPosition;
  institutionName: string;
  selectedCode: number | null;
  onSelect: (code: number) => void;
}) {
  const metro = position.metros.find((m) => m.code === selectedCode) ?? position.metros[0];
  const home = position.metros.find((m) => m.isHome) ?? null;
  return (
    <section aria-labelledby="market-position-heading" className="rounded-xl border border-border bg-white p-4 sm:p-6">
      <h3 id="market-position-heading" className="text-[26px] font-medium leading-tight text-ink sm:text-[32px]" style={SERIF}>
        Market position
      </h3>
      {position.metros.length > 1 && (
        <div role="group" aria-label="Metro" className="mt-3 flex flex-wrap gap-2">
          {position.metros.map((m) => (
            <button
              key={m.code}
              type="button"
              aria-pressed={m.code === metro.code}
              onClick={() => onSelect(m.code)}
              className={`min-h-11 rounded-full border px-3.5 text-[13px] transition-colors ${
                m.code === metro.code ? "border-ink bg-ink text-white" : "border-border bg-white text-ink hover:border-ink"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      <MetroSummary metro={metro} institutionName={institutionName} home={home} />
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <MetroMapPanel metro={metro} institutionName={institutionName} />
        <ShareChart metro={metro} institutionName={institutionName} />
      </div>
      <HistoryPanel metro={metro} institutionName={institutionName} />
      <CreditUnionNote metro={metro} />
    </section>
  );
}

function MetroSummary({ metro, institutionName, home }: { metro: MetroPosition; institutionName: string; home: MetroPosition | null }) {
  const own = metro.subject;
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <p className="text-[15px] leading-snug text-ink tabular-nums" aria-live="polite">
        {own ? (
          <>
            In {metro.name}, {institutionName} holds <span className="font-semibold">{own.sharePct}%</span> of bank deposits, #{own.rank} of{" "}
            {metro.institutions}, with {plural(own.branches, "office", "offices")}.
          </>
        ) : (
          <>{institutionName} has no deposits on file in {metro.name}.</>
        )}
      </p>
      {home && (
        <a
          href="?peers=metro#peers"
          className="inline-flex min-h-11 shrink-0 items-center text-[14px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {metro.isHome ? "Compare fees with these local competitors" : `Compare fees with competitors in ${home.name}`} &rarr;
        </a>
      )}
    </div>
  );
}

/* ---------------- Map ---------------- */

type Charter = "bank" | "credit_union";

function MetroMapPanel({ metro, institutionName }: { metro: MetroPosition; institutionName: string }) {
  const [charters, setCharters] = useState<Record<Charter, boolean>>({ bank: true, credit_union: true });
  const [bands, setBands] = useState<Record<number, boolean>>({});
  const [focus, setFocus] = useState<number | null>(null);
  const map = metro.map;
  const insts = metro.institutionsOnMap;
  const bandsPresent = useMemo(() => [...new Set(insts.map((i) => i.band))].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b)), [insts]);
  const bandOn = (b: number) => bands[b] !== false;
  const visible = (i: number) => i === metro.subjectIndex || (charters[insts[i].kind] && bandOn(insts[i].band));

  const dots = useMemo(() => {
    const out: Array<{ x: number; y: number; i: number }> = [];
    if (!map) return out;
    for (let k = 0; k + 2 < map.points.length; k += 3) out.push({ x: map.points[k], y: map.points[k + 1], i: map.points[k + 2] });
    return out;
  }, [map]);
  const shown = dots.filter((d) => visible(d.i));
  const shownInsts = new Set(shown.map((d) => d.i)).size;

  if (!map) {
    return (
      <div>
        <p className={LABEL}>Offices</p>
        <p className="mt-2 text-[13px] text-ink-soft">The metro&apos;s counties are not on file, so no map is drawn. Competitors are listed in the deposit share chart.</p>
      </div>
    );
  }

  const onPoint = (evt: React.PointerEvent<SVGSVGElement>) => {
    const svg = evt.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * map.width;
    const y = ((evt.clientY - rect.top) / rect.height) * map.height;
    let best: number | null = null;
    let bestD = 14 * 14;
    for (const d of shown) {
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d.i;
      }
    }
    setFocus(best);
  };
  const focused = focus !== null ? insts[focus] : null;
  const describe = (i: number) => {
    const inst = insts[i];
    const officesHere = dots.filter((d) => d.i === i).length;
    const kind = inst.kind === "bank" ? "bank" : "credit union";
    const band = inst.band >= 0 ? `, ${ASSET_BANDS[inst.band]} in assets` : "";
    return `${inst.name ?? "Unnamed FDIC-insured bank"}: ${kind}${band}, ${plural(officesHere, "office", "offices")} here`;
  };

  const others = shown.filter((d) => d.i !== metro.subjectIndex);
  const own = shown.filter((d) => d.i === metro.subjectIndex);
  return (
    <figure className="min-w-0">
      <figcaption className={LABEL}>Offices in the metro</figcaption>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Charter">
        {(["bank", "credit_union"] as Charter[]).map((c) => (
          <Toggle key={c} on={charters[c]} onClick={() => setCharters((s) => ({ ...s, [c]: !s[c] }))}>
            {c === "bank" ? "Banks" : "Credit unions"}
          </Toggle>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Total assets">
        {bandsPresent.map((b) => (
          <Toggle key={b} on={bandOn(b)} onClick={() => setBands((s) => ({ ...s, [b]: !bandOn(b) }))}>
            {b >= 0 ? ASSET_BANDS[b] : "Assets not on file"}
          </Toggle>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="mt-3 h-auto w-full touch-manipulation"
        role="img"
        aria-label={`Map of ${metro.name}: ${plural(shown.length, "office", "offices")} of ${plural(shownInsts, "institution", "institutions")}`}
        onPointerMove={onPoint}
        onPointerDown={onPoint}
        onPointerLeave={() => setFocus(null)}
      >
        {map.counties.map((c, i) => (
          <path key={i} d={c.d} fill={c.inMetro ? METRO_FILL : AROUND_FILL} stroke="#FFFFFF" strokeWidth={1.5} />
        ))}
        {others.map((d, k) =>
          insts[d.i].kind === "bank" ? (
            <circle key={`o${k}`} cx={d.x} cy={d.y} r={4} fill={PEER} fillOpacity={0.85} stroke="#FFFFFF" strokeWidth={1} />
          ) : (
            <circle key={`o${k}`} cx={d.x} cy={d.y} r={3.5} fill="#FFFFFF" stroke={PEER} strokeWidth={1.75} />
          ),
        )}
        {focus !== null &&
          dots
            .filter((d) => d.i === focus && focus !== metro.subjectIndex)
            .map((d, k) => <circle key={`f${k}`} cx={d.x} cy={d.y} r={6} fill="none" stroke="#132338" strokeWidth={1.5} />)}
        {own.map((d, k) => (
          <circle key={`s${k}`} cx={d.x} cy={d.y} r={5.5} fill={SUBJECT} stroke="#FFFFFF" strokeWidth={2} />
        ))}
      </svg>
      <p className="min-h-[2.5rem] text-[12px] leading-snug text-ink-soft" aria-live="polite">
        {focused && focus !== null ? describe(focus) : `${plural(shown.length, "office", "offices")} of ${plural(shownInsts, "institution", "institutions")} shown.`}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <LegendDot fill={SUBJECT}>{institutionName}</LegendDot>
        <LegendDot fill={PEER}>Other banks</LegendDot>
        <LegendDot ring>Credit unions</LegendDot>
      </div>
      <MarketProvenance
        rows={[
          { label: "Source", value: `FDIC Summary of Deposits (bank offices, ${sodDate(metro.year)}); NCUA credit union branch file${metro.creditUnions.reportDate ? ` (quarter ending ${formatDay(metro.creditUnions.reportDate)})` : ""}` },
          { label: "Area", value: `${metro.name} metro (FDIC metro code ${metro.code}), drawn from its counties` },
          { label: "Coverage", value: "Bank offices the FDIC places in the metro. Credit union offices in the cities those bank offices are in." },
          { label: "Asset band", value: "Each institution's total assets from its latest call report on file" },
          { label: "Not drawn", value: metro.unmappedOffices > 0 ? `${plural(metro.unmappedOffices, "office has", "offices have")} no coordinates on file` : null },
        ]}
      />
    </figure>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-[12px] transition-colors ${on ? "border-ink-soft bg-[#F4F1EC] text-ink" : "border-border bg-white text-ink-muted line-through"}`}
    >
      {children}
    </button>
  );
}

function LegendDot({ fill, ring, children }: { fill?: string; ring?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="10" height="10" aria-hidden="true">
        {ring ? <circle cx="5" cy="5" r="3.5" fill="#FFFFFF" stroke={PEER} strokeWidth="1.75" /> : <circle cx="5" cy="5" r="4.5" fill={fill} />}
      </svg>
      {children}
    </span>
  );
}

/* ---------------- Deposit share ---------------- */

function ShareChart({ metro, institutionName }: { metro: MetroPosition; institutionName: string }) {
  const max = Math.max(1, ...metro.shares.map((s) => s.sharePct));
  return (
    <figure className="min-w-0">
      <figcaption>
        <p className={LABEL}>Share of bank deposits</p>
        <p className="mt-1 text-[12px] text-ink-soft">
          As of {sodDate(metro.year)}. FDIC-insured offices only; credit unions are not included.
        </p>
      </figcaption>
      <ol className="mt-3 grid gap-2.5">
        {metro.shares.map((s, i) => {
          // The subject appended below the largest names sits after a break.
          const gap = s.subject && i > 0 && i === metro.shares.length - 1 && s.rank > metro.shares[i - 1].rank + 1;
          return (
            <li key={`${s.rank}-${s.name}`} className={gap ? "border-t border-dashed border-border pt-2.5" : undefined}>
              <div className="flex items-baseline justify-between gap-3 text-[12px] leading-tight">
                <span className={`min-w-0 truncate ${s.subject ? "font-semibold text-ink" : "text-ink-soft"}`}>
                  <span className="mr-1.5 inline-block w-5 text-right tabular-nums text-ink-muted">{s.rank}</span>
                  {s.subject ? institutionName : s.name}
                </span>
                <span className={`shrink-0 tabular-nums ${s.subject ? "font-semibold text-ink" : "text-ink-soft"}`}>{s.sharePct.toFixed(1)}%</span>
              </div>
              <div className="ml-[1.625rem] mt-1 h-2.5 rounded-r-[4px]" style={{ width: `calc((100% - 1.625rem) * ${Math.max(0.005, s.sharePct / max)})`, background: s.subject ? SUBJECT : PEER }} />
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] text-ink-muted tabular-nums">
        {metro.shares.length < metro.institutions ? `${metro.shares.length} of ${metro.institutions} institutions shown. ` : ""}
        {formatCompactDollars(metro.totalDeposits * 1_000)} in bank deposits in the metro.
      </p>
      <MarketProvenance
        rows={[
          { label: "Source", value: "FDIC Summary of Deposits" },
          { label: "Reporting date", value: sodDate(metro.year) },
          { label: "Area", value: `${metro.name} metro (FDIC metro code ${metro.code})` },
          { label: "Coverage", value: "Deposits booked at FDIC-insured bank and savings institution offices. Credit unions are not in the survey." },
          { label: "Calculation", value: "An institution's deposits at its offices in the metro, divided by all surveyed deposits there. Ranked by deposits." },
        ]}
      />
    </figure>
  );
}

/* ---------------- History ---------------- */

function HistoryPanel({ metro, institutionName }: { metro: MetroPosition; institutionName: string }) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const h = metro.history;
  if (h.length < 2) {
    return (
      <div className="mt-6">
        <p className={LABEL}>Position over time</p>
        <p className="mt-2 text-[13px] text-ink-soft">
          {h.length === 1 ? `Only the ${h[0].year} survey has ${institutionName} in this metro, so there is no trend to show.` : "No survey years on file for this metro."}
        </p>
      </div>
    );
  }
  const first = h[0].year;
  const last = h[h.length - 1].year;
  const at = hoverYear === null ? h[h.length - 1] : h.find((p) => p.year === hoverYear) ?? h[h.length - 1];
  return (
    <figure className="mt-6">
      <figcaption>
        <p className={LABEL}>
          Position over time, {first} to {last}
        </p>
        <p className="mt-1 min-h-[1.25rem] text-[12px] text-ink-soft tabular-nums" aria-live="polite">
          June {at.year}: {at.sharePct}% share, {plural(at.branches, "office", "offices")}, #{at.rank} of {at.institutions}
        </p>
      </figcaption>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <Spark title="Deposit share" points={h} value={(p) => p.sharePct} format={(v) => `${v}%`} hoverYear={hoverYear} onHover={setHoverYear} />
        <Spark title="Offices" points={h} value={(p) => p.branches} format={(v) => String(v)} hoverYear={hoverYear} onHover={setHoverYear} integer />
        <Spark title="Rank (1 is largest)" points={h} value={(p) => p.rank} format={(v) => `#${v}`} hoverYear={hoverYear} onHover={setHoverYear} invert integer />
      </div>
      <MarketProvenance
        rows={[
          { label: "Source", value: "FDIC Summary of Deposits, every survey year on file" },
          { label: "Reporting dates", value: `June 30 of each year, ${first} to ${last}${h.length < last - first + 1 ? ` (${h.length} years with offices in the metro)` : ""}` },
          { label: "Area", value: `${metro.name} metro as the FDIC coded each office that year; metro boundaries can change between years` },
          { label: "Calculation", value: "Same as the share chart, year by year. Offices counted at June 30. A merger moves the acquired offices to the buyer from that year on." },
        ]}
      />
    </figure>
  );
}

const SPARK_W = 300;
const SPARK_H = 96;
const PAD_X = 6;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

function Spark({
  title,
  points,
  value,
  format,
  hoverYear,
  onHover,
  invert = false,
  integer = false,
}: {
  title: string;
  points: HistoryPoint[];
  value: (p: HistoryPoint) => number;
  format: (v: number) => string;
  hoverYear: number | null;
  onHover: (year: number | null) => void;
  invert?: boolean;
  integer?: boolean;
}) {
  const first = points[0].year;
  const last = points[points.length - 1].year;
  const vals = points.map(value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (!invert) lo = Math.min(0, lo);
  if (hi === lo) {
    hi += 1;
    if (integer) lo = Math.max(invert ? 1 : 0, lo - 1);
  }
  const x = (year: number) => PAD_X + ((year - first) / Math.max(1, last - first)) * (SPARK_W - PAD_X * 2);
  const yRaw = (v: number) => (hi - v) / (hi - lo);
  const y = (v: number) => PAD_TOP + (invert ? 1 - yRaw(v) : yRaw(v)) * (SPARK_H - PAD_TOP - PAD_BOTTOM);
  // A year with no offices in the metro breaks the line.
  const segments: HistoryPoint[][] = [];
  for (const p of points) {
    const seg = segments[segments.length - 1];
    if (seg && p.year === seg[seg.length - 1].year + 1) seg.push(p);
    else segments.push([p]);
  }
  const end = points[points.length - 1];
  const hovered = hoverYear === null ? null : points.find((p) => p.year === hoverYear) ?? null;
  const onMove = (evt: React.PointerEvent<SVGSVGElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * SPARK_W;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.year) - px) < Math.abs(x(best.year) - px)) best = p;
    onHover(best.year);
  };
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-medium text-ink">{title}</p>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        className="mt-1 h-auto w-full touch-manipulation overflow-visible"
        role="img"
        aria-label={`${title}: ${format(value(points[0]))} in ${first}, ${format(value(end))} in ${last}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => onHover(null)}
      >
        <line x1={PAD_X} x2={SPARK_W - PAD_X} y1={SPARK_H - PAD_BOTTOM} y2={SPARK_H - PAD_BOTTOM} stroke={GRID} strokeWidth={1} />
        {hovered && <line x1={x(hovered.year)} x2={x(hovered.year)} y1={PAD_TOP - 6} y2={SPARK_H - PAD_BOTTOM} stroke="#9aa1ab" strokeWidth={1} />}
        {segments.map((seg, i) =>
          seg.length > 1 ? (
            <polyline
              key={i}
              points={seg.map((p) => `${x(p.year).toFixed(1)},${y(value(p)).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={SUBJECT}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : (
            <circle key={i} cx={x(seg[0].year)} cy={y(value(seg[0]))} r={2.5} fill={SUBJECT} />
          ),
        )}
        {(hovered ? [hovered] : [end]).map((p) => (
          <circle key={p.year} cx={x(p.year)} cy={y(value(p))} r={4} fill={SUBJECT} stroke="#FFFFFF" strokeWidth={2} />
        ))}
        <text x={x(first)} y={SPARK_H - 4} fontSize={11} fill="#767c87">
          {first}
        </text>
        <text x={x(last)} y={SPARK_H - 4} fontSize={11} fill="#767c87" textAnchor="end">
          {last}
        </text>
        <text x={x(first)} y={y(value(points[0])) - 7} fontSize={11} fill="#4a5361" className="tabular-nums">
          {format(value(points[0]))}
        </text>
        <text x={x(last)} y={y(value(end)) - 7} fontSize={11} fill="#132338" fontWeight={600} textAnchor="end" className="tabular-nums">
          {format(value(end))}
        </text>
      </svg>
    </div>
  );
}

/* ---------------- Credit unions ---------------- */

function CreditUnionNote({ metro }: { metro: MetroPosition }) {
  const cu = metro.creditUnions;
  return (
    <div className="mt-5 rounded-lg border border-border bg-[#FAF8F4] p-3 text-[12px] leading-snug text-ink-soft">
      <p className={LABEL}>Credit unions, reported separately</p>
      <p className="mt-1 tabular-nums">
        {cu.offices > 0
          ? `${plural(cu.offices, "office", "offices")} of ${plural(cu.institutions, "credit union", "credit unions")} in the metro's cities${cu.reportDate ? `, NCUA branch file for the quarter ending ${formatDay(cu.reportDate)}` : ""}. NCUA does not report deposits by office, so credit unions have no share above.`
          : "No credit union offices on file in the metro's cities. NCUA does not report deposits by office, so credit unions never have a share above."}
      </p>
    </div>
  );
}
