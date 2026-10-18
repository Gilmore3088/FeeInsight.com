import { FEE_LINE_LABELS } from "@/lib/custom-report/rules";
import {
  PEER_FINANCIAL_LABELS,
  quarterOfDate,
  type PeerFinancialRow,
  type ReportPeerContext,
} from "@/lib/custom-report/peer-context";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

function money(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function percent(row: PeerFinancialRow, value: number): string {
  return `${value.toFixed(row.key === "efficiency_ratio" ? 1 : 2)}%`;
}

/** "Higher than 72% of peers", in plain words; null below the rank minimum. */
export function rankText(percentile: number | null): string {
  if (percentile === null) return "Too few peers report it";
  if (percentile >= 50) return `Higher than ${percentile}% of peers`;
  return `Lower than ${100 - percentile}% of peers`;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The report's fees and reported figures against institutions of the same charter and asset size
 * nationwide (peer-context.ts). Pricing peers, kept apart from the local competitors above: the
 * table and the prose say which group each figure belongs to.
 */
export function PeerSection({ name, peers }: { name: string; peers: ReportPeerContext }) {
  const group = peers.groupLabel.charAt(0).toLowerCase() + peers.groupLabel.slice(1);
  const filing = peers.financial?.source === "ncua" ? "NCUA 5300 Call Report" : "FDIC Call Report";
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface-0 p-4 sm:overflow-x-auto sm:p-6" aria-labelledby="peers-heading">
      <h2 id="peers-heading" className="font-bold text-xl text-ink" style={SERIF}>
        Against institutions its size
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        {name} beside {group} nationwide: their published fee schedules
        {peers.financial ? ` and their ${quarterOfDate(peers.financial.reportDate)} ${filing}s` : ""}. These are pricing peers
        across the country, not the competitors in your market.
      </p>

      {peers.fees.length > 0 && (
        <table className="mt-4 w-full text-left text-sm sm:min-w-[640px] print:min-w-0">
          <caption className="sr-only">Published fees against institutions of the same size</caption>
          <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">Fee</th>
              <th className="py-2 pr-3 text-right font-semibold">Yours</th>
              <th className="py-2 pr-3 text-right font-semibold">Peer median</th>
              <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell print:table-cell">Middle half</th>
              <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell print:table-cell">Peers publishing</th>
            </tr>
          </thead>
          <tbody>
            {peers.fees.map((row) => (
              <tr key={row.key} data-peer-fee={row.key} className="border-b border-surface-200 last:border-0">
                <td className="py-2 pr-3 text-ink">{FEE_LINE_LABELS[row.key] ?? row.key}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(row.own)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(row.median)}</td>
                <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell print:table-cell">
                  {row.p25 !== null && row.p75 !== null ? `${money(row.p25)}–${money(row.p75)}` : "—"}
                </td>
                <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell print:table-cell">
                  {row.peerCount.toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {peers.thinFeeKeys.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Too few of these peers publish {listWords(peers.thinFeeKeys.map((k) => (FEE_LINE_LABELS[k] ?? k).toLowerCase()))} to
          give a median, so {peers.thinFeeKeys.length === 1 ? "it is" : "they are"} left out.
        </p>
      )}

      {peers.financial && (
        <table className="mt-6 w-full text-left text-sm sm:min-w-[640px] print:min-w-0">
          <caption className="sr-only">Reported figures against institutions of the same size</caption>
          <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">Reported, {quarterOfDate(peers.financial.reportDate)}</th>
              <th className="py-2 pr-3 text-right font-semibold">Yours</th>
              <th className="py-2 pr-3 text-right font-semibold">Peer median</th>
              <th className="hidden py-2 font-semibold sm:table-cell print:table-cell">Among peers</th>
            </tr>
          </thead>
          <tbody>
            {peers.financial.rows.map((row) => (
              <tr key={row.key} data-peer-financial={row.key} className="border-b border-surface-200 last:border-0">
                <td className="py-2 pr-3 text-ink">{PEER_FINANCIAL_LABELS[row.key]}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{percent(row, row.own)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{percent(row, row.median)}</td>
                <td className="hidden py-2 text-ink-soft sm:table-cell print:table-cell">{rankText(row.percentile)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
        Fee medians count each institution once, from its own published schedule.
        {peers.financial &&
          ` Reported figures are as each institution filed them in its ${filing} for the quarter (${peers.financial.peerCount.toLocaleString("en-US")} institutions filed). The efficiency ratio is noninterest expense as a share of revenue.`}{" "}
        A published price does not say how often a fee is charged or waived.
      </p>
    </section>
  );
}
