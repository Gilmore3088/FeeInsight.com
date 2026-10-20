"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { loadPeerExplorerSection } from "./peer-explorer-actions";

/**
 * The peer explorer's query state, read in the browser (#1811). The institution page is cached
 * (ISR) and renders the default peer set for every visitor (`children`). A link with `?peers=`,
 * `?peer=`, `?pfee=` or `?pview=` (a shared address, or a peer-set chip) is read here, and the
 * explorer for it is asked of a server action that reads the same cached data.
 *
 * Only `?peers=` is followed after the first render: the explorer writes `?peer=`, `?pfee=` and
 * `?pview=` into the address itself as the visitor clicks, and must not reload for those.
 */
export function PeerExplorerIsland({
  institutionId,
  defaultSet,
  children,
}: {
  institutionId: number;
  defaultSet: string;
  children: ReactNode;
}) {
  // useSearchParams on a cached page renders the fallback on the server: the default explorer.
  return (
    <Suspense fallback={children}>
      <PeerExplorerFromAddress institutionId={institutionId} defaultSet={defaultSet}>
        {children}
      </PeerExplorerFromAddress>
    </Suspense>
  );
}

const STATE_KEYS = ["peer", "pfee", "pview"] as const;

/**
 * Brings the explorer into view after a link swapped its set, and puts #peers back in the address.
 * A soft navigation to the same cached page can drop the hash and leave the reader at the top
 * (James's Oct 20 review of the "Compare fees with ... local competitors" link), so the scroll is
 * explicit rather than left to the browser.
 */
export function revealPeers(): void {
  const url = new URL(window.location.href);
  if (url.hash !== "#peers") window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}#peers`);
  document.getElementById("peers")?.scrollIntoView({ block: "start" });
}

function PeerExplorerFromAddress({
  institutionId,
  defaultSet,
  children,
}: {
  institutionId: number;
  defaultSet: string;
  children: ReactNode;
}) {
  const search = useSearchParams();
  const peers = search.get("peers");
  const [loaded, setLoaded] = useState<{ peers: string | null; node: ReactNode } | null>(null);
  // The set whose load failed or came back empty: the explorer falls back to the cached default.
  const [failed, setFailed] = useState<{ peers: string | null } | null>(null);

  useEffect(() => {
    // The rest of the state is read once per set, from the address as it stands now.
    const query = new URL(window.location.href).searchParams;
    const state = Object.fromEntries(STATE_KEYS.map((key) => [key, query.get(key)])) as Record<(typeof STATE_KEYS)[number], string | null>;
    const isDefault = (peers === null || peers === defaultSet) && STATE_KEYS.every((key) => !state[key]);
    if (isDefault) return;
    let live = true;
    loadPeerExplorerSection({ institutionId, peers, ...state, fee: query.get("fee") })
      .then((node) => {
        if (!live) return;
        if (node) setLoaded({ peers, node });
        else setFailed({ peers });
      })
      .catch(() => {
        if (live) setFailed({ peers });
      });
    return () => {
      live = false;
    };
  }, [institutionId, defaultSet, peers]);

  // A change of ?peers= after the first render came from a link: once the new set shows, reveal it.
  const lastPeers = useRef(peers);
  const pendingReveal = useRef(false);
  const settled = (loaded !== null && loaded.peers === peers) || peers === null || peers === defaultSet || (failed !== null && failed.peers === peers);
  useEffect(() => {
    if (lastPeers.current !== peers) {
      lastPeers.current = peers;
      pendingReveal.current = true;
    }
    if (settled && pendingReveal.current) {
      pendingReveal.current = false;
      revealPeers();
    }
  }, [peers, settled]);

  if (loaded && loaded.peers === peers) return <>{loaded.node}</>;
  // Back on the default set with nothing else chosen, or the asked-for set could not load: the
  // cached explorer, not left dimmed and busy.
  if (peers === null || peers === defaultSet || (failed && failed.peers === peers)) return <>{children}</>;
  // Another set is loading: keep the current explorer, marked busy.
  return (
    <div aria-busy="true" className="opacity-60 transition-opacity">
      {loaded?.node ?? children}
    </div>
  );
}
