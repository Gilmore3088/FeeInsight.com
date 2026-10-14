import { Logo } from "@/brand/components";
import { formatFee, type HomeData, type NationalFee } from "../home-data";
import { DocTile, GreyBar, SheetFrame, delay } from "./scene-parts";
import styles from "./sizzle.module.css";

/** Scene 1: competitors' fee schedules, opened one at a time and copied by hand. */
export function CollectScene() {
  return (
    <div className="grid h-full grid-cols-[1fr_1.3fr] gap-4">
      <div className="grid grid-cols-2 content-start gap-3">
        {[0, 300, 600, 900].map((at) => (
          <DocTile key={at} at={at} />
        ))}
      </div>
      <div className={styles.in} style={delay(500)}>
        <SheetFrame rows={4} startAt={700} stepMs={250} />
      </div>
    </div>
  );
}

/** Scene 2: the spreadsheet grows; a deck and an invoice stack on top. No figures. */
export function CostScene() {
  return (
    <div className="relative grid h-full grid-cols-[1.4fr_1fr] gap-4">
      <SheetFrame rows={7} startAt={0} stepMs={90} />
      <div className="relative">
        <div className={`${styles.in} absolute inset-x-0 top-0 rounded-md border border-border bg-surface-0 p-3`} style={delay(300)}>
          <span className="font-mono text-[10px] font-medium text-ink-muted">Deck</span>
          <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
            <span className="h-8 rounded-sm bg-surface-200" />
            <span className="h-8 rounded-sm bg-surface-200" />
            <span className="h-8 rounded-sm bg-surface-200" />
          </div>
        </div>
        <div className={`${styles.in} absolute inset-x-3 top-16 flex flex-col gap-2 rounded-md border border-border bg-surface-0 p-3 shadow-fi-1`} style={delay(700)}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Invoice</span>
          <GreyBar width="70%" />
          <GreyBar width="55%" />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
            <span className="text-[11px] text-ink-muted">Amount due</span>
            <GreyBar width="30%" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Scene 3: the PDFs fold into the Bank Fee Index. Every figure here is live. */
export function IndexScene({ data }: { data: HomeData }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className={styles.in}>
        <Logo mark="bank-fee-index-wordmark" height={22} />
      </div>
      <table className="w-full border-collapse overflow-hidden rounded-md border border-border bg-surface-0 text-[13px]">
        <thead>
          <tr className="bg-surface-200 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            <th className="px-3 py-2 font-semibold">Fee</th>
            <th className="px-3 py-2 text-right font-semibold">National median</th>
            <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Institutions</th>
          </tr>
        </thead>
        <tbody>
          {data.nationalFees.length === 0 ? (
            <tr className="border-t border-border">
              <td colSpan={3} className="px-3 py-3 text-ink-muted">National medians are loading from the Bank Fee Index.</td>
            </tr>
          ) : null}
          {data.nationalFees.map((fee, i) => (
            <tr key={fee.key} className={`${styles.in} border-t border-border`} style={delay(250 + i * 220)}>
              <td className="px-3 py-2 text-ink">{fee.label}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatFee(fee.median)}</td>
              <td className="hidden px-3 py-2 text-right font-mono tabular-nums text-ink-muted sm:table-cell">
                {fee.institutions.toLocaleString("en-US")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`${styles.fade} text-[12px] text-ink-muted`} style={delay(1100)}>
        <span className="border-b-2 border-brick">Bank Fee Index</span> · {data.freshnessLabel} · read from each
        institution&apos;s own fee schedule
      </p>
      <div className={`${styles.in} mt-auto grid grid-cols-3 gap-2`} style={delay(1500)}>
        <ProofCell value={data.institutionsLabel} label="institutions" />
        <ProofCell value={data.statesLabel} label="states" />
        <ProofCell value={data.categoriesLabel} label="fee categories" />
      </div>
    </div>
  );
}

function ProofCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-paper px-3 py-2">
      <div className="font-mono text-[18px] font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-[11px] text-ink-muted">{label}</div>
    </div>
  );
}

/** Where a box sits on a 0-100 track. Example rows are geometry only; they print no dollar figure. */
interface Track {
  lo: number;
  q1: number;
  med: number;
  q3: number;
  hi: number;
}

const EXAMPLE_LAYERS: readonly { label: string; track: Track | null; you: number; position: string }[] = [
  { label: "Your market", track: { lo: 12, q1: 38, med: 52, q3: 66, hi: 88 }, you: 58, position: "Inside ●" },
  { label: "Your state", track: { lo: 6, q1: 34, med: 50, q3: 63, hi: 92 }, you: 58, position: "Inside ●" },
  { label: "Your Fed district", track: { lo: 8, q1: 30, med: 46, q3: 56, hi: 90 }, you: 58, position: "Above ▲" },
  { label: "Your peer group", track: { lo: 10, q1: 42, med: 60, q3: 72, hi: 94 }, you: 58, position: "Inside ●" },
];

/** Scene 4: one fee in five markets. The nation row is live; the others are an example. */
export function MarketsScene({ fee }: { fee: NationalFee | undefined }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {EXAMPLE_LAYERS.map((layer, i) => (
        <MarketRow key={layer.label} label={layer.label} track={layer.track} you={layer.you} position={layer.position} at={i * 450} />
      ))}
      {fee ? (
        <MarketRow
          label="The nation"
          track={nationTrack(fee)}
          you={null}
          position={`Median ${formatFee(fee.median)}`}
          at={EXAMPLE_LAYERS.length * 450}
          live
        />
      ) : null}
      <p className={`${styles.fade} mt-2 text-[11px] text-ink-muted`} style={delay(2400)}>
        Overdraft. National row: Bank Fee Index, live. Other rows: example.
      </p>
    </div>
  );
}

function nationTrack(fee: NationalFee): Track {
  const span = fee.max - fee.min || 1;
  const pct = (v: number) => 4 + ((v - fee.min) / span) * 92;
  return { lo: pct(fee.min), q1: pct(fee.q1), med: pct(fee.median), q3: pct(fee.q3), hi: pct(fee.max) };
}

function MarketRow({ label, track, you, position, at, live = false }: {
  label: string;
  track: Track | null;
  you: number | null;
  position: string;
  at: number;
  live?: boolean;
}) {
  return (
    <div className={`${styles.in} grid grid-cols-[minmax(84px,130px)_1fr_minmax(70px,104px)] items-center gap-3 border-b border-border py-1.5`} style={delay(at)}>
      <span className="text-[12px] text-ink">{label}</span>
      {track ? (
        <div className="relative h-5 w-full">
          <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
            <line x1={track.lo} x2={track.hi} y1={10} y2={10} stroke="var(--fi-control-border)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
            <rect x={track.q1} width={track.q3 - track.q1} y={4} height={12} fill="var(--fi-brick-tint)" />
            <line x1={track.med} x2={track.med} y1={2} y2={18} stroke="var(--fi-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
          {you != null ? <YouDot left={you} at={at + 250} /> : null}
        </div>
      ) : (
        <span className="text-[11px] text-ink-muted">Too few institutions for a median</span>
      )}
      <span className={`text-right text-[11px] ${live ? "font-mono text-ink" : "text-ink-muted"}`}>{position}</span>
    </div>
  );
}

/** The subject fee as a round brick dot, positioned in HTML so the stretched chart can't flatten it. */
export function YouDot({ left, at }: { left: number; at: number }) {
  return (
    <span className="absolute top-1/2 -ml-[6px] -mt-[6px] block" style={{ left: `${left}%` }}>
      <span className={`${styles.drop} block h-3 w-3 rounded-full border-2 border-paper bg-brick`} style={delay(at)} />
    </span>
  );
}
