import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
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

type Position = "below" | "within" | "above";

const DOT: Record<Position, string> = { below: "bg-below-market", within: "bg-in-range", above: "bg-above-market" };

/** Where it ranks, 0 (cheapest) to 1 (dearest), counting ties as half. */
function rankShare(line: PeerRankLine): number {
  return line.peers > 0 ? (line.lower + line.same / 2) / line.peers : 0.5;
}

function rankPosition(share: number): Position {
  return share < 0.25 ? "below" : share > 0.75 ? "above" : "within";
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
              <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">{formatFeeAmount(line.own)}</p>
            </div>
            <span className="relative mt-2 block h-4" aria-hidden="true">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-control-border" />
              <span className="absolute left-1/4 top-1/2 h-3 w-1/2 -translate-y-1/2 rounded-[3px] bg-brick-tint" />
              <span
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${DOT[rankPosition(rankShare(line))]}`}
                style={{ left: `${rankShare(line) * 100}%` }}
              />
            </span>
            <p className="mt-1 flex justify-between text-[11px] text-ink-muted" aria-hidden="true">
              <span>Lowest</span>
              <span>Highest</span>
            </p>
            <p className="mt-1 text-[12px] text-ink-soft">
              Of {line.peers} others that publish it, {line.lower} charge less{line.same > 0 ? `, ${line.same} the same` : ""} and{" "}
              {line.higher} charge more.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
