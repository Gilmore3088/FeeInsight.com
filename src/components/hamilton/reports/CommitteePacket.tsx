/**
 * The pricing committee packet screen (Reports). Exhibits first, each with its source line; every
 * figure's numbered footnote links to the source list at the foot. The PDF prints the same rows
 * (committeePacketReport). Server component.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { readerAsOf } from "@/lib/hamilton/board-brief";
import { NONE_FOUND, READING_TEXT, packetMoney, type CommitteePacket, type PacketExhibit, type PriceYield } from "@/lib/hamilton/committee-packet";
import { ANSWER_TYPE, ExhibitShell, KeyFigures, LinkButton, MemoHeader, MemoPage, More, Tabs } from "@/components/hamilton/memo/memo";
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
      <sup key={m.index} className="ml-0.5 text-[10px] text-warm-600">
        [
        {ns.map((n, i) => (
          <span key={n}>
            {i > 0 ? ", " : ""}
            <a href={`#fn-${n}`} className="text-terra-text no-underline hover:underline" aria-label={`Source ${n}`}>
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

/** A table from md up (scrolling inside its own box when wide); a card per row on phones. */
function PacketTable({ exhibit, firstRowOwn = false }: { exhibit: PacketExhibit; firstRowOwn?: boolean }) {
  if (!exhibit.rows.length) {
    return <p className="rounded-md border border-warm-300 bg-warm-50 px-4 py-3 text-sm text-warm-700">{exhibit.empty ?? NONE_FOUND}</p>;
  }
  const [lead, ...rest] = exhibit.columns;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-warm-300 bg-white md:block" tabIndex={0} role="region" aria-label={`${exhibit.title}; scroll sideways if needed`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-200">
              {exhibit.columns.map((c) => (
                <th key={c} scope="col" className={ANSWER_TYPE.th}>
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
                    <th key={c} scope="row" className="min-w-[9rem] px-3 py-2 text-left font-medium text-warm-900">
                      {withMarks(cell)}
                    </th>
                  ) : (
                    <td key={c} className={`min-w-[7rem] px-3 py-2 ${ANSWER_TYPE.num}`}>
                      {withMarks(cell)}
                    </td>
                  )
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
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

/** Each peer's published fee (across) against its fee income per $10,000 of assets (up). */
function PriceYieldChart({ py }: { py: PriceYield }) {
  if (py.points.length < 2) return null;
  const W = 640;
  const H = 260;
  const pad = { l: 56, r: 16, t: 12, b: 36 };
  const fees = py.points.map((p) => p.fee);
  const incomes = py.points.map((p) => p.incomePer10kAssets);
  const fx = [Math.min(...fees), Math.max(...fees)];
  const iy = [Math.min(0, ...incomes), Math.max(...incomes)];
  const span = (lo: number, hi: number) => (hi - lo || 1);
  const x = (v: number) => pad.l + ((v - fx[0]) / span(fx[0], fx[1])) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - iy[0]) / span(iy[0], iy[1] * 1.08)) * (H - pad.t - pad.b);
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${py.feeName} against fee income per $10,000 of assets, ${py.points.length} institutions`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="stroke-warm-300" />
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} className="stroke-warm-300" />
        {py.medianFee !== null ? <line x1={x(py.medianFee)} x2={x(py.medianFee)} y1={pad.t} y2={H - pad.b} className="stroke-warm-500" strokeDasharray="4 4" /> : null}
        {py.medianIncome !== null ? <line x1={pad.l} x2={W - pad.r} y1={y(py.medianIncome)} y2={y(py.medianIncome)} className="stroke-warm-500" strokeDasharray="4 4" /> : null}
        <text x={pad.l} y={H - 8} className="fill-warm-600 text-[11px]">{packetMoney(fx[0])}</text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-warm-600 text-[11px]">{packetMoney(fx[1])}</text>
        <text x={(pad.l + W - pad.r) / 2} y={H - 8} textAnchor="middle" className="fill-warm-600 text-[11px]">{py.feeName}</text>
        <text x={pad.l - 6} y={pad.t + 10} textAnchor="end" className="fill-warm-600 text-[11px]">{packetMoney(Math.round(iy[1] * 100) / 100)}</text>
        <text x={pad.l - 6} y={H - pad.b} textAnchor="end" className="fill-warm-600 text-[11px]">{packetMoney(iy[0])}</text>
        {py.points.map((p) => (
          <circle key={p.institutionId} cx={x(p.fee)} cy={y(p.incomePer10kAssets)} r={p.own ? 6 : 4} className={p.own ? "fill-terra" : p.reading ? "fill-warm-700" : "fill-warm-400"}>
            <title>{`${p.name}: ${packetMoney(p.fee)}; ${packetMoney(p.incomePer10kAssets)} per $10,000 of assets${p.reading ? `; ${READING_TEXT[p.reading]}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className={ANSWER_TYPE.caption}>
        Across: published {py.feeName.toLowerCase()} fee. Up: quarterly service charge income per $10,000 of assets. Dashed lines: the peer medians. The larger terracotta point is the institution.
      </figcaption>
    </figure>
  );
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
  const sourceLine = (e: PacketExhibit) => {
    const marks = new Set<string>();
    for (const row of e.rows) for (const cell of row) for (const m of cell.matchAll(MARK)) for (const n of m[1].split(", ")) marks.add(n);
    return marks.size ? `numbered notes ${[...marks].sort((a, b) => Number(a) - Number(b)).slice(0, 12).join(", ")}${marks.size > 12 ? " and more" : ""}, read ${readerAsOf(packet.generatedAt)}` : `read ${readerAsOf(packet.generatedAt)}`;
  };
  const exhibit = (id: PacketExhibit["id"]) => packet.exhibits.find((e) => e.id === id);
  const order: PacketExhibit["id"][] = ["peer_range", "peer_fee_matrix", "competitor_moves", "fee_income_trend", "regulatory", "price_and_yield"];
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
            <LinkButton href={`/pro/reports?instId=${packet.institutionId}`}>Back to Reports</LinkButton>
          </>
        }
      />
      <KeyFigures figures={packet.keyFigures.map((f) => ({ value: f.value, label: f.label, title: f.label }))} />
      {order.map((id, i) => {
        const e = exhibit(id);
        if (!e) return null;
        return (
          <ExhibitShell key={id} label={`Exhibit ${i + 1}`} title={e.title} sub={e.subtitle} note={e.note} source={sourceLine(e)}>
            {id === "price_and_yield" ? (
              <div className="flex flex-col gap-4">
                {fees.length > 1 ? (
                  <Tabs
                    label="Fee for price and yield"
                    items={fees.map((f) => ({ label: f.name, href: `${hrefFor({ yield: f.category })}#price-and-yield`, active: f.category === packet.priceYield?.feeCategory }))}
                  />
                ) : null}
                <div id="price-and-yield" className="scroll-mt-24">
                  {packet.priceYield ? <PriceYieldChart py={packet.priceYield} /> : null}
                </div>
                <PacketTable exhibit={e} firstRowOwn={packet.priceYield?.points[0]?.own ?? false} />
              </div>
            ) : (
              <PacketTable exhibit={e} firstRowOwn={id === "peer_fee_matrix"} />
            )}
          </ExhibitShell>
        );
      })}
      <div id="position" className="scroll-mt-24">
        <PositionCheckPanel
          action="/pro/reports/committee"
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
            <Link href={`/pro/monitor?instId=${packet.institutionId}`} className="text-terra-text underline">
              watchlist
            </Link>
            ; the peer group from{" "}
            <Link href={`/pro/settings?instId=${packet.institutionId}`} className="text-terra-text underline">
              Settings
            </Link>
            .
          </p>
        </More>
      </section>
    </MemoPage>
  );
}
