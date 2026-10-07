/**
 * Why fee income sits where it does, drawn: the bank's deposit service charges per $1,000 of
 * deposits beside the peer median, and the gap between them split into the part published
 * prices account for and the rest (how often fees are charged and waived). Engine 1.12.1 puts
 * the numbers on the "income-split" exhibit as `incomeSplit`.
 */

export interface IncomeSplitData {
  unit: "per_1000_deposits";
  own: number;
  peerMedian: number;
  peerLabel: string;
  n: number;
  /** The bank's published prices against the peer median as 100; null when no fee compares. */
  priceIndex: number | null;
  /** Signed $ per $1,000 of deposits; the two add up to own minus peerMedian. */
  priceExplained: number;
  otherExplained: number;
  quarterEnd?: string | null;
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

function Bar({ label, value, max, own }: { label: string; value: number; max: number; own?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <span className={own ? "font-medium text-warm-900" : "text-warm-700"}>{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={`h-5 rounded-sm ${own ? "bg-warm-900" : "bg-warm-400"}`}
          style={{ width: `${Math.max((value / (max || 1)) * 100, 2)}%` }}
        />
        <span className="whitespace-nowrap font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">{per(value)}</span>
      </span>
    </div>
  );
}

export function IncomeSplitChart({ data }: { data: IncomeSplitData }) {
  const gap = data.own - data.peerMedian;
  const max = Math.max(data.own, data.peerMedian);
  const parts = [
    { key: "price", label: "Published prices", value: data.priceExplained, cls: "bg-terra" },
    { key: "other", label: "How often fees are charged and waived", value: data.otherExplained, cls: "bg-warm-500" },
  ];
  const total = parts.reduce((s, p) => s + Math.abs(p.value), 0);
  return (
    <div className="flex flex-col gap-5 rounded-md border border-warm-200 bg-white p-4 [font-variant-numeric:tabular-nums]">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.08em] text-warm-600">Service charges per $1,000 of deposits{data.quarterEnd ? `, year to ${data.quarterEnd}` : ""}</p>
        <Bar label="You" value={data.own} max={max} own />
        <Bar label={`Peer median (${data.n})`} value={data.peerMedian} max={max} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-warm-900">
          The gap: <strong className="font-semibold">{signed(gap)}</strong> per $1,000, {gap < 0 ? "below" : "above"} the median
        </p>
        {total > 0 ? (
          <div className="flex h-6 w-full overflow-hidden rounded-sm" role="img" aria-label={parts.map((p) => `${p.label} ${signed(p.value)}`).join(", ")}>
            {parts.map((p) => (
              <span key={p.key} className={p.cls} style={{ width: `${(Math.abs(p.value) / total) * 100}%` }} />
            ))}
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
        <p className="text-xs text-warm-600">
          Your published prices index at <strong className="font-semibold text-warm-900">{Math.round(data.priceIndex)}</strong> against a peer median of 100. Peers: {data.peerLabel}.
        </p>
      ) : (
        <p className="text-xs text-warm-600">Peers: {data.peerLabel}.</p>
      )}
    </div>
  );
}
