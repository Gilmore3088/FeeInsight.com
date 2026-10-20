import { Users } from "lucide-react";
import { homeSerif } from "@/app/landing-serif";
import { SERIF } from "@/app/landing-shared";
import "@/app/landing-motion.css";
import { PRODUCT_NAME } from "@/lib/constants";
import type { InstitutionPeerSets } from "@/lib/data-store/peer-fee-rank";
import { MIN_PEERS_FOR_PEER_SET_MEDIAN } from "@/lib/data-store/peer-fee-rank";
import {
  assetsLabel,
  formatIsoDate,
  PEER_SET_PURPOSE_GROUP,
  PEER_EXPLORER_MAX_SHOWN,
  purposeLine,
  shownLine,
  whyThesePeers,
  type PeerExplorerSet,
} from "@/lib/peer-explorer";
import { PeerExplorer } from "./peer-explorer";
import { PeerSetLinks } from "./peer-set-links";

/**
 * The peer-set links: `?peers=key#peers`, keeping the `?fee=` focus when the page has one. The
 * cached page never reads the query string; the explorer island (peer-explorer-island.tsx) reads it.
 */
export function peerSetHrefs(institutionId: number, focusFee: string | null): (key: string) => string {
  return (key) => {
    const params = new URLSearchParams({ ...(focusFee ? { fee: focusFee } : {}), peers: key });
    return `/institution/${institutionId}?${params.toString()}#peers`;
  };
}

/** The set's peers, the whole set's when the page shows only its closest. */
export function peerCount(set: PeerExplorerSet): number {
  return set.whole?.peers ?? set.peers.length;
}

/**
 * The selected set's title. A nearest set names the peers it holds, not the number asked for, so
 * the title and its chip agree ("The 24 banks closest in assets", "24 closest in assets"). An
 * asset-band set counts only banks that publish fees; the title says so, so its count is not read
 * as the financial cohort's for the same band.
 */
export function peerSetTitle(selected: { key: string; label: string }, count: number): string {
  if (selected.key === "size") return `${selected.label} that publish fees`;
  if (selected.key === "nearest") return selected.label.replace(/^The \d[\d,]* /, `The ${count} `);
  return selected.label;
}

/** Short names for the choices; the full plain-words name is the set's caption. */
export function peerSetChipLabel(option: { key: string; label: string; count?: number }): string {
  switch (option.key) {
    case "nearest":
      return option.count ? `${option.count} closest in assets` : "Closest in assets";
    case "metro":
      return "Home metro";
    case "state":
      return "State";
    case "district":
      return "Fed district";
    case "size":
      return "Asset size";
    case "regulator":
      return "Regulator";
    default:
      return option.label;
  }
}

/**
 * The institution page's peer explorer (#peers): the institution and its total assets, the peer
 * set picker (?peers=), why these peers belong, then one set drawn three ways (peer-explorer.tsx).
 */
export function PeerExplorerSection({
  sets,
  set,
  hrefFor,
  initial,
}: {
  sets: InstitutionPeerSets;
  set: PeerExplorerSet;
  hrefFor: (key: string) => string;
  initial: { peer?: string | null; fee?: string | null; view?: string | null };
}) {
  const { selected } = sets;
  // One count for the chip and the title: the peers the set actually holds.
  const count = peerCount(set);
  const options = sets.options.map((option) =>
    option.key === selected.key && option.key === "nearest" ? { ...option, count } : option,
  );
  const assets = assetsLabel(set.subject.assets);
  const why = whyThesePeers(set, selected.key);
  const title = peerSetTitle(selected, count);
  const asOf = set.asOf ? formatIsoDate(set.asOf) : null;
  const purpose = purposeLine(selected.key, set);
  const shown = shownLine(set);
  return (
    <section
      id="peers"
      className={`${homeSerif.variable} scroll-mt-20 rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6`}
      aria-labelledby="peer-explorer-heading"
    >
      <h2 id="peer-explorer-heading" className="text-[28px] font-medium leading-[1.08] tracking-[-0.02em] text-ink sm:text-[36px]" style={SERIF}>
        Among its peers
      </h2>
      <p className="mt-1 text-[15px] text-ink-soft sm:text-[17px]">
        {set.subject.name}
        {assets ? ` · ${assets} in assets` : ""}
      </p>
      <div className="mt-4">
        <PeerSetLinks
          label="Peer set"
          current={selected.key}
          options={options.map((option) => ({
            key: option.key,
            label: peerSetChipLabel(option),
            href: hrefFor(option.key),
            group: PEER_SET_PURPOSE_GROUP[option.key],
          }))}
        />
      </div>
      <div key={selected.key} className="fi-home-fade mt-4">
        <p className="flex items-start gap-2 text-[14px] font-semibold text-ink">
          <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
          <span className="min-w-0">{title}</span>
        </p>
        <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-soft">{purpose}</p>
        {why.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Why these peers">
            {why.map((reason) => (
              <li key={reason} className="rounded-full bg-paper px-3 py-1 text-[12px] text-ink-soft">
                {reason}
              </li>
            ))}
          </ul>
        )}
        {shown && <p className="mt-2 text-[13px] font-medium text-ink-soft">{shown}</p>}
        <PeerExplorer set={set} setKey={selected.key} setName={title} initial={initial} />
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">Source: {PRODUCT_NAME}, published fee schedules{asOf ? `, as of ${asOf}` : ""}. Total assets from FDIC and NCUA records.</p>
      <details className="mt-1 text-[12px] text-ink-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink">How peers are chosen and counted</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-left">
          <li>Every set keeps the institution&apos;s own charter: banks against banks, credit unions against credit unions.</li>
          <li>The set shown first is the first in the list with a peer median for each overdraft and monthly maintenance fee this institution publishes. If none has them all, it is the set with the most.</li>
          <li>Closest in assets takes the institutions nearest its total assets among those that publish fees.</li>
          <li>Home metro counts institutions with a branch in the metro where it has the most branches (FDIC Summary of Deposits, NCUA).</li>
          <li>State and Fed district count institutions headquartered there. Size uses its asset-size band.</li>
          <li>Regulator uses the bank&apos;s primary federal regulator; for a credit union, its federal or state charter.</li>
          <li>A set lists the institutions that publish at least one fee. This institution is not counted in its own set.</li>
          <li>Each institution counts once per fee: the middle of its prices, or for overdraft its highest.</li>
          <li>A peer median needs at least {MIN_PEERS_FOR_PEER_SET_MEDIAN} peers that publish the fee. With fewer, the fee reads &quot;too few to compare&quot;.</li>
          <li>A fee an institution does not publish is shown as not published, never as zero.</li>
          <li>About the same: within 1% of the median, in this section and everywhere on this page. Above or below means further than that.</li>
          <li>A set with more than {PEER_EXPLORER_MAX_SHOWN} peers shows the {PEER_EXPLORER_MAX_SHOWN} closest in assets. Its medians and counts still use every peer in the set.</li>
        </ul>
      </details>
    </section>
  );
}
