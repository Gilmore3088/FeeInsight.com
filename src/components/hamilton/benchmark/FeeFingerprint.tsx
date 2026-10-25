/**
 * The fee position fingerprint (#1894): one strip per fee category. Each peer's price is a gray
 * mark, the middle half is shaded and the median is a line; the research institution's price is
 * the one highlighted mark. Each strip states its peer count, source and period. A fee the
 * institution does not publish stays in the list, marked missing. Descriptive only.
 */
import type { FeeFingerprint, FingerprintStrip } from "@/lib/hamilton/fee-fingerprint";

const money = (v: number) => (Number.isInteger(v) ? `$${v.toLocaleString("en-US")}` : `$${v.toFixed(2)}`);

function ordinal(n: number): string {
  const r = Math.round(n);
  const tens = r % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : r % 10 === 1 ? "st" : r % 10 === 2 ? "nd" : r % 10 === 3 ? "rd" : "th";
  return `${r}${suffix}`;
}

function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function periodText(period: FingerprintStrip["period"]): string | null {
  if (!period) return null;
  const [from, to] = [monthYear(period.from), monthYear(period.to)];
  return from === to ? `fees published ${from}` : `fees published ${from} to ${to}`;
}

const peersWord = (n: number) => (n === 1 ? "1 peer" : `${n.toLocaleString("en-US")} peers`);

/** The line under a strip: peer count, position, source and period. */
export function stripNote(strip: FingerprintStrip, fingerprint: Pick<FeeFingerprint, "minPeers" | "institutionName">): string {
  const period = periodText(strip.period);
  const tail = period ? `; ${period}` : "";
  switch (strip.status) {
    case "placed": {
      const band = strip.band!;
      const middle = band.p25 === band.p75 ? `middle half all at ${money(band.p25)}` : `middle half ${money(band.p25)} to ${money(band.p75)}`;
      const at = strip.percentile !== null ? `, ${ordinal(strip.percentile)} percentile` : "";
      return `${peersWord(strip.peerCount)}: median ${money(band.median)}, ${middle}${at}. Published fee schedules${tail}.`;
    }
    case "few_peers":
      return `Only ${peersWord(strip.peerCount)} publish this fee, fewer than the ${fingerprint.minPeers} needed for a median: ${strip.namedPeers.map((p) => `${p.institutionName} ${money(p.amount)}`).join("; ")}. Published fee schedules${tail}.`;
    case "no_peers":
      return "No peer in this group publishes this fee.";
    case "not_published":
      return strip.peerCount > 0
        ? `Missing: not on ${fingerprint.institutionName}'s published schedule. ${peersWord(strip.peerCount)} publish it${tail}.`
        : `Missing: not on ${fingerprint.institutionName}'s published schedule, and no peer in this group publishes it.`;
    case "several_amounts":
      return `The schedule states several amounts (${strip.currentLabel}), so there is no one price to place. ${peersWord(strip.peerCount)} publish it${tail}.`;
  }
}

function Strip({ strip }: { strip: FingerprintStrip }) {
  const values = [...strip.peerAmounts, ...(strip.current !== null ? [strip.current] : [])];
  if (values.length === 0) return <div className="h-4 rounded-full border border-dashed border-warm-300" aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, 1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const at = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const label = strip.current !== null
    ? `${money(strip.current)} among ${peersWord(strip.peerCount)} priced ${money(min)} to ${money(max)}`
    : `${peersWord(strip.peerCount)} priced ${money(Math.min(...strip.peerAmounts))} to ${money(Math.max(...strip.peerAmounts))}`;
  return (
    <div className="relative h-4" role="img" aria-label={label}>
      <span className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-warm-200" />
      {strip.band ? (
        <>
          <span
            className="absolute top-0.5 h-3 rounded-sm bg-warm-300/60"
            style={{ left: `${at(strip.band.p25)}%`, width: `${Math.max(at(strip.band.p75) - at(strip.band.p25), 1)}%` }}
          />
          <span className="absolute top-0 h-4 w-px -translate-x-1/2 bg-warm-700" style={{ left: `${at(strip.band.median)}%` }} />
        </>
      ) : null}
      {strip.peerAmounts.map((v, i) => (
        <span key={i} className="absolute top-1 h-2 w-2 -translate-x-1/2 rounded-full bg-warm-500/60" style={{ left: `${at(v)}%` }} />
      ))}
      {strip.current !== null ? (
        <span
          className="absolute top-0.5 h-3 w-3 -translate-x-1/2 rounded-full bg-terra ring-2 ring-white"
          style={{ left: `${at(strip.current)}%` }}
        />
      ) : null}
    </div>
  );
}

export function FeeFingerprintView({ fingerprint }: { fingerprint: FeeFingerprint }) {
  const missing = fingerprint.strips.filter((s) => s.status === "not_published").length;
  return (
    <section aria-labelledby="fee-fingerprint" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="fee-fingerprint" className="text-lg font-semibold text-warm-900">
          Fee position against {fingerprint.peerLabel}
        </h2>
        <p className="text-sm text-warm-700">
          Gray marks are peers; the highlighted mark is {fingerprint.institutionName}. Shaded: the middle half of peer
          prices; line: the median. A median and percentile appear only where at least {fingerprint.minPeers} peers
          publish the fee; with fewer, the peers are named.
          {missing > 0 ? ` ${missing} of the fees shown ${missing === 1 ? "is" : "are"} not on ${fingerprint.institutionName}'s published schedule.` : ""}
        </p>
      </div>
      <ul className="divide-y divide-warm-100 overflow-hidden rounded-lg border border-warm-300 bg-white">
        {fingerprint.strips.map((strip) => (
          <li key={strip.feeCategory} className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_6rem_minmax(0,1fr)]">
            <span className="min-w-0 text-sm text-warm-900">{strip.feeName}</span>
            <span className="text-sm font-semibold text-warm-900 [font-variant-numeric:tabular-nums] sm:text-right">
              {strip.status === "not_published" ? <span className="font-normal text-warm-600">Missing</span> : strip.currentLabel}
            </span>
            <span className="min-w-0">
              <Strip strip={strip} />
              <span className="mt-1 block text-xs text-warm-600 [font-variant-numeric:tabular-nums]">{stripNote(strip, fingerprint)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-warm-600">Source: {fingerprint.source}. Each institution counts once, and institutions that share one fee schedule count once together.</p>
    </section>
  );
}
