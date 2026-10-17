import { PeerSetPicker } from "@/components/public/peer-set-picker";
import { formatFeeAmount } from "@/lib/format";
import { MIN_PEERS_FOR_PEER_SET_MEDIAN } from "@/lib/data-store/peer-fee-rank";
import type { PeerSetIndex } from "@/lib/data-store/public-peer-sets";

/** One fee in the exhibit: the chosen group's median beside the whole state's. */
export interface PeerSetRow {
  key: string;
  name: string;
  /** Null below MIN_PEERS_FOR_PEER_SET_MEDIAN institutions. */
  median: number | null;
  institutions: number;
  stateMedian: number | null;
}

export interface StatePeerSetView {
  options: { key: string; label: string }[];
  key: string;
  label: string;
  rows: PeerSetRow[];
  finding: string;
}

const ROWS_SHOWN = 5;
const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

function rowsFor(set: PeerSetIndex, fees: { key: string; name: string; median: number | null }[]): PeerSetRow[] {
  const byKey = new Map(set.entries.map((e) => [e.fee_category, e]));
  return fees.map((fee) => {
    const entry = byKey.get(fee.key);
    const institutions = entry?.institution_count ?? 0;
    return {
      key: fee.key,
      name: fee.name,
      median: institutions >= MIN_PEERS_FOR_PEER_SET_MEDIAN ? entry?.median_amount ?? null : null,
      institutions,
      stateMedian: fee.median,
    };
  });
}

/** The fee where the group sits furthest from the state, in dollars; about the same within 1%. */
export function peerSetStateFinding(label: string, stateName: string, rows: PeerSetRow[]): string {
  const compared = rows
    .filter((r): r is PeerSetRow & { median: number; stateMedian: number } => r.median !== null && r.stateMedian !== null && r.stateMedian > 0)
    .map((r) => ({ r, gap: r.median - r.stateMedian, share: Math.abs(r.median - r.stateMedian) / r.stateMedian }))
    .sort((a, b) => b.share - a.share);
  const top = compared[0];
  if (!top) return `Too few ${label.charAt(0).toLowerCase()}${label.slice(1)} publish these fees for a median.`;
  if (top.share <= 0.01) {
    return `${label} have about the same median as all ${stateName} institutions on ${compared.length === 1 ? "the one fee" : `all ${compared.length} fees`} compared.`;
  }
  const fee = top.r.name.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  return `${label} have a ${top.gap < 0 ? "lower" : "higher"} ${fee} median than all ${stateName} institutions: ${money(top.r.median)} against ${money(top.r.stateMedian)}.`;
}

/**
 * The state's peer sets that clear the median floor on at least one of the page's fees, and the
 * one to show: the visitor's choice (?peers=...), else the first. Null when none clears it.
 */
export function statePeerSetView(
  sets: PeerSetIndex[],
  fees: { key: string; name: string; median: number | null }[],
  stateName: string,
  requested: string | null | undefined,
): StatePeerSetView | null {
  const comparable = sets
    .map((set) => ({ set, rows: rowsFor(set, fees) }))
    .filter(({ rows }) => rows.some((r) => r.median !== null));
  if (comparable.length === 0) return null;
  const chosen = comparable.find(({ set }) => set.key === requested) ?? comparable[0];
  return {
    options: comparable.map(({ set }) => ({ key: set.key, label: set.label })),
    key: chosen.set.key,
    label: chosen.set.label,
    rows: chosen.rows,
    finding: peerSetStateFinding(chosen.set.label, stateName, chosen.rows),
  };
}

function Row({ row }: { row: PeerSetRow }) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className="py-3 pr-3 text-left text-[14px] font-medium text-ink">
        {row.name}
      </th>
      <td className="py-3 pr-3 text-right font-mono tabular-nums">
        {row.median !== null ? (
          <span className="text-[15px] font-semibold text-ink">{money(row.median)}</span>
        ) : (
          <span className="text-[13px] text-ink-muted">Too few to compare</span>
        )}
      </td>
      <td className="py-3 pr-3 text-right font-mono text-[14px] tabular-nums text-ink-soft">{row.institutions.toLocaleString("en-US")}</td>
      <td className="py-3 text-right font-mono text-[14px] tabular-nums text-ink-soft">
        {row.stateMedian !== null ? money(row.stateMedian) : "-"}
      </td>
    </tr>
  );
}

/** The exhibit: a picker of peer groups, then each fee's group median and count against the state. */
export function StatePeerSets({ view, stateName, hrefFor }: { view: StatePeerSetView; stateName: string; hrefFor: (key: string) => string }) {
  const head = (
    <thead>
      <tr className="text-[12px] text-ink-muted">
        <th scope="col" className="pb-2 pr-3 text-left font-medium">Fee</th>
        <th scope="col" className="pb-2 pr-3 text-right font-medium">Group median</th>
        <th scope="col" className="pb-2 pr-3 text-right font-medium">Institutions</th>
        <th scope="col" className="pb-2 text-right font-medium">{stateName} median</th>
      </tr>
    </thead>
  );
  const shown = view.rows.slice(0, ROWS_SHOWN);
  const rest = view.rows.slice(ROWS_SHOWN);
  return (
    <div className="space-y-5">
      <PeerSetPicker
        label="Peer group"
        current={view.key}
        options={view.options.map((option) => ({ ...option, href: hrefFor(option.key) }))}
      />
      <figure className="min-w-0">
        <figcaption className="text-[14px] font-semibold text-ink sm:text-left">{view.label}</figcaption>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse">
            {head}
            <tbody>
              {shown.map((row) => (
                <Row key={row.key} row={row} />
              ))}
            </tbody>
          </table>
        </div>
        {rest.length > 0 && (
          <details className="mt-1">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-medium text-ink underline decoration-border underline-offset-4">
              Show all {view.rows.length}
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse">
                {head}
                <tbody>
                  {rest.map((row) => (
                    <Row key={row.key} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </figure>
    </div>
  );
}
