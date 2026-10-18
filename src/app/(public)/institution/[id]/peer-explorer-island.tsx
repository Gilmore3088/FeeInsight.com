"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
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

  useEffect(() => {
    // The rest of the state is read once per set, from the address as it stands now.
    const query = new URL(window.location.href).searchParams;
    const state = Object.fromEntries(STATE_KEYS.map((key) => [key, query.get(key)])) as Record<(typeof STATE_KEYS)[number], string | null>;
    const isDefault = (peers === null || peers === defaultSet) && STATE_KEYS.every((key) => !state[key]);
    if (isDefault) return;
    let live = true;
    loadPeerExplorerSection({ institutionId, peers, ...state, fee: query.get("fee") })
      .then((node) => {
        if (live && node) setLoaded({ peers, node });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [institutionId, defaultSet, peers]);

  if (loaded && loaded.peers === peers) return <>{loaded.node}</>;
  // Back on the default set with nothing else chosen: the cached explorer.
  if (peers === null || peers === defaultSet) return <>{children}</>;
  // Another set is loading: keep the current explorer, marked busy.
  return (
    <div aria-busy="true" className="opacity-60 transition-opacity">
      {loaded?.node ?? children}
    </div>
  );
}
