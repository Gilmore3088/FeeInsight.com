/**
 * The pricing committee brief on screen, set as the document it prints: a white sheet with the
 * assessment first (a restrained header, one conclusion, up to three benchmark differences selected
 * for review with every limitation beside them, the comparisons to resolve first, and the recommended
 * next step), then the supporting exhibits. The
 * evidence appendix sits below the sheet, one tap per table, with limitations, method and the
 * numbered sources. The PDF (CommitteePacketPdf) prints the same brief. A printable document: no
 * form sits in it; a proposed price is placed on Try a price (/pro/simulate). Server component.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { PRICE_YIELD_LIMIT, READING_TEXT, footnoteMarks, inText, packetMoney, per10k, packetSections, type CommitteePacket, type LabelledTable, type NormalizedIncome, type PacketFeeBar, type PacketTable as PacketTableData, type PriceYield } from "@/lib/hamilton/committee-packet";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { ANSWER_TYPE, Callout, LinkButton, MemoHeader, MemoPage, More, Tabs } from "@/components/hamilton/memo/memo";
import { CommitteePacketDownload } from "./CommitteePacketDownload";

const MARK = /\[(\d+(?:, \d+)*)\]/g;

/** A cell's text with each "[3, 4]" footnote mark turned into links to the source list. */
function withMarks(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const ns = m[1].split(", ");
    parts.push(
      <sup key={m.index} className="ml-0.5 text-[11px] text-warm-600">
        [
        {ns.map((n, i) => (
          <span key={n}>
            {i > 0 ? "," : ""}
            {/* A tap target taller than the mark itself, without moving the line. */}
            <a href={`#fn-${n}`} className="-my-3 inline-flex min-h-11 min-w-6 items-center justify-center px-1 py-3 text-center text-terra-text no-underline hover:underline" aria-label={`Source ${n}`}>
              {n}
            </a>
          </span>
        ))}
        ]
      </sup>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

/** A cell that is one figure ("$35", "$4.2 million [3]", "$2.10"), set right so the digits line up. */
const FIGURE_CELL = /^[−+-]?\$[\d,.]+(?: (?:million|billion))?(?: \[\d+(?:, \d+)*\])?$/;

/** Columns whose every filled cell is a figure, or says the figure is missing. */
function figureColumns(rows: readonly string[][]): Set<number> {
  const out = new Set<number>();
  const width = rows[0]?.length ?? 0;
  for (let c = 1; c < width; c++) {
    const cells = rows.map((r) => r[c]).filter((v) => v && v !== "–" && !/^Not found/.test(v));
    if (cells.length && cells.every((v) => FIGURE_CELL.test(v))) out.add(c);
  }
  return out;
}

/** A table from md up (scrolling inside its own box when wide); a card per row on phones. */
function PacketTable({ exhibit }: { exhibit: PacketTableData }) {
  const firstRowOwn = exhibit.ownFirst;
  const [lead, ...rest] = exhibit.columns;
  const figures = figureColumns(exhibit.rows);
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-warm-300 bg-white md:block" tabIndex={0} role="region" aria-label={`${exhibit.title}; scroll sideways if needed`}>
        <table className="w-full text-sm">
          <caption className="sr-only">{exhibit.title}</caption>
          <thead>
            <tr className="border-b border-warm-200">
              {exhibit.columns.map((c, i) => (
                <th key={c} scope="col" className={`${ANSWER_TYPE.th} ${figures.has(i) ? "text-right" : ""}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-warm-800">
            {exhibit.rows.map((row, r) => (
              <tr key={r} className={`border-b border-warm-200 align-top last:border-0 ${firstRowOwn && r === 0 ? "bg-terra-soft" : ""}`}>
                {row.map((cell, c) => (
                  c === 0 ? (
                    <th key={c} scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium text-warm-900">
                      {withMarks(cell)}
                    </th>
                  ) : (
                    <td key={c} className={`min-w-[5rem] px-3 py-2 ${ANSWER_TYPE.num} ${figures.has(c) ? "whitespace-nowrap text-right" : ""}`}>
                      {withMarks(cell)}
                    </td>
                  )
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden" aria-label={exhibit.title}>
        {exhibit.rows.map((row, r) => (
          <li key={r} className={`rounded-lg border border-warm-300 px-4 py-3 text-sm ${firstRowOwn && r === 0 ? "bg-terra-soft" : "bg-white"}`}>
            <p className="font-medium text-warm-900">
              <span className="sr-only">{lead}: </span>
              {withMarks(row[0])}
            </p>
            <dl className="mt-1.5 flex flex-col gap-1">
              {rest.map((c, i) =>
                row[i + 1] ? (
                  <div key={c} className="flex min-w-0 flex-col">
                    <dt className="text-xs text-warm-600">{c}</dt>
                    <dd className={`break-words text-warm-800 ${ANSWER_TYPE.num}`}>{withMarks(row[i + 1])}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Each peer's published fee (across) against its fee income per $10,000 of total assets (up). The axis
 * labels are HTML outside the drawing, so they stay at least 12px on a phone.
 */
function PriceYieldChart({ py, institutionName }: { py: PriceYield; institutionName: string }) {
  if (py.points.length < 2) return null;
  const W = 640;
  const H = 260;
  const pad = 8;
  const fees = py.points.map((p) => p.fee);
  const incomes = py.points.map((p) => p.incomePer10kAssets);
  const fx = [Math.min(...fees), Math.max(...fees)];
  const iy = [Math.min(0, ...incomes), Math.max(...incomes) * 1.08];
  const span = (lo: number, hi: number) => (hi - lo || 1);
  const x = (v: number) => pad + ((v - fx[0]) / span(fx[0], fx[1])) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - iy[0]) / span(iy[0], iy[1])) * (H - 2 * pad);
  const tick = "text-xs text-warm-600 [font-variant-numeric:tabular-nums]";
  return (
    <figure className="flex flex-col gap-2">
      <p className={tick}>Up: income per $10,000 of total assets, {per10k(iy[0])} to {per10k(iy[1])}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-md border border-warm-200 bg-white" role="img" aria-label={`${py.feeName} against fee income per $10,000 of total assets, ${py.points.length} institutions`}>
        {py.medianFee !== null ? <line x1={x(py.medianFee)} x2={x(py.medianFee)} y1={pad} y2={H - pad} className="stroke-warm-500" strokeDasharray="4 4" /> : null}
        {py.medianIncome !== null ? <line x1={pad} x2={W - pad} y1={y(py.medianIncome)} y2={y(py.medianIncome)} className="stroke-warm-500" strokeDasharray="4 4" /> : null}
        {py.points.map((p) => (
          <circle key={p.institutionId} cx={x(p.fee)} cy={y(p.incomePer10kAssets)} r={p.own ? 9 : 6} className={p.own ? "fill-terra" : p.reading ? "fill-warm-700" : "fill-warm-400"}>
            <title>{`${p.name}: ${packetMoney(p.fee)}; ${per10k(p.incomePer10kAssets)} per $10,000 of total assets${p.reading ? `; ${READING_TEXT[p.reading]}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className={`flex justify-between gap-2 ${tick}`}>
        <span>{packetMoney(fx[0])}</span>
        <span className="text-center">Across: published {inText(py.feeName)} fee</span>
        <span>{packetMoney(fx[1])}</span>
      </div>
      <figcaption className={ANSWER_TYPE.caption}>
        Across: published {inText(py.feeName)} fee. Up: quarterly service charge income per $10,000 of total assets. Dashed lines: medians of {py.peersCompared} peers. The larger terracotta point is {institutionName}.
      </figcaption>
    </figure>
  );
}

/** "1–4, 7, 9–12": footnote numbers as ranges. */
function noteRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(", ");
}

function tableMarks(t: PacketTableData): number[] {
  return t.rows.flat().flatMap(footnoteMarks);
}

const BAND_WORD = { above: "Above", within: "Within", below: "Below" } as const;

/** One row of an exhibit: the peers' spread, middle 50% and median, and the bank's value. */
interface TrackRow {
  key: string;
  name: string;
  note: string | null;
  own: number | null;
  /** Said in place of the value when `own` is null. */
  ownMissing: string;
  median: number | null;
  q1: number | null;
  q3: number | null;
  low: number | null;
  high: number | null;
  outside: boolean;
  /** Under the value: "Above · 9 peers". */
  detail: string | null;
  marks: string;
  /** Said instead of a drawing when there is none. */
  empty: string;
  fmt: (v: number) => string;
}

function feeRow(b: PacketFeeBar): TrackRow {
  return {
    key: b.feeCategory,
    name: b.name,
    note: b.comparedWith ? `Compared with ${b.comparedWith}` : null,
    own: b.current,
    ownMissing: b.ownRange ? `${b.ownRange}, no single price` : "Not on the schedule",
    median: b.median,
    q1: b.q1,
    q3: b.q3,
    low: b.low,
    high: b.high,
    outside: b.band === "above" || b.band === "below",
    detail: b.band && b.median !== null ? `${BAND_WORD[b.band]} · ${b.peers} peers` : null,
    marks: b.marks,
    empty: b.peers === 0 ? "No peer publishes it" : `Only ${b.peers} ${b.peers === 1 ? "peer publishes" : "peers publish"} it; not placed`,
    fmt: packetMoney,
  };
}

function incomeRow(n: NormalizedIncome): TrackRow {
  return {
    key: "income",
    name: "Income per $10,000 of assets",
    note: null,
    own: n.own,
    ownMissing: "Not on the schedule",
    median: n.median,
    q1: n.q1,
    q3: n.q3,
    low: null,
    high: null,
    outside: n.own !== null && n.q1 !== null && n.q3 !== null && (n.own > n.q3 || n.own < n.q1),
    detail: `${n.peersCompared} peers${n.placement ? ` · ${n.placement}` : ""}`,
    marks: "",
    empty: "Too few peers filed for the quarter",
    fmt: per10k,
  };
}

function Track({ row }: { row: TrackRow }) {
  const values = [row.low, row.high, row.q1, row.q3, row.median, row.own].filter((v): v is number => v !== null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(hi * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100));
  const { q1, q3, median } = row as { q1: number; q3: number; median: number };
  return (
    <div
      role="img"
      aria-label={`${row.name}: ${row.own === null ? row.ownMissing.toLowerCase() : row.fmt(row.own)}; peers' middle 50% ${row.fmt(q1)} to ${row.fmt(q3)}; median ${row.fmt(median)}`}
      className="relative h-8"
    >
      {row.low !== null && row.high !== null ? (
        <>
          <span className="absolute top-1/2 h-px -translate-y-1/2 bg-warm-400" style={{ left: `${x(row.low)}%`, width: `${x(row.high) - x(row.low)}%` }} />
          <span className={`absolute -bottom-1.5 text-[11px] text-warm-500 ${ANSWER_TYPE.num}`} style={{ left: `${x(row.low)}%` }}>
            {row.fmt(row.low)}
          </span>
          <span className={`absolute -bottom-1.5 -translate-x-full text-[11px] text-warm-500 ${ANSWER_TYPE.num}`} style={{ left: `${x(row.high)}%` }}>
            {row.fmt(row.high)}
          </span>
        </>
      ) : null}
      <span className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm bg-terra-soft" style={{ left: `${x(q1)}%`, width: `${Math.max(1, x(q3) - x(q1))}%` }} />
      <span className="absolute top-1/2 h-6 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-warm-900" style={{ left: `${x(median)}%` }} />
      {row.own !== null ? (
        <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${row.outside ? "bg-terra" : "bg-warm-600"}`} style={{ left: `${x(row.own)}%` }} />
      ) : null}
    </div>
  );
}

function TrackRows({ rows }: { rows: TrackRow[] }) {
  return (
    <ul className="border-t border-warm-300">
      {rows.map((row) => {
        const placed = row.median !== null && row.q1 !== null && row.q3 !== null;
        return (
          <li key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border-b border-warm-200 py-3 md:grid-cols-[12rem_1fr_13rem]">
            <div className="text-[15px] text-warm-900">
              {row.name}
              {row.note ? <span className="block text-xs text-warm-600">{row.note}</span> : null}
            </div>
            <div className="order-3 col-span-2 md:order-none md:col-span-1">{placed ? <Track row={row} /> : <p className="text-xs text-warm-600">{row.empty}</p>}</div>
            <div className={`text-right text-[15px] ${ANSWER_TYPE.num}`}>
              {row.own === null ? (
                <span className="text-warm-600">{row.ownMissing}</span>
              ) : (
                <span className={`font-semibold ${row.outside ? "text-terra-text" : "text-warm-900"}`}>{row.fmt(row.own)}</span>
              )}
              {placed ? <span className="text-warm-600"> · median {row.fmt(row.median as number)}</span> : null}
              {row.marks ? <span className="text-xs">{withMarks(row.marks)}</span> : null}
              {row.detail && placed ? <span className="block text-xs text-warm-600">{row.detail}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-warm-700">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-terra" />Your fee, outside the middle 50%</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-warm-600" />Within it</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-terra-soft" />Peers&apos; middle 50%</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-0.5 bg-warm-900" />Peer median</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-px w-5 bg-warm-400" />Lowest to highest peer</span>
    </p>
  );
}

/** A small capitals label over a block of the brief. */
function Label({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">{children}</p>;
}

export function CommitteePacketView({
  packet,
  hrefFor,
  fees,
  selected,
}: {
  packet: CommitteePacket;
  /** The page's link with some parameters changed. */
  hrefFor: (over: Record<string, string | null>) => string;
  fees: { category: string; name: string }[];
  selected: { yieldFee: string | null };
}) {
  const readOn = readerAsOf(packet.generatedAt);
  const sections = packetSections(packet);
  const { conclusion, findings, unresolved, impact, nextStep } = packet.brief;
  const sourceLine = (t: PacketTableData) => {
    const marks = tableMarks(t);
    return `${t.source[0].toUpperCase()}${t.source.slice(1)}, read ${readOn}${marks.length ? ` · notes ${noteRanges(marks)}` : ""}`;
  };
  // Each source links back to the first place that cites it.
  const firstUse = new Map<number, { anchor: string; label: string }>();
  const cite = (marks: number[], anchor: string, label: string) => {
    for (const n of marks) if (!firstUse.has(n)) firstUse.set(n, { anchor, label });
  };
  cite([conclusion, ...findings.map((f) => f.evidence)].flatMap(footnoteMarks), "brief", "the brief");
  cite(packet.position.bars.map((b) => b.marks).flatMap(footnoteMarks), "exhibits", "the supporting exhibits");
  const exhibits = [...sections.position, ...sections.financial].sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
  for (const l of [...exhibits, ...sections.appendix]) cite(tableMarks(l.table), l.anchor, l.label);
  const reportsHref = hrefWithInstitutionContext("/pro/reports", String(packet.institutionId));
  const exhibit1 = sections.position[0];
  const incomeExhibit = sections.financial.find((l) => l.table.id === "normalized_income");
  const n = packet.financial.normalized;
  const tableIn = (l: LabelledTable) => (
    <More key={l.anchor} label={`${l.label}: ${l.table.title}`}>
      <div id={l.anchor} className="scroll-mt-24">
        {l.table.subtitle ? <p className="mb-2 text-xs text-warm-600">{l.table.subtitle}</p> : null}
        <PacketTable exhibit={l.table} />
        {l.table.note ? <p className="mt-2 text-xs leading-relaxed text-warm-600">{l.table.note}</p> : null}
        <p className="mt-1 text-xs text-warm-600">Source: {sourceLine(l.table)}</p>
        {l.table.id === "peer_changes" && packet.position.comparedNote ? <p className="mt-2 text-sm text-warm-800">{withMarks(packet.position.comparedNote)}</p> : null}
      </div>
    </More>
  );
  return (
    <MemoPage>
      <MemoHeader
        kicker="Reports"
        title="Pricing committee brief"
        compact
        actions={
          <>
            <CommitteePacketDownload institutionId={packet.institutionId} yieldFee={selected.yieldFee} />
            <LinkButton href={reportsHref}>Back to Reports</LinkButton>
          </>
        }
      />

      {/* The document itself: the assessment, then the supporting exhibits. */}
      <article className="mx-auto w-full max-w-[52rem] border border-warm-200 bg-white px-5 py-8 shadow-sm sm:px-12 sm:py-12">
        <section id="brief" aria-label="Executive brief" className="scroll-mt-24">
          <div className="flex items-baseline justify-between gap-4 border-b border-warm-900 pb-2">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-warm-900">Pricing committee brief</p>
            <p className={`text-xs text-warm-600 ${ANSWER_TYPE.num}`}>{readOn}</p>
          </div>
          <p className="mt-2 text-sm text-warm-600">
            {packet.institutionName} · Compared with {packet.peerGroupLabel}
          </p>
          <h2 className="mt-8 text-[1.5rem] font-semibold leading-snug text-warm-900 sm:text-[1.75rem]">{withMarks(conclusion)}</h2>

          {findings.length ? (
            <div className="mt-10">
              <Label>Benchmark differences selected for review</Label>
              <ol className="mt-3">
                {findings.map((f, i) => (
                  <li key={f.feeCategory} className={`grid gap-x-8 gap-y-3 border-t border-warm-200 py-5 ${findings.some((g) => g.caveats.length) ? "lg:grid-cols-[1fr_13rem]" : ""}`}>
                    <div className="flex gap-3">
                      <span className="text-lg font-bold text-terra-text">{i + 1}</span>
                      <div className="flex flex-col gap-1.5">
                        <p className="text-lg font-semibold leading-snug text-warm-900">{f.statement}</p>
                        <p className={`text-base leading-relaxed text-warm-900 ${ANSWER_TYPE.num}`}>{withMarks(f.evidence)}</p>
                      </div>
                    </div>
                    {f.caveats.length ? (
                      <aside aria-label="Limits" className="ml-8 border-l-2 border-terra pl-3 lg:ml-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-terra-text">Limits</p>
                        {f.caveats.map((c) => (
                          <p key={c} className="mt-1 text-sm leading-relaxed text-warm-700">
                            {c}
                          </p>
                        ))}
                      </aside>
                    ) : null}
                  </li>
                ))}
              </ol>
              {impact ? <p className="border-t border-warm-200 pt-4 text-base leading-relaxed text-warm-600">{impact}</p> : null}
            </div>
          ) : null}

          {unresolved.length ? (
            <div className="mt-6">
              <Label>Comparisons to resolve first</Label>
              <ul className="mt-3">
                {unresolved.map((u) => (
                  <li key={u.feeCategory} className="grid gap-x-6 gap-y-1 border-t border-warm-200 py-3 sm:grid-cols-[14rem_1fr]">
                    <p className={`text-base font-semibold text-warm-900 ${ANSWER_TYPE.num}`}>
                      {u.fee}: {u.position}
                    </p>
                    <p className="text-sm leading-relaxed text-warm-700">{u.caveats.join(" ")}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {nextStep ? (
            <div className="mt-6 border-t-2 border-warm-900 pt-5">
              <Label>Recommended next step</Label>
              <p className="mt-2 text-lg font-semibold leading-snug text-warm-900">{nextStep.action}</p>
              <p className="mt-2 text-base leading-relaxed text-warm-700">{nextStep.rationale}</p>
            </div>
          ) : null}
        </section>

        <section id="exhibits" aria-labelledby="exhibits-h" className="mt-14 flex scroll-mt-24 flex-col gap-10 border-t border-warm-300 pt-10">
          <h2 id="exhibits-h" className="text-xl font-bold text-warm-900">
            Supporting exhibits
          </h2>
          {exhibit1 ? (
            <div className="flex flex-col gap-3">
              <div>
                <Label>{exhibit1.label}</Label>
                <h3 className="mt-1 text-lg font-semibold text-warm-900">Each fee against {packet.peerGroupLabel}</h3>
              </div>
              <Legend />
              <TrackRows rows={packet.position.bars.map(feeRow)} />
              <p className={ANSWER_TYPE.caption}>Source: {sourceLine(exhibit1.table)}. In full in the appendix, with each peer by name.</p>
            </div>
          ) : null}
          {incomeExhibit && n && n.own !== null && n.median !== null && n.q1 !== null && n.q3 !== null ? (
            <div className="flex flex-col gap-3">
              <div>
                <Label>{incomeExhibit.label}</Label>
                <h3 className="mt-1 text-lg font-semibold text-warm-900">Deposit service charge income per $10,000 of total assets, quarter ending {readerAsOf(n.quarter)}</h3>
              </div>
              <TrackRows rows={[incomeRow(n)]} />
              {packet.financial.trendSummary ? <p className={`text-base text-warm-900 ${ANSWER_TYPE.num}`}>{withMarks(packet.financial.trendSummary)}</p> : null}
              <p className="text-sm leading-relaxed text-warm-600">{packet.financial.context}</p>
              <p className={ANSWER_TYPE.caption}>Source: {sourceLine(incomeExhibit.table)}</p>
            </div>
          ) : packet.financial.trendSummary ? (
            <p className="text-base text-warm-900">{withMarks(packet.financial.trendSummary)}</p>
          ) : null}
        </section>
      </article>

      <section id="appendix" aria-labelledby="appendix-h" className="mx-auto flex w-full max-w-[52rem] scroll-mt-24 flex-col gap-4">
        <h2 id="appendix-h" className="text-lg font-semibold text-warm-900">
          Evidence appendix
        </h2>
        <div className="flex flex-col gap-1">
          {exhibits.map(tableIn)}
          {sections.appendix.map((l) =>
            l.table.id === "price_and_yield" ? (
              <More key={l.anchor} label={`${l.label}: ${l.table.title}`}>
                <div id="price-and-yield" className="flex scroll-mt-24 flex-col gap-4">
                  {fees.length > 1 ? (
                    <Tabs
                      label="Fee for price and yield"
                      items={fees.map((f) => ({ label: f.name, href: `${hrefFor({ yield: f.category })}#price-and-yield`, active: f.category === packet.priceYield?.feeCategory }))}
                    />
                  ) : null}
                  <Callout>{PRICE_YIELD_LIMIT}</Callout>
                  {packet.priceYield ? <PriceYieldChart py={packet.priceYield} institutionName={packet.institutionName} /> : null}
                  <div id={l.anchor} className="scroll-mt-24">
                    <PacketTable exhibit={l.table} />
                  </div>
                </div>
              </More>
            ) : (
              tableIn(l)
            ),
          )}
          <More label="Material limitations">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-warm-800">
              {packet.brief.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </More>
          {packet.unavailable.length ? (
            <More label="Not available in this packet">
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-warm-700">
                {packet.unavailable.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </More>
          ) : null}
          <More label="Method">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-warm-700">
              {[packet.feeListNote, ...packet.method].map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="text-sm text-warm-700">
              The figures are read live and are not saved; download the PDF to keep a dated copy. The fee list comes from your{" "}
              <Link href={hrefWithInstitutionContext("/pro/monitor", String(packet.institutionId))} className="text-terra-text underline">
                watchlist
              </Link>{" "}
              when it has fees; the peer group from{" "}
              <Link href={hrefWithInstitutionContext("/pro/settings", String(packet.institutionId))} className="text-terra-text underline">
                Settings
              </Link>
              . To place a proposed price among these peers, use{" "}
              <Link href={hrefWithInstitutionContext("/pro/simulate", String(packet.institutionId))} className="text-terra-text underline">
                Try a price
              </Link>
              .
            </p>
          </More>
        </div>
        <section aria-labelledby="packet-sources" className="flex flex-col gap-3">
          <h3 id="packet-sources" className="text-sm font-semibold text-warm-900">
            Sources
          </h3>
          <ol className="flex flex-col gap-1 text-xs leading-relaxed text-warm-600">
            {packet.footnotes.map((f) => (
              <li key={f.n} id={`fn-${f.n}`} className="scroll-mt-24 break-words">
                <span className={`mr-1 font-semibold text-warm-900 ${ANSWER_TYPE.num}`}>[{f.n}]</span>
                {f.url ? (
                  <a href={f.url} className="text-terra-text underline" rel="noopener noreferrer" target="_blank">
                    {f.label}
                  </a>
                ) : (
                  f.label
                )}
                {f.detail ? ` · ${f.detail}` : ""}
                {firstUse.has(f.n) ? (
                  <>
                    {" · "}
                    <a href={`#${firstUse.get(f.n)!.anchor}`} className="-my-3 inline-flex min-h-11 items-center px-1 py-3 text-terra-text underline">
                      Back to {firstUse.get(f.n)!.label}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </section>
    </MemoPage>
  );
}
