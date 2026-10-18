import { Users } from "lucide-react";
import { PeerSetPicker } from "@/components/public/peer-set-picker";
import { PeerGapChip, peerGap } from "@/components/public/peer-gap-chip";
import "@/app/landing-motion.css";
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

/**
 * One short line under the group's name: the fee where the group sits furthest from the whole
 * state, by share, and the dollar gap ("Overdraft runs $1.75 above the Florida median."). The
 * rows carry the amounts and counts. Within 1% on every fee reads as matching.
 */
export function peerSetStateFinding(label: string, stateName: string, rows: PeerSetRow[]): string {
  const compared = rows
    .filter((r): r is PeerSetRow & { median: number; stateMedian: number } => r.median !== null && r.stateMedian !== null && r.stateMedian > 0)
    .map((r) => ({ r, gap: peerGap(r.median, r.stateMedian), share: Math.abs(r.median - r.stateMedian) / r.stateMedian }))
    .sort((a, b) => b.share - a.share);
  const top = compared[0];
  if (!top) return `Too few ${label.charAt(0).toLowerCase()}${label.slice(1)} publish these fees for a median.`;
  if (top.gap.direction === "same") {
    return compared.length === 1 ? `Matches the ${stateName} median, within 1%.` : `Matches the ${stateName} median on all ${compared.length} fees.`;
  }
  const fee = top.r.name.replace(/\s*\([^)]*\)/g, "");
  return `${fee} runs ${money(top.gap.amount)} ${top.gap.direction} the ${stateName} median.`;
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

/** Group median, the whole state's and the gap (the fee name joins them wider): one grid for the header and every row. */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem] gap-x-3 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] sm:gap-x-4";

function Row({ row }: { row: PeerSetRow }) {
  return (
    <li className={`${COLUMNS} items-start gap-y-1.5 py-3`}>
      <p className="col-span-3 text-[14px] font-medium text-ink sm:col-span-1 sm:pt-0.5">{row.name}</p>
      <Cell label="Group median" value={row.median} institutions={row.institutions} />
      <Cell label="State median" value={row.stateMedian} institutions={row.stateInstitutions} />
      <div className="min-w-0">
        <span className="sr-only">Difference: </span>
        {row.median !== null && row.stateMedian !== null ? (
          <PeerGapChip value={row.median} median={row.stateMedian} />
        ) : (
          <span className="text-[13px] leading-snug text-ink-muted">Not compared</span>
        )}
      </div>
    </li>
  );
}

function Cell({ label, value, institutions }: { label: string; value: number | null; institutions: number }) {
  return (
    <div className="min-w-0">
      <span className="sr-only">{label}: </span>
      {value !== null ? (
        <p className="font-mono text-[17px] font-semibold leading-tight tabular-nums text-ink">{money(value)}</p>
      ) : (
        <p className="text-[13px] leading-snug text-ink-muted">Too few to compare</p>
      )}
      <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">of {count(institutions)}</p>
    </div>
  );
}

/** The exhibit: the peer-group picker first, then the group's finding and each fee's group median against the whole state's, with the gap as a chip. */
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
    <div className={`${COLUMNS} border-b border-border pb-2 text-[12px] font-medium text-ink-muted`} aria-hidden="true">
      <span className="hidden sm:block">Fee</span>
      <span>Group median</span>
      <span>All {stateName}</span>
      <span>Difference</span>
    </div>
  );
  const shown = view.rows.slice(0, ROWS_SHOWN);
  const rest = view.rows.slice(ROWS_SHOWN);
  return (
    <div className="space-y-5">
      <PeerSetPicker
        label="Peer group"
        current={view.key}
        options={view.options.map((option) => ({
          key: option.key,
          label: CHIPS[option.key]?.label ?? option.label,
          group: CHIPS[option.key]?.group,
          href: hrefFor(option.key),
        }))}
      />
      {/* Keyed by the group, so a new group's figures fade in (landing-motion.css, off under reduced motion). */}
      <figure key={view.key} className="fi-home-fade min-w-0 max-w-4xl">
        <figcaption className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Users aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          <span className="min-w-0">{view.label}</span>
        </figcaption>
        <p className="mt-1 max-w-2xl text-[14px] leading-snug text-ink-soft">{view.finding}</p>
        <div className="mt-4">
          {head}
          <ul className="divide-y divide-border border-b border-border">
            {shown.map((row) => (
              <Row key={row.key} row={row} />
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
                <Row key={row.key} row={row} />
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
