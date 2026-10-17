/**
 * The pricing committee packet screen (Reports). It leads with exhibits, not prose: four key
 * figures, Exhibit 1 drawn as one range row per fee, the fees for review as short cards, and the
 * filed income as a chart with its normalized figures. Every table sits one tap away under its
 * exhibit or in the appendix, and limitations, method and sources close the page. Each figure's
 * numbered footnote links to the source list. The PDF (CommitteePacketPdf) prints the same
 * exhibits. A printable document: no form sits in it; a proposed price is placed on Try a price
 * (/pro/simulate). Server component.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { PRICE_YIELD_LIMIT, READING_TEXT, footnoteMarks, inText, packetMoney, per10k, packetSections, type CommitteePacket, type LabelledTable, type PacketFeeBar, type PacketIncomeSeries, type PacketTable as PacketTableData, type PriceYield } from "@/lib/hamilton/committee-packet";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { ANSWER_TYPE, Callout, ExhibitShell, KeyFigures, LinkButton, MemoHeader, MemoPage, More, QuarterLines, SectionHeading, Tabs, type KeyFigureTile } from "@/components/hamilton/memo/memo";
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

/** A part of the packet: its h2 and what sits under it. */
function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-24 flex-col gap-6 border-t border-warm-300 pt-6">
      <h2 id={`${id}-h`} className="text-xl font-bold text-warm-900 sm:text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

const BAND_WORD = { above: "Above", within: "Within", below: "Below" } as const;

/** The four figures over the brief: how many fees sit above, within and below the peers, and income. */
function glanceTiles(packet: CommitteePacket): KeyFigureTile[] {
  const g = packet.glance;
  const of = (count: number) => `${count} of ${g.placed}`;
  const tiles: KeyFigureTile[] = g.placed
    ? [
        { value: of(g.above), label: "Fees above the peers' middle 50%", title: "Above" },
        { value: of(g.within), label: "Fees within it", title: "Within" },
        { value: of(g.below), label: "Fees below it", title: "Below" },
      ]
    : [{ value: `${g.published} of ${g.fees}`, label: "Fees published; too few peers publish any of them to place", title: "Published" }];
  const n = packet.financial.normalized;
  if (n && n.own !== null && n.median !== null) {
    tiles.push({ value: per10k(n.own), label: `Fee income per $10,000 of assets; peer median ${per10k(n.median)}`, title: "Income" });
  }
  return tiles;
}

/** A fee row's scale: the peers' full spread and the bank's value, padded so no mark sits on an edge. */
function barScale(b: PacketFeeBar): (v: number) => number {
  const values = [b.low, b.high, b.current, b.median].filter((v): v is number => v !== null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(hi * 0.2, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  return (v) => Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100));
}

/** One fee: the peers' spread as a line, their middle 50% as a band, the median as a tick, the bank as a dot. */
function FeeBarRow({ bar, institutionName }: { bar: PacketFeeBar; institutionName: string }) {
  const placed = bar.median !== null && bar.q1 !== null && bar.q3 !== null && bar.low !== null && bar.high !== null;
  const x = placed ? barScale(bar) : null;
  const outside = bar.band === "above" || bar.band === "below";
  const name = (
    <span className="font-medium text-warm-900">
      {bar.name}
      {bar.comparedWith ? <span className="block text-xs font-normal text-warm-600">Compared with {bar.comparedWith}</span> : null}
    </span>
  );
  const value = bar.current === null ? (
    <span className={`text-warm-600 ${ANSWER_TYPE.num}`}>
      Not on the schedule{placed ? ` · median ${packetMoney(bar.median as number)}` : ""}
      {bar.marks ? <span className="text-xs">{withMarks(bar.marks)}</span> : null}
    </span>
  ) : (
    <span className={ANSWER_TYPE.num}>
      <span className={`font-semibold ${outside ? "text-terra-text" : "text-warm-900"}`}>{packetMoney(bar.current)}</span>
      {placed ? <span className="text-warm-600"> · median {packetMoney(bar.median as number)}</span> : null}
      {bar.marks ? <span className="text-xs">{withMarks(bar.marks)}</span> : null}
    </span>
  );
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border-b border-warm-200 py-3 last:border-0 md:grid-cols-[13rem_1fr_15rem]">
      <div className="text-sm">{name}</div>
      <div className="order-3 col-span-2 md:order-none md:col-span-1">
        {x ? (
          <div
            role="img"
            aria-label={`${bar.name}: ${institutionName} ${bar.current === null ? "does not publish it" : packetMoney(bar.current)}; peers' middle 50% ${packetMoney(bar.q1 as number)} to ${packetMoney(bar.q3 as number)}; median ${packetMoney(bar.median as number)} of ${bar.peers} peers`}
            className="relative h-8"
          >
            <span className="absolute top-1/2 h-px -translate-y-1/2 bg-warm-400" style={{ left: `${x(bar.low as number)}%`, width: `${x(bar.high as number) - x(bar.low as number)}%` }} />
            <span className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm bg-warm-300" style={{ left: `${x(bar.q1 as number)}%`, width: `${Math.max(1, x(bar.q3 as number) - x(bar.q1 as number))}%` }} />
            <span className="absolute top-1/2 h-6 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-warm-900" style={{ left: `${x(bar.median as number)}%` }} />
            {bar.current !== null ? (
              <span
                className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${outside ? "bg-terra" : "bg-warm-700"}`}
                style={{ left: `${x(bar.current)}%` }}
              />
            ) : null}
            <span className={`absolute -bottom-1.5 left-0 text-[11px] text-warm-500 ${ANSWER_TYPE.num}`} style={{ left: `${x(bar.low as number)}%` }}>
              {packetMoney(bar.low as number)}
            </span>
            <span className={`absolute -bottom-1.5 -translate-x-full text-[11px] text-warm-500 ${ANSWER_TYPE.num}`} style={{ left: `${x(bar.high as number)}%` }}>
              {packetMoney(bar.high as number)}
            </span>
          </div>
        ) : (
          <p className="text-xs text-warm-600">{bar.peers === 0 ? "No peer publishes it" : `Only ${bar.peers} ${bar.peers === 1 ? "peer publishes" : "peers publish"} it; not placed`}</p>
        )}
      </div>
      <div className="text-right text-sm">
        {value}
        {bar.band && placed ? <span className="block text-xs text-warm-600">{BAND_WORD[bar.band]} · {bar.peers} peers</span> : null}
      </div>
    </li>
  );
}

function PositionChart({ bars, institutionName }: { bars: PacketFeeBar[]; institutionName: string }) {
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-warm-700">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-terra" />Your fee, outside the middle 50%</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-warm-700" />Within it</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-warm-300" />Peers&apos; middle 50%</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-0.5 bg-warm-900" />Peer median</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-px w-5 bg-warm-400" />Lowest to highest peer</span>
      </figcaption>
      <ul className="rounded-lg border border-warm-300 bg-white px-4">
        {bars.map((b) => (
          <FeeBarRow key={b.feeCategory} bar={b} institutionName={institutionName} />
        ))}
      </ul>
    </figure>
  );
}

/**
 * The bank's own filed income by quarter (QuarterLines reads thousands). No peer line: a median in
 * raw dollars across a size band mixes in size, so peers are compared per $10,000 of assets beside it.
 */
function IncomeChart({ series, institutionName }: { series: PacketIncomeSeries; institutionName: string }) {
  return <QuarterLines quarters={series.quarters} series={[{ label: institutionName, values: series.own.map((v) => v / 1000), own: true }]} />;
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
  const sourceLine = (t: PacketTableData) => {
    const marks = tableMarks(t);
    return `${t.source[0].toUpperCase()}${t.source.slice(1)}, read ${readOn}${marks.length ? ` · notes ${noteRanges(marks)}` : ""}`;
  };
  // Each source links back to the first place that cites it.
  const firstUse = new Map<number, { anchor: string; label: string }>();
  const cite = (marks: number[], anchor: string, label: string) => {
    for (const n of marks) if (!firstUse.has(n)) firstUse.set(n, { anchor, label });
  };
  cite([...packet.position.bars.map((b) => b.marks), ...packet.brief.priorities.map((p) => p.fact)].flatMap(footnoteMarks), "brief", "the executive brief");
  for (const l of [...sections.position, ...sections.financial, ...sections.appendix]) cite(tableMarks(l.table), l.anchor, l.label);
  const reportsHref = hrefWithInstitutionContext("/pro/reports", String(packet.institutionId));
  const [exhibit1, ...otherPosition] = sections.position;
  const trend = sections.financial.find((l) => l.table.id === "income_trend");
  const normalizedTable = sections.financial.find((l) => l.table.id === "normalized_income");
  const n = packet.financial.normalized;
  const tableIn = (l: LabelledTable) => (
    <More key={l.anchor} label={`${l.label}: ${l.table.title}`}>
      <div id={l.anchor} className="scroll-mt-24">
        {l.table.subtitle ? <p className="mb-2 text-xs text-warm-600">{l.table.subtitle}</p> : null}
        <PacketTable exhibit={l.table} />
        {l.table.note ? <p className="mt-2 text-xs leading-relaxed text-warm-600">{l.table.note}</p> : null}
        <p className="mt-1 text-xs text-warm-600">Source: {sourceLine(l.table)}</p>
      </div>
    </More>
  );
  return (
    <MemoPage>
      <MemoHeader
        kicker="Reports · Pricing committee packet"
        title={packet.title}
        compact
        dek={`Read ${readOn}. Peers: ${packet.peerGroupLabel}.`}
        actions={
          <>
            <CommitteePacketDownload institutionId={packet.institutionId} yieldFee={selected.yieldFee} />
            <LinkButton href={reportsHref}>Back to Reports</LinkButton>
          </>
        }
      />

      <Part id="brief" title="Executive brief">
        <KeyFigures figures={glanceTiles(packet)} />

        {exhibit1 ? (
          <div id={exhibit1.anchor} className="flex scroll-mt-24 flex-col gap-3">
            <div>
              <p className={ANSWER_TYPE.kicker}>{exhibit1.label}</p>
              <h3 className={`mt-1 ${ANSWER_TYPE.section} font-semibold`}>Where each fee sits among {packet.peerGroupLabel}</h3>
            </div>
            <PositionChart bars={packet.position.bars} institutionName={packet.institutionName} />
            <p className={ANSWER_TYPE.caption}>Source: {sourceLine(exhibit1.table)}</p>
            <More label="Exhibit 1 as a table">
              {exhibit1.table.subtitle ? <p className="text-xs text-warm-600">{exhibit1.table.subtitle}</p> : null}
              <PacketTable exhibit={exhibit1.table} />
              {exhibit1.table.note ? <p className="text-xs leading-relaxed text-warm-600">{exhibit1.table.note}</p> : null}
            </More>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <SectionHeading>Priorities for review</SectionHeading>
          {packet.brief.priorities.length ? (
            <>
              <p className={ANSWER_TYPE.caption}>Fees outside the peers&apos; middle 50%. Questions to look into, not pricing recommendations.</p>
              <ul className="grid gap-3 md:grid-cols-2">
                {packet.brief.priorities.map((p) => (
                  <li key={p.feeCategory} className="flex flex-col gap-1.5 rounded-lg border border-warm-300 bg-white px-4 py-3 text-sm">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-warm-900">{p.fee}</span>
                      <span className="shrink-0 rounded-full bg-terra-soft px-2 py-0.5 text-xs font-medium text-terra-text">{BAND_WORD[p.band]} the middle 50%</span>
                    </p>
                    <p className={`text-warm-800 ${ANSWER_TYPE.num}`}>{withMarks(p.fact)}</p>
                    <p className="text-warm-700">{p.question}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-warm-700">{packet.brief.prioritiesNote}</p>
          )}
        </div>
      </Part>

      {otherPosition.length || packet.position.comparedNote ? (
        <Part id="position" title="Competitive position">
          {otherPosition.map((l) => (
            <div key={l.anchor} id={l.anchor} className="scroll-mt-24">
              <ExhibitShell label={l.label} title={l.table.title} sub={l.table.subtitle ?? undefined} note={l.table.note ?? undefined} source={sourceLine(l.table)}>
                <PacketTable exhibit={l.table} />
              </ExhibitShell>
            </div>
          ))}
          {packet.position.comparedNote ? <p className="text-sm text-warm-800">{withMarks(packet.position.comparedNote)}</p> : null}
        </Part>
      ) : null}

      <Part id="financial" title="Financial context">
        {trend || n ? (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            {trend ? (
              <div id={trend.anchor} className="flex scroll-mt-24 flex-col gap-2">
                <p className={ANSWER_TYPE.kicker}>{trend.label}</p>
                <h3 className="text-base font-semibold text-warm-900">Deposit service charge income by quarter</h3>
                {packet.financial.series ? <IncomeChart series={packet.financial.series} institutionName={packet.institutionName} /> : null}
                {packet.financial.trendSummary ? <p className={`text-sm text-warm-800 ${ANSWER_TYPE.num}`}>{withMarks(packet.financial.trendSummary)}</p> : null}
              </div>
            ) : null}
            {normalizedTable && n && n.own !== null && n.median !== null ? (
              <div id={normalizedTable.anchor} className="flex scroll-mt-24 flex-col gap-2">
                <p className={ANSWER_TYPE.kicker}>{normalizedTable.label}</p>
                <h3 className="text-base font-semibold text-warm-900">Per $10,000 of total assets, {readerAsOf(n.quarter)}</h3>
                <KeyFigures
                  figures={[
                    { value: per10k(n.own), label: packet.institutionName, title: "Own" },
                    { value: per10k(n.median), label: `Median of ${n.peersCompared} peers`, title: "Median" },
                  ]}
                />
                {n.q1 !== null && n.q3 !== null ? (
                  <p className={`text-sm text-warm-800 ${ANSWER_TYPE.num}`}>
                    Middle 50% {per10k(n.q1)} to {per10k(n.q3)}{n.placement ? `; ${n.placement}` : ""}.
                  </p>
                ) : null}
                <p className={ANSWER_TYPE.caption}>{packet.financial.context}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-warm-700">No filed income for this packet; see Not available in this packet.</p>
        )}
        {sections.financial.length ? <div className="flex flex-col gap-1">{sections.financial.map(tableIn)}</div> : null}
      </Part>

      <Part id="appendix" title="Appendix">
        <div className="flex flex-col gap-1">
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
              {packet.method.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="text-sm text-warm-700">
              {packet.feeListNote} The figures are read live and are not saved; download the PDF to keep a dated copy. The fee list comes from your{" "}
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
      </Part>
    </MemoPage>
  );
}
