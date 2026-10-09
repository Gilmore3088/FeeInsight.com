import Link from "next/link";
import { REPORT_OFFER } from "@/lib/constants";
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
 * (value funnel A3): counts only, no names, and a path to the full local comparison.
 */
export function PeerRankTeaser({ rank, reportOfferHref }: { rank: InstitutionPeerRank; reportOfferHref: string }) {
  const group = peerGroupLabel(rank);
  return (
    <section className="border border-[#E0D7C9] bg-white" aria-labelledby="peer-rank-heading">
      <div className="border-b border-[#E0D7C9] px-4 py-3 sm:px-5">
        <h2 id="peer-rank-heading" className="text-lg font-semibold text-[#1A1815]">
          Against {group}
        </h2>
        {rank.scope === "district" && (
          <p className="mt-0.5 text-[13px] text-[#6B6255]">Its state has too few comparable institutions, so these are its Fed district peers.</p>
        )}
      </div>
      <ul className="divide-y divide-[#EFE8DD]">
        {rank.lines.map((line) => (
          <li key={line.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-5 sm:px-5">
            <div className="flex items-baseline justify-between gap-3 sm:block">
              <p className="text-[14px] font-medium text-[#1A1815]">{FEE_LABELS[line.key]}</p>
              <p className="text-[14px] font-semibold tabular-nums text-[#1A1815] sm:mt-0.5">{formatAmount(line.own)}</p>
            </div>
            <div>
              <div className="flex h-2 overflow-hidden rounded-full bg-[#EFE8DD]" aria-hidden="true">
                <span className="bg-[#2F5585]" style={{ width: share(line.lower, line.peers) }} />
                <span className="bg-[#8A8173]" style={{ width: share(line.same, line.peers) }} />
                <span className="bg-[#C44B2E]" style={{ width: share(line.higher, line.peers) }} />
              </div>
              <p className="mt-1.5 text-[13px] text-[#5A5347]">
                Of {line.peers} others that publish it, <span className="font-semibold text-[#2F5585]">{line.lower} lower</span>
                {line.same > 0 ? `, ${line.same} the same` : ""} and{" "}
                <span className="font-semibold text-[#A93D25]">{line.higher} higher</span>.
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-[#E0D7C9] px-4 py-3 text-[13px] sm:px-5">
        <Link href={reportOfferHref} className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
          See every headline fee against its local competitors
        </Link>{" "}
        <span className="text-[#5A5347]">in the institution report, {REPORT_OFFER.priceLabel.toLowerCase()}.</span>
      </div>
    </section>
  );
}
