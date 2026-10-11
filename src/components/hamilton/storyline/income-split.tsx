/**
 * Why fee income sits where it does, drawn: the bank's deposit service charges per $1,000 of
 * deposits beside the peer median, and the gap between them split into the part published
 * prices account for and the rest (how often fees are charged and waived). Engine 1.12.1 puts
 * the numbers on the "income-split" exhibit as `incomeSplit`.
 */
import { RD } from "@/lib/report-design/tokens";
import type { IncomeSplitData } from "@/lib/hamilton/workspace/storyline-types";
import { SERIF } from "@/components/hamilton/memo/memo";

export type { IncomeSplitData };

/** "2026-06-30" reads as "Jun 30, 2026"; anything else ("Q2 2026") as given. */
function quarterLabel(q: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(q)) return q;
  return new Date(`${q.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The split carried on an exhibit, when it is there and its numbers are usable. */
export function incomeSplitOf(exhibit: unknown): IncomeSplitData | null {
  const d = (exhibit as { incomeSplit?: Partial<IncomeSplitData> } | null)?.incomeSplit;
  if (!d) return null;
  const nums = [d.own, d.peerMedian, d.priceExplained, d.otherExplained];
  return nums.every((v) => typeof v === "number" && Number.isFinite(v)) ? (d as IncomeSplitData) : null;
}

// Cents always shown: these are small per-$1,000 figures ($5.00, not $5).
const per = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const signed = (v: number) => `${v < 0 ? "−" : "+"}${per(v)}`;

/** Price index against peers (100 = peer median), as a half dial from 70 to 130. */
function PriceDial({ index }: { index: number }) {
  const lo = 70;
  const hi = 130;
  const t = Math.min(Math.max((index - lo) / (hi - lo), 0), 1);
  const angle = Math.PI * (1 - t);
  const cx = 60;
  const cy = 58;
  const r = 46;
  const pt = (a: number, rr = r) => `${cx + rr * Math.cos(a)},${cy - rr * Math.sin(a)}`;
  const arc = (a0: number, a1: number) => `M ${pt(a0)} A ${r} ${r} 0 0 1 ${pt(a1)}`;
  return (
    <svg viewBox="0 0 120 70" className="h-20 w-32 shrink-0" aria-hidden>
      <path d={arc(Math.PI, 0)} fill="none" stroke={RD.rule2} strokeWidth={10} strokeLinecap="round" />
      <path d={arc(Math.PI, angle)} fill="none" stroke={RD.terra} strokeWidth={10} strokeLinecap="round" />
      <line x1={cx} y1={cy - r - 7} x2={cx} y2={cy - r + 7} stroke={RD.ink} strokeWidth={1.5} />
      <circle cx={Number(pt(angle).split(",")[0])} cy={Number(pt(angle).split(",")[1])} r={6} fill={RD.terra} stroke={RD.paper} strokeWidth={2.5} />
    </svg>
  );
}

export function IncomeSplitChart({ data, researchInstitutionName }: { data: IncomeSplitData; researchInstitutionName?: string | null }) {
  const gap = data.own - data.peerMedian;
  const gapShare = data.peerMedian > 0 ? Math.round((gap / data.peerMedian) * 100) : null;
  const max = Math.max(data.own, data.peerMedian) || 1;
  const parts = [
    { key: "price", label: "Published prices", value: data.priceExplained, cls: "bg-terra" },
    { key: "other", label: "How often fees are charged and waived", value: data.otherExplained, cls: "bg-terra/40" },
  ];
  const total = parts.reduce((s, p) => s + Math.abs(p.value), 0);
  const bars = [
    { label: researchInstitutionName ?? "Research institution", value: data.own, cls: "bg-terra", own: true },
    { label: `Peer median (${data.n})`, value: data.peerMedian, cls: "bg-warm-400", own: false },
  ];
  return (
    <div className="flex break-inside-avoid flex-col gap-5 [font-variant-numeric:tabular-nums]">
      <p className="text-xs uppercase tracking-[0.08em] text-warm-600">
        Service charges per $1,000 of deposits{data.quarterEnd ? `, year to ${quarterLabel(data.quarterEnd)}` : ""}
      </p>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex flex-col gap-3">
          {bars.map((b) => (
            <div key={b.label} className="flex flex-col gap-1">
              <span className={`text-sm ${b.own ? "font-medium text-warm-900" : "text-warm-700"}`}>{b.label}</span>
              <span className="flex items-center gap-3">
                <span className={`h-7 rounded-r-md ${b.cls}`} style={{ width: `${Math.max((b.value / max) * 80, 2)}%` }} />
                <span className="whitespace-nowrap text-2xl leading-none text-warm-900" style={SERIF}>
                  {per(b.value)}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 rounded-lg bg-warm-100/80 px-4 py-3 sm:flex-col sm:items-start sm:gap-1">
          <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.08em] text-warm-600">The gap</span>
          <span className="whitespace-nowrap text-3xl leading-none text-terra-text" style={SERIF}>
            {signed(gap)}
          </span>
          <span className="whitespace-nowrap text-xs text-warm-700">
            per $1,000{gapShare != null && gapShare !== 0 ? ` · ${gapShare > 0 ? "+" : "−"}${Math.abs(gapShare)}%` : ""}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-warm-200 pt-4">
        <p className="text-sm text-warm-900">
          What makes up the gap of <strong className="font-semibold">{signed(gap)}</strong> per $1,000 {gap < 0 ? "below" : "above"} the median:
        </p>
        {total > 0 ? (
          <div className="flex h-9 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label={parts.map((p) => `${p.label} ${signed(p.value)}`).join(", ")}>
            {parts.map((p) => {
              const share = Math.abs(p.value) / total;
              return (
                <span key={p.key} className={`flex items-center px-2 text-xs font-semibold ${p.cls} ${p.key === "price" ? "text-white" : "text-warm-900"}`} style={{ width: `${share * 100}%` }}>
                  {share > 0.12 ? `${Math.round(share * 100)}%` : ""}
                </span>
              );
            })}
          </div>
        ) : null}
        <ul className="flex flex-col gap-1 text-sm">
          {parts.map((p) => (
            <li key={p.key} className="flex items-start gap-2">
              <span aria-hidden className={`mt-1 h-3 w-3 shrink-0 rounded-sm ${p.cls}`} />
              <span className="min-w-0 flex-1 text-warm-800">{p.label}</span>
              <span className="whitespace-nowrap font-semibold text-warm-900">{signed(p.value)}</span>
              {total > 0 ? <span className="w-10 shrink-0 text-right text-warm-600">{Math.round((Math.abs(p.value) / total) * 100)}%</span> : null}
            </li>
          ))}
        </ul>
      </div>
      {data.priceIndex != null ? (
        <div className="flex items-center gap-4 border-t border-warm-200 pt-4">
          <PriceDial index={data.priceIndex} />
          <p className="text-sm text-warm-700">
            {researchInstitutionName ? `${researchInstitutionName}'s` : "The research institution's"} published prices index at <strong className="font-semibold text-warm-900">{Math.round(data.priceIndex)}</strong> against a peer median of 100
            (the tick). Peers: {data.peerLabel}.
          </p>
        </div>
      ) : (
        <p className="text-xs text-warm-600">Peers: {data.peerLabel}.</p>
      )}
    </div>
  );
}
