"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { PeerSetPicker, type PeerSetOption } from "@/components/public/peer-set-picker";
import { carryExplorerState, PEER_EXPLORER_STATE_EVENT } from "@/lib/peer-explorer";
import { followPeerSetLink } from "./peer-reveal";

/** The explorer's fee and view once the visitor changes them, so a set link carries both. */
function useExplorerState(): { fee: string; view: string } | null {
  const [state, setState] = useState<{ fee: string; view: string } | null>(null);
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<{ fee?: unknown; view?: unknown }>).detail;
      if (typeof detail?.fee === "string" && typeof detail?.view === "string") setState({ fee: detail.fee, view: detail.view });
    };
    window.addEventListener(PEER_EXPLORER_STATE_EVENT, listen);
    return () => window.removeEventListener(PEER_EXPLORER_STATE_EVENT, listen);
  }, []);
  return state;
}

/**
 * The institution page's peer-set picker, its links kept in step with the explorer: after a
 * visitor changes the fee or the view, each set's link carries them, so another set opens on the
 * same fee and view. The server-rendered links work as they are without JavaScript.
 */
export function PeerSetLinks({ label, current, options }: { label: string; current: string; options: PeerSetOption[] }) {
  const state = useExplorerState();
  const linked = state ? options.map((option) => ({ ...option, href: carryExplorerState(option.href, state) })) : options;
  return <PeerSetPicker label={label} current={current} options={linked} />;
}

/**
 * A filter inside one peer-set chip, such as the home metro's "Banks only": a pressed toggle that
 * switches the explorer to `href` (the filtered set when off, the whole set when on), keeping the
 * fee and view, and ending at #peers like every other set link.
 */
export function PeerSetFilterToggle({ label, pressed, href }: { label: string; pressed: boolean; href: string }) {
  const state = useExplorerState();
  const router = useRouter();
  const target = state ? carryExplorerState(href, state) : href;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={(event) => followPeerSetLink(event, target, (url, options) => router.push(url, options))}
      className={`inline-flex min-h-11 shrink-0 self-start items-center sm:self-center gap-2 rounded-full border px-4 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${
        pressed ? "border-ink bg-ink font-semibold text-on-ink" : "border-border bg-surface-0 text-ink hover:border-ink"
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-4 place-items-center rounded-[4px] border ${pressed ? "border-on-ink bg-on-ink text-ink" : "border-ink-muted bg-transparent"}`}
      >
        {pressed && <Check className="size-3" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}
