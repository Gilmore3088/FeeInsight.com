import type { ReactNode } from "react";
import { PeerSetPicker } from "@/components/public/peer-set-picker";
import { formatFeeAmount } from "@/lib/format";
import { MIN_PEERS_FOR_PEER_SET_MEDIAN } from "@/lib/data-store/peer-fee-rank";
import { ASSET_TIER_RANGES } from "@/lib/hamilton/peer-index";
import type { PeerSetIndex } from "@/lib/data-store/public-peer-sets";

/** One fee in the exhibit: the chosen group's median beside the whole state's. */
export interface PeerSetRow {
  key: string;
  name: string;
  /** Null below MIN_PEERS_FOR_PEER_SET_MEDIAN institutions. */
  median: number | null;
  institutions: number;
  stateMedian: number | null;
  /** Institutions in the whole state's median. */
  stateInstitutions: number;
}

/** One fee the state page shows, with the whole state's median and how many institutions it counts. */
export interface StateFee {
  key: string;
  name: string;
  median: number | null;
  institutions: number;
}

export interface StatePeerSetView {
  options: { key: string; label: string }[];
  key: string;
  label: string;
  rows: PeerSetRow[];
  finding: string;
}

const ROWS_SHOWN = 5;

/** An asset band's chip, from the one range table: "Under $300M", "$300M to $1B". */
const sizeChip = (tier: string) => {
  const range = ASSET_TIER_RANGES[tier] ?? tier;
  return { group: "Size", label: `${range.charAt(0).toUpperCase()}${range.slice(1)}` };
};

/** Short chip text under a sub-label; the full plain-words label stays in the caption. */
const CHIPS: Record<string, { group: string; label: string }> = {
  community_small: sizeChip("community_small"),
  community_mid: sizeChip("community_mid"),
  community_large: sizeChip("community_large"),
  regional: sizeChip("regional"),
  occ: { group: "Bank regulator", label: "OCC" },
  fdic: { group: "Bank regulator", label: "FDIC" },
  fed: { group: "Bank regulator", label: "Federal Reserve" },
  federal_cu: { group: "Credit union charter", label: "Federal charter" },
  state_cu: { group: "Credit union charter", label: "State charter" },
};
const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;
const count = (n: number) => n.toLocaleString("en-US");

function rowsFor(set: PeerSetIndex, fees: StateFee[]): PeerSetRow[] {
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
      stateInstitutions: fee.institutions,
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
    return `${label} have about the same median as all ${stateName} banks and credit unions together on ${compared.length === 1 ? "the one fee" : `all ${compared.length} fees`} compared.`;
  }
  const fee = top.r.name.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  return `${label} have a ${top.gap < 0 ? "lower" : "higher"} ${fee} median than all ${stateName} banks and credit unions together (${money(top.r.median)} across ${count(top.r.institutions)} against ${money(top.r.stateMedian)} across ${count(top.r.stateInstitutions)}).`;
}

/**
 * The state's peer sets that clear the median floor on at least one of the page's fees, and the
 * one to show: the visitor's choice (?peers=...), else the first. Null when none clears it.
 */
export function statePeerSetView(
  sets: PeerSetIndex[],
  fees: StateFee[],
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

function Row({ row, stateName }: { row: PeerSetRow; stateName: string }) {
  return (
    <li className="grid grid-cols-3 gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] sm:items-baseline">
      <p className="col-span-3 text-[14px] font-medium text-ink sm:col-span-1 sm:text-left">{row.name}</p>
      <Cell label="Group median">
        {row.median !== null ? (
          <span className="text-[15px] font-semibold text-ink">{money(row.median)}</span>
        ) : (
          <span className="text-[13px] text-ink-muted">Too few to compare</span>
        )}
      </Cell>
      <Cell label="Institutions">
        <span className="text-[14px] text-ink-soft">{count(row.institutions)}</span>
      </Cell>
      <Cell label={`All ${stateName}`}>
        {row.stateMedian !== null ? (
          <>
            <span className="text-[14px] text-ink-soft">{money(row.stateMedian)}</span>
            <span className="block font-sans text-[12px] text-ink-muted">of {count(row.stateInstitutions)}</span>
          </>
        ) : (
          <span className="text-[13px] text-ink-muted">Too few to compare</span>
        )}
      </Cell>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 sm:text-right">
      <p className="text-[11px] text-ink-muted sm:sr-only">{label}</p>
      <p className="mt-0.5 font-mono tabular-nums sm:mt-0 sm:text-right">{children}</p>
    </div>
  );
}

/** The exhibit: a picker of peer groups, then each fee's group median and count against the whole state. */
export function StatePeerSets({
  view,
  stateName,
  hrefFor,
}: {
  view: StatePeerSetView;
  stateName: string;
  hrefFor: (key: string) => string;
}) {
  const head = (
    <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] gap-x-4 pb-2 text-[12px] font-medium text-ink-muted sm:grid" aria-hidden="true">
      <span>Fee</span>
      <span className="text-right">Group median</span>
      <span className="text-right">Institutions</span>
      <span className="text-right">All {stateName} banks and credit unions</span>
    </div>
  );
  const shown = view.rows.slice(0, ROWS_SHOWN);
  const rest = view.rows.slice(ROWS_SHOWN);
  return (
    <div className="space-y-5">
      <PeerSetPicker
        label="Peer group"
        current={view.key}
        surface="paper"
        options={view.options.map((option) => ({
          key: option.key,
          label: CHIPS[option.key]?.label ?? option.label,
          group: CHIPS[option.key]?.group,
          href: hrefFor(option.key),
        }))}
      />
      <figure className="min-w-0">
        <figcaption className="text-[14px] font-semibold text-ink sm:text-left">{view.label}</figcaption>
        <div className="mt-3">
          {head}
          <ul className="divide-y divide-border border-y border-border">
            {shown.map((row) => (
              <Row key={row.key} row={row} stateName={stateName} />
            ))}
          </ul>
        </div>
        {rest.length > 0 && (
          <details className="mt-1">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-medium text-ink underline decoration-border underline-offset-4">
              Show all {view.rows.length}
            </summary>
            <ul className="divide-y divide-border border-b border-border">
              {rest.map((row) => (
                <Row key={row.key} row={row} stateName={stateName} />
              ))}
            </ul>
          </details>
        )}
      </figure>
      <details className="text-[12px] text-ink-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink">How groups are counted</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-left">
          <li>Each institution counts once: its highest overdraft fee, the middle of its schedule for other fees.</li>
          <li>Size bands come from FDIC and NCUA total assets, bank regulator from the FDIC registry and credit union charter from NCUA.</li>
          <li>The {stateName} median counts every institution headquartered in the state that publishes the fee.</li>
        </ul>
      </details>
    </div>
  );
}
