import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { PeerSetPicker } from "@/components/public/peer-set-picker";
import { PeerGapChip, peerGap } from "@/components/public/peer-gap-chip";
import { TrackLink } from "@/components/track-link";
import "@/app/landing-motion.css";
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

/** Above one price, the institution's value is the middle of its prices, never its fee. */
const isMiddle = (line: PeerSetLine) => line.ownPrices > 1;

/**
 * The one short line under the group's name: the fee furthest from its peer median, by share,
 * and the dollar gap ("Monthly maintenance runs $1.55 below the peer median."). The rows below
 * carry the amounts, the middle-of-prices note and the peer counts.
 */
export function peerSetFinding(lines: PeerSetLine[]): string {
  const measured = lines
    .filter((line): line is PeerSetLine & { own: number; median: number } => line.own !== null && line.median !== null)
    .map((line) => ({ line, gap: peerGap(line.own, line.median), share: line.median > 0 ? Math.abs(line.own - line.median) / line.median : Math.abs(line.own - line.median) }))
    .sort((a, b) => b.share - a.share);
  const top = measured[0];
  if (!top) {
    return lines.some((line) => line.own !== null)
      ? "Too few peers in this group publish its fees for a median."
      : "No overdraft or monthly maintenance fee to compare.";
  }
  const fee = FEE_LABELS[top.line.key];
  if (top.gap.direction === "same") return `${fee} matches the peer median, within 1%.`;
  return `${fee} runs ${money(top.gap.amount)} ${top.gap.direction} the peer median.`;
}

/** This institution, the peer median and the gap (the fee name joins them wider): one grid for the header and every row. */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem] gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] sm:gap-x-4";

const CTA_CLASS = "fi-btn fi-btn-brick min-h-12 gap-2 px-6 text-[15px]";

/**
 * Overdraft and monthly maintenance against a peer set the visitor picks (?peers=...): the picker
 * first, then each fee's own amount, its peer median over how many peers publish it, and the gap
 * as a colored chip; then one Hamilton action. Counts only, no peer names.
 */
export function PeerRankTeaser({
  sets,
  hrefFor,
  hamiltonHref,
  isPro = false,
}: {
  sets: InstitutionPeerSets;
  hrefFor: (key: string) => string;
  /** Hamilton's peer list for this institution (the plans first for a visitor without Pro). */
  hamiltonHref?: string;
  isPro?: boolean;
}) {
  const { selected } = sets;
  const cta = (
    <>
      See every peer in Hamilton
      <ArrowRight aria-hidden="true" className="size-4" />
    </>
  );
  return (
    <section id="peers" className="scroll-mt-20 rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6" aria-labelledby="peer-rank-heading">
      <h2 id="peer-rank-heading" className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[22px]">
        Overdraft and maintenance against peers
      </h2>
      <div className="mt-4">
        <PeerSetPicker
          label="Peer group"
          current={selected.key}
          options={sets.options.map((option) => ({ ...option, label: CHIPS[option.key] ?? option.label, href: hrefFor(option.key) }))}
        />
      </div>
      {/* Keyed by the group, so a new group's figures fade in (landing-motion.css, off under reduced motion). */}
      <figure key={selected.key} className="fi-home-fade mt-5 max-w-4xl">
        <figcaption className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Users aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          <span className="min-w-0">{selected.label}</span>
        </figcaption>
        <p className="mt-1 max-w-2xl text-[14px] leading-snug text-ink-soft">{peerSetFinding(selected.lines)}</p>
        <div className={`${COLUMNS} mt-4 border-b border-border pb-2 text-[12px] font-medium text-ink-muted`} aria-hidden="true">
          <span className="hidden sm:block">Fee</span>
          <span>This institution</span>
          <span>Peer median</span>
          <span>Difference</span>
        </div>
        <ul className="divide-y divide-border">
          {selected.lines.map((line) => (
            <li key={line.key} className="py-3">
              <div className={`${COLUMNS} items-start gap-y-1.5`}>
                <p className="col-span-3 text-[14px] font-medium text-ink sm:col-span-1 sm:pt-0.5">{FEE_LABELS[line.key]}</p>
                <Value
                  label="This institution"
                  value={line.own !== null ? money(line.own) : "None found"}
                  muted={line.own === null}
                  note={isMiddle(line) ? `middle of ${line.ownPrices} prices` : undefined}
                />
                <Value
                  label="Peer median"
                  value={line.median !== null ? money(line.median) : "Too few to compare"}
                  muted={line.median === null}
                  note={
                    line.median !== null
                      ? `of ${line.peers.toLocaleString("en-US")} peers`
                      : `${line.peers.toLocaleString("en-US")} ${line.peers === 1 ? "peer publishes" : "peers publish"} it`
                  }
                />
                <div className="min-w-0">
                  <span className="sr-only">Difference: </span>
                  {line.own !== null && line.median !== null ? (
                    <PeerGapChip value={line.own} median={line.median} />
                  ) : (
                    <span className="text-[13px] leading-snug text-ink-muted">Not compared</span>
                  )}
                </div>
              </div>
              {line.own !== null && line.median !== null && line.peers > 0 && <Spread line={line} />}
            </li>
          ))}
        </ul>
      </figure>
      {hamiltonHref && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5">
          {isPro ? (
            <Link href={hamiltonHref} className={CTA_CLASS}>
              {cta}
            </Link>
          ) : (
            <TrackLink event="upgrade_click" eventProps={{ placement: "institution_peers" }} href={hamiltonHref} className={CTA_CLASS}>
              {cta}
            </TrackLink>
          )}
          <p className="text-[13px] text-ink-muted">By name, with your own peer sets.</p>
        </div>
      )}
      <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">Source: {PRODUCT_NAME}, published fee schedules.</p>
      <details className="mt-1 text-[12px] text-ink-muted">
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

function Value({ label, value, muted = false, note }: { label: string; value: string; muted?: boolean; note?: string }) {
  return (
    <div className="min-w-0">
      <span className="sr-only">{label}: </span>
      <p className={`font-mono tabular-nums ${muted ? "text-[13px] leading-snug text-ink-muted" : "text-[17px] font-semibold leading-tight text-ink"}`}>{value}</p>
      {note && <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{note}</p>}
    </div>
  );
}

/** Where the institution sits among the peers that publish the fee: a dot on a track, then the counts. */
function Spread({ line }: { line: PeerSetLine }) {
  const position = Math.min(100, Math.max(0, ((line.lower + line.same / 2) / line.peers) * 100));
  return (
    <div className="mt-3 flex items-center gap-3">
      <span aria-hidden="true" className="relative h-1.5 w-16 shrink-0 rounded-full bg-border sm:w-24">
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-0 bg-ink" style={{ left: `${position}%` }} />
      </span>
      <p className="min-w-0 text-[12px] leading-snug text-ink-muted">
        {line.lower} of {line.peers} publish a lower fee{line.same > 0 ? `, ${line.same} the same` : ""} and {line.higher} a higher one.
      </p>
    </div>
  );
}
