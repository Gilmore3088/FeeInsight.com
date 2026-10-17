import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { PeerSetPicker } from "@/components/public/peer-set-picker";
import { PRODUCT_NAME } from "@/lib/constants";
import { NEAREST_PEER_COUNT } from "@/lib/data-store/public-peer-sets";
import {
  MIN_PEERS_FOR_PEER_SET_MEDIAN,
  type InstitutionPeerRank,
  type InstitutionPeerSets,
  type PeerRankLine,
  type PeerSetLine,
} from "@/lib/data-store/peer-fee-rank";

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

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

/** Short chip text for each choice; the full plain-words name stays in the caption. */
const CHIPS: Record<string, string> = {
  state: "State",
  district: "Fed district",
  size: "Asset size",
  regulator: "Regulator",
  metro: "Metro",
  nearest: `${NEAREST_PEER_COUNT} closest in assets`,
};

/**
 * "the 41 banks with $300M to $1B in assets that publish it"; a "The 25 banks closest..." set
 * reads "the 24 of the 25 banks closest in assets that publish it".
 */
function peersPublishing(label: string, peers: number): string {
  const group = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  const n = peers.toLocaleString("en-US");
  return `the ${/^the /.test(group) ? `${n} of ${group}` : `${n} ${group}`} that publish it`;
}

/** Above one price, the institution's value is the middle of its prices, never its fee. */
const isMiddle = (line: PeerSetLine) => line.ownPrices > 1;

/**
 * The one line the section leads with: the ranked fee furthest from its peer median, in dollars,
 * naming the group and how many peers its median counts. Within 1% reads as about the same.
 */
export function peerSetFinding(label: string, lines: PeerSetLine[]): string {
  const measured = lines
    .filter((line): line is PeerSetLine & { own: number; median: number } => line.own !== null && line.median !== null)
    .map((line) => ({ line, gap: line.own - line.median, share: line.median > 0 ? Math.abs(line.own - line.median) / line.median : Math.abs(line.own - line.median) }))
    .sort((a, b) => b.share - a.share);
  const top = measured[0];
  if (!top) {
    return lines.some((line) => line.own !== null)
      ? "Too few peers in this group publish its fees for a median."
      : "Its schedule lists no overdraft or monthly maintenance fee to compare.";
  }
  const fee = FEE_LABELS[top.line.key].toLowerCase();
  const median = `the ${money(top.line.median)} median of ${peersPublishing(label, top.line.peers)}`;
  const gap = top.share <= 0.01 ? "about the same as" : `${money(Math.abs(top.gap))} ${top.gap > 0 ? "above" : "below"}`;
  if (isMiddle(top.line)) {
    return `Compared at ${money(top.line.own)}, the middle of its ${fee} prices, it ${top.share <= 0.01 ? "is" : "sits"} ${gap} ${median}.`;
  }
  return `Its ${fee} fee, ${money(top.line.own)}, is ${gap} ${median}.`;
}

/**
 * Overdraft and monthly maintenance against a peer set the visitor picks (?peers=...), each
 * with its peer median and how many peers publish it. Counts only, no peer names.
 */
export function PeerRankTeaser({ sets, hrefFor }: { sets: InstitutionPeerSets; hrefFor: (key: string) => string }) {
  const { selected } = sets;
  return (
    <section id="peers" className="scroll-mt-20 rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5" aria-labelledby="peer-rank-heading">
      <h2 id="peer-rank-heading" className="text-[17px] font-semibold text-ink sm:text-left">
        Overdraft and maintenance against peers
      </h2>
      <p className="mt-1 text-[15px] leading-snug text-ink sm:mx-0 sm:text-left">{peerSetFinding(selected.label, selected.lines)}</p>
      <figure className="mt-4">
        <figcaption className="text-[14px] font-semibold text-ink sm:text-left">{selected.label}</figcaption>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {selected.lines.map((line) => (
            <li key={line.key} className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3">
              <p className="col-span-2 text-[14px] font-medium text-ink">{FEE_LABELS[line.key]}</p>
              <Stat
                label={isMiddle(line) ? "This institution (middle of its prices)" : "This institution"}
                value={line.own !== null ? money(line.own) : "None found"}
                muted={line.own === null}
              />
              <Stat
                label="Peer median"
                value={line.median !== null ? money(line.median) : "Too few to compare"}
                muted={line.median === null}
                note={line.median !== null ? `of ${line.peers.toLocaleString("en-US")} peers` : `${line.peers.toLocaleString("en-US")} ${line.peers === 1 ? "peer publishes" : "peers publish"} it`}
              />
              {line.own !== null && line.median !== null && (
                <p className="col-span-2 text-[12px] text-ink-soft">
                  {line.lower} of {line.peers} publish a lower fee{line.same > 0 ? `, ${line.same} the same` : ""} and {line.higher} a higher one.
                </p>
              )}
            </li>
          ))}
        </ul>
      </figure>
      <div className="mt-4">
        <PeerSetPicker
          label="Peer group"
          current={selected.key}
          surface="surface-0"
          options={sets.options.map((option) => ({ ...option, label: CHIPS[option.key] ?? option.label, href: hrefFor(option.key) }))}
        />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted sm:mx-0 sm:text-left">Source: {PRODUCT_NAME}, published fee schedules.</p>
      <details className="mt-2 text-[12px] text-ink-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink">How peers are chosen and counted</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-left">
          <li>Every group keeps the institution&apos;s own charter: banks against banks, credit unions against credit unions.</li>
          <li>State and Fed district count institutions headquartered there.</li>
          <li>Size uses the institution&apos;s asset-size band, from FDIC and NCUA total assets.</li>
          <li>Regulator uses the bank&apos;s primary federal regulator; for a credit union, its federal or state charter.</li>
          <li>Metro counts institutions with a branch in the metro where it has the most branches (FDIC Summary of Deposits, NCUA).</li>
          <li>Closest in assets takes the institutions nearest its total assets among those that publish fees.</li>
          <li>Each institution counts once: its highest overdraft fee and the middle of its monthly maintenance fees.</li>
          <li>A peer median needs at least {MIN_PEERS_FOR_PEER_SET_MEDIAN} peers that publish the fee.</li>
          <li>This institution is not counted in its own group.</li>
        </ul>
      </details>
    </section>
  );
}

function Stat({ label, value, muted = false, note }: { label: string; value: string; muted?: boolean; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-ink-muted sm:text-left">{label}</p>
      <p className={`mt-0.5 font-mono tabular-nums sm:text-left ${muted ? "text-[13px] text-ink-muted" : "text-[15px] font-semibold text-ink"}`}>{value}</p>
      {note && <p className="mt-0.5 text-[12px] text-ink-muted sm:text-left">{note}</p>}
    </div>
  );
}
