import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatAmount } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import type { InstitutionPeerRank, PeerRankLine } from "@/lib/data-store/peer-fee-rank";

const FEE_LABELS: Record<PeerRankLine["key"], string> = {
  overdraft: "Overdraft",
  monthly_maintenance: "Monthly maintenance",
};

/** "Texas banks" / "Dallas Fed district credit unions". */
export function peerGroupLabel(rank: Pick<InstitutionPeerRank, "scope" | "state_code" | "fed_district" | "charter_type">): string {
  const kind = rank.charter_type === "credit_union" ? "credit unions" : "banks";
  if (rank.scope === "district" && rank.fed_district !== null) {
    const name = DISTRICT_NAMES[rank.fed_district];
    return name ? `${name} Fed district ${kind}` : `Fed district ${rank.fed_district} ${kind}`;
  }
  const state = rank.state_code ? STATE_NAMES[rank.state_code] ?? rank.state_code : null;
  return state ? `${state} ${kind}` : kind;
}

function share(count: number, total: number): string {
  return `${total > 0 ? (count / total) * 100 : 0}%`;
}

/**
 * Where this institution's overdraft and maintenance fees sit against its report peers
 * (value funnel A3): counts only, no names.
 */
export function PeerRankTeaser({ rank }: { rank: InstitutionPeerRank }) {
  const group = peerGroupLabel(rank);
  return (
    <section className="rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1" aria-labelledby="peer-rank-heading">
      <h2 id="peer-rank-heading" className="text-[15px] font-semibold text-ink">
        Against {group}
      </h2>
      {rank.scope === "district" && (
        <p className="mt-0.5 text-[12px] text-ink-muted">Too few peers in its state, so these are Fed district peers.</p>
      )}
      <ul className="mt-3 space-y-4">
        {rank.lines.map((line) => (
          <li key={line.key}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[14px] text-ink">{FEE_LABELS[line.key]}</p>
              <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">{formatAmount(line.own)}</p>
            </div>
            <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-surface-200" aria-hidden="true">
              <span className="bg-below-market" style={{ width: share(line.lower, line.peers) }} />
              <span className="bg-in-range" style={{ width: share(line.same, line.peers) }} />
              <span className="bg-above-market" style={{ width: share(line.higher, line.peers) }} />
            </div>
            <p className="mt-1.5 text-[12px] text-ink-soft">
              Of {line.peers} others that publish it, <span className="font-semibold text-below-market">{line.lower} lower</span>
              {line.same > 0 ? `, ${line.same} the same` : ""} and{" "}
              <span className="font-semibold text-above-market">{line.higher} higher</span>.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
