/**
 * The pricing committee packet screen (Reports). Exhibits first, each with its source line; every
 * figure's numbered footnote links to the source list at the foot. The PDF prints the same rows
 * (committeePacketReport). Server component.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { NONE_FOUND, PRICE_YIELD_LIMIT, READING_TEXT, packetMoney, type CommitteePacket, type PacketExhibit, type PriceYield } from "@/lib/hamilton/committee-packet";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { ANSWER_TYPE, Callout, ExhibitShell, KeyFigures, LinkButton, MemoHeader, MemoPage, More, Tabs } from "@/components/hamilton/memo/memo";
import { PositionCheckPanel } from "@/components/hamilton/PositionCheckPanel";
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
            <a href={`#fn-${n}`} className="-my-2 inline-block min-w-6 px-1 py-2 text-center text-terra-text no-underline hover:underline" aria-label={`Source ${n}`}>
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
    const cells = rows.map((r) => r[c]).filter((v) => v && !/^Not found|^None found/.test(v));
    if (cells.length && cells.every((v) => FIGURE_CELL.test(v))) out.add(c);
  }
  return out;
}

/** A table from md up (scrolling inside its own box when wide); a card per row on phones. */
function PacketTable({ exhibit, firstRowOwn = false }: { exhibit: PacketExhibit; firstRowOwn?: boolean }) {
  if (!exhibit.rows.length) {
    return <p className="rounded-md border border-warm-300 bg-warm-50 px-4 py-3 text-sm text-warm-700">{exhibit.empty ?? NONE_FOUND}</p>;
  }
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
 * Each peer's published fee (across) against its fee income per $10,000 of assets (up). The axis
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
      <p className={tick}>Up: income per $10,000 of assets, {packetMoney(iy[0])} to {packetMoney(Math.round(iy[1] * 100) / 100)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-md border border-warm-200 bg-white" role="img" aria-label={`${py.feeName} against fee income per $10,000 of assets, ${py.points.length} institutions`}>
        {py.medianFee !== null ? <line x1={x(py.medianFee)} x2={x(py.medianFee)} y1={pad} y2={H - pad} className="stroke-warm-500" strokeDasharray="4 4" /> : null}
        {py.medianIncome !== null ? <line x1={pad} x2={W - pad} y1={y(py.medianIncome)} y2={y(py.medianIncome)} className="stroke-warm-500" strokeDasharray="4 4" /> : null}
        {py.points.map((p) => (
          <circle key={p.institutionId} cx={x(p.fee)} cy={y(p.incomePer10kAssets)} r={p.own ? 9 : 6} className={p.own ? "fill-terra" : p.reading ? "fill-warm-700" : "fill-warm-400"}>
            <title>{`${p.name}: ${packetMoney(p.fee)}; ${packetMoney(p.incomePer10kAssets)} per $10,000 of assets${p.reading ? `; ${READING_TEXT[p.reading]}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className={`flex justify-between gap-2 ${tick}`}>
        <span>{packetMoney(fx[0])}</span>
        <span className="text-center">Across: published {py.feeName.toLowerCase()} fee</span>
        <span>{packetMoney(fx[1])}</span>
      </div>
      <figcaption className={ANSWER_TYPE.caption}>
        Across: published {py.feeName.toLowerCase()} fee. Up: quarterly service charge income per $10,000 of assets. Dashed lines: medians of {py.peersCompared} peers. The larger terracotta point is {institutionName}.
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

function marksIn(e: PacketExhibit): number[] {
  const out: number[] = [];
  for (const row of e.rows) for (const cell of row) for (const m of cell.matchAll(MARK)) for (const n of m[1].split(", ")) out.push(Number(n));
  return out;
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
  selected: { yieldFee: string | null; positionFee: string | null; positionPrice: string | null; invalidPrice: boolean };
}) {
  const readOn = readerAsOf(packet.generatedAt);
  const sourceLine = (e: PacketExhibit) => {
    const marks = marksIn(e);
    return `${e.source[0].toUpperCase()}${e.source.slice(1)}, read ${readOn}${marks.length ? ` · notes ${noteRanges(marks)}` : ""}`;
  };
  const exhibit = (id: PacketExhibit["id"]) => packet.exhibits.find((e) => e.id === id);
  const order: PacketExhibit["id"][] = ["peer_range", "peer_fee_matrix", "competitor_moves", "fee_income_trend", "regulatory", "price_and_yield"];
  // Each source links back to the first exhibit that cites it.
  const firstUse = new Map<number, { anchor: string; label: string }>();
  order.forEach((id, i) => {
    const e = exhibit(id);
    if (!e) return;
    for (const n of marksIn(e)) if (!firstUse.has(n)) firstUse.set(n, { anchor: `exhibit-${id}`, label: `Exhibit ${i + 1}` });
  });
  const position = exhibit("position_check");
  if (position) for (const n of marksIn(position)) if (!firstUse.has(n)) firstUse.set(n, { anchor: "position", label: "Exhibit 7" });
  const reportsHref = hrefWithInstitutionContext("/pro/reports", String(packet.institutionId));
  return (
    <MemoPage>
      <MemoHeader
        kicker="Reports · Pricing committee packet"
        title={packet.title}
        compact
        dek={`Read ${readerAsOf(packet.generatedAt)} from live published fees and filings. Peers: ${packet.peerGroupLabel}.`}
        actions={
          <>
            <CommitteePacketDownload
              institutionId={packet.institutionId}
              yieldFee={selected.yieldFee}
              positionFee={packet.positionCheck?.feeCategory ?? null}
              positionPrice={packet.positionCheck?.check.proposed ?? null}
            />
            <LinkButton href={reportsHref}>Back to Reports</LinkButton>
          </>
        }
      />
      <KeyFigures figures={packet.keyFigures.map((f) => ({ value: f.value, label: f.label, title: f.label }))} />
      {order.map((id, i) => {
        const e = exhibit(id);
        if (!e) return null;
        return (
          <div key={id} id={`exhibit-${id}`} className="scroll-mt-24">
          <ExhibitShell
            label={`Exhibit ${i + 1}`}
            title={e.title}
            sub={e.subtitle}
            // The screen states the income limitation before the chart, so the note keeps the rest.
            note={id === "price_and_yield" ? e.note?.replace(PRICE_YIELD_LIMIT, "").trim() : e.note}
            source={sourceLine(e)}
          >
            {id === "price_and_yield" ? (
              <div id="price-and-yield" className="flex scroll-mt-24 flex-col gap-4">
                {fees.length > 1 ? (
                  <Tabs
                    label="Fee for price and yield"
                    items={fees.map((f) => ({ label: f.name, href: `${hrefFor({ yield: f.category })}#price-and-yield`, active: f.category === packet.priceYield?.feeCategory }))}
                  />
                ) : null}
                <Callout>{PRICE_YIELD_LIMIT}</Callout>
                {packet.priceYield ? <PriceYieldChart py={packet.priceYield} institutionName={packet.institutionName} /> : null}
                <PacketTable exhibit={e} firstRowOwn={packet.priceYield?.points[0]?.own ?? false} />
              </div>
            ) : (
              <PacketTable exhibit={e} firstRowOwn={id === "peer_fee_matrix"} />
            )}
          </ExhibitShell>
          </div>
        );
      })}
      <div>
        <PositionCheckPanel
          id="position"
          label="Exhibit 7"
          action="/pro/reports/committee#position"
          readOn={readOn}
          hidden={{ instId: String(packet.institutionId), yield: selected.yieldFee }}
          name="price"
          defaultValue={selected.positionPrice ?? undefined}
          check={packet.positionCheck?.check ?? null}
          feeName={packet.positionCheck?.feeName ?? ""}
          peerLabel={packet.positionCheck?.peerLabel ?? ""}
          fees={fees}
          feeParam="fee"
          selectedFee={selected.positionFee ?? fees[0]?.category}
          invalid={selected.invalidPrice}
        />
      </div>
      <section aria-labelledby="packet-sources" className="flex flex-col gap-3">
        <h2 id="packet-sources" className="text-lg font-bold text-warm-900 sm:text-xl">
          Sources
        </h2>
        {packet.footnotes.length ? (
          <ol className="flex flex-col gap-1.5 text-xs leading-relaxed text-warm-700">
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
                    <a href={`#${firstUse.get(f.n)!.anchor}`} className="-my-2 inline-block px-1 py-2 text-terra-text underline">
                      Back to {firstUse.get(f.n)!.label}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-warm-700">{NONE_FOUND}</p>
        )}
        <More label="How this packet is built">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-warm-700">
            {packet.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="text-sm text-warm-700">
            The figures are read live and are not saved. To keep a dated copy, download the PDF. Watched fees come from your{" "}
            <Link href={hrefWithInstitutionContext("/pro/monitor", String(packet.institutionId))} className="text-terra-text underline">
              watchlist
            </Link>
            ; the peer group from{" "}
            <Link href={hrefWithInstitutionContext("/pro/settings", String(packet.institutionId))} className="text-terra-text underline">
              Settings
            </Link>
            .
          </p>
        </More>
      </section>
    </MemoPage>
  );
}
