import { Users } from "lucide-react";
import { PeerSetPicker } from "@/components/public/peer-set-picker";
import { homeSerif } from "@/app/landing-serif";
import { SERIF } from "@/app/landing-shared";
import "@/app/landing-motion.css";
import { PRODUCT_NAME } from "@/lib/constants";
import type { InstitutionPeerSets } from "@/lib/data-store/peer-fee-rank";
import { MIN_PEERS_FOR_PEER_SET_MEDIAN } from "@/lib/data-store/peer-fee-rank";
import { displayCity } from "@/lib/format";
import {
  assetsLabel,
  EXPLORER_FEE_KEYS,
  EXPLORER_FEE_LABELS,
  EXPLORER_FEE_SHORT,
  PEER_SET_PURPOSE_GROUP,
  purposeLine,
  whyThesePeers,
  type ExplorerInstitution,
  type PeerExplorerSet,
} from "@/lib/peer-explorer";
import { PeerExplorer } from "./peer-explorer";

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
  isPro,
}: {
  sets: InstitutionPeerSets;
  set: PeerExplorerSet;
  hrefFor: (key: string) => string;
  initial: { peer?: string | null; fee?: string | null; view?: string | null };
  isPro: boolean;
}) {
  const { selected } = sets;
  const options = sets.options.map((option) =>
    option.key === selected.key && option.key === "nearest" ? { ...option, count: set.peers.length } : option,
  );
  const assets = assetsLabel(set.subject.assets);
  const why = whyThesePeers(set);
  const purpose = purposeLine(selected.key, set);
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
        <PeerSetPicker
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
          <span className="min-w-0">{selected.label}</span>
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
        <PeerList set={set} />
        <PeerExplorer set={set} setKey={selected.key} setName={selected.label} initial={initial} isPro={isPro} />
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">Source: {PRODUCT_NAME}, published fee schedules. Total assets from FDIC and NCUA records.</p>
      <details className="mt-1 text-[12px] text-ink-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink">How peers are chosen and counted</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-left">
          <li>Every set keeps the institution&apos;s own charter: banks against banks, credit unions against credit unions.</li>
          <li>Closest in assets takes the institutions nearest its total assets among those that publish fees.</li>
          <li>Home metro counts institutions with a branch in the metro where it has the most branches (FDIC Summary of Deposits, NCUA).</li>
          <li>State and Fed district count institutions headquartered there. Size uses its asset-size band.</li>
          <li>Regulator uses the bank&apos;s primary federal regulator; for a credit union, its federal or state charter.</li>
          <li>A set lists the institutions that publish at least one fee. This institution is not counted in its own set.</li>
          <li>Each institution counts once per fee: the middle of its prices, or for overdraft its highest.</li>
          <li>A peer median needs at least {MIN_PEERS_FOR_PEER_SET_MEDIAN} peers that publish the fee. With fewer, the fee reads &quot;too few to compare&quot;.</li>
          <li>A fee an institution does not publish is shown as not published, never as zero.</li>
          <li>Near the median, in the fee matrix: within 10% of the peer median. Above or below means further than that.</li>
          <li>About the same, where this page compares the institution with its state: within 1%.</li>
        </ul>
      </details>
    </section>
  );
}

/** One institution's row in the set's list: where it is, its assets, and which of the five fees it publishes. */
function PeerListRow({ inst, subject = false }: { inst: ExplorerInstitution; subject?: boolean }) {
  const place = [inst.city ? displayCity(inst.city) : null, inst.state].filter(Boolean).join(", ");
  return (
    <tr className={subject ? "bg-paper font-semibold" : "border-t border-border"}>
      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
        {inst.name}
        {subject && <span className="ml-1 font-normal text-ink-muted">(this institution)</span>}
      </th>
      <td className="px-3 py-2 text-ink-soft">{place || "Not on record"}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{assetsLabel(inst.assets) ?? "Not on record"}</td>
      {EXPLORER_FEE_KEYS.map((key) => {
        const published = inst.fees[key] !== undefined;
        return (
          <td key={key} className={`px-3 py-2 text-center ${published ? "text-ink" : "text-ink-muted"}`}>
            <span aria-hidden="true">{published ? "✓" : "–"}</span>
            <span className="sr-only">{published ? `Publishes ${EXPLORER_FEE_LABELS[key]}` : `${EXPLORER_FEE_LABELS[key]} not published`}</span>
          </td>
        );
      })}
    </tr>
  );
}

/** "See the 25 institutions": exactly who is in the set, so a reader can check the cohort. */
function PeerList({ set }: { set: PeerExplorerSet }) {
  const peers = [...set.peers].sort((a, b) => a.name.localeCompare(b.name));
  if (peers.length === 0) return null;
  return (
    <details className="mt-3 text-[13px]" data-peer-list>
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink">
        See the {peers.length} {peers.length === 1 ? "institution" : "institutions"}
      </summary>
      <div className="relative mt-1 max-h-[28rem] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">The institutions in this peer set, with the fees each publishes</caption>
          <thead className="sticky top-0 bg-surface-0 text-[12px] text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Institution</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">City, state</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Assets</th>
              {EXPLORER_FEE_KEYS.map((key) => (
                <th key={key} scope="col" className="px-3 py-2 text-center font-medium">
                  {EXPLORER_FEE_SHORT[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <PeerListRow inst={set.subject} subject />
            {peers.map((inst) => (
              <PeerListRow key={inst.id} inst={inst} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] text-ink-muted">✓ publishes the fee. – not published.</p>
    </details>
  );
}
