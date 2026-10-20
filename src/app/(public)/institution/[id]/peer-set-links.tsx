"use client";

import { useEffect, useState } from "react";
import { PeerSetPicker, type PeerSetOption } from "@/components/public/peer-set-picker";
import { carryExplorerState, PEER_EXPLORER_STATE_EVENT } from "@/lib/peer-explorer";

/**
 * The institution page's peer-set picker, its links kept in step with the explorer: after a
 * visitor changes the fee or the view, each set's link carries them, so another set opens on the
 * same fee and view. The server-rendered links work as they are without JavaScript.
 */
export function PeerSetLinks({ label, current, options }: { label: string; current: string; options: PeerSetOption[] }) {
  const [state, setState] = useState<{ fee: string; view: string } | null>(null);
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<{ fee?: unknown; view?: unknown }>).detail;
      if (typeof detail?.fee === "string" && typeof detail?.view === "string") setState({ fee: detail.fee, view: detail.view });
    };
    window.addEventListener(PEER_EXPLORER_STATE_EVENT, listen);
    return () => window.removeEventListener(PEER_EXPLORER_STATE_EVENT, listen);
  }, []);
  const linked = state ? options.map((option) => ({ ...option, href: carryExplorerState(option.href, state) })) : options;
  return <PeerSetPicker label={label} current={current} options={linked} />;
}
