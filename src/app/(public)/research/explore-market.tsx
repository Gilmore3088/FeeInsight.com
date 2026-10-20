"use client";

import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

export type MarketScope = "state" | "district" | "national";

const SCOPES: { key: MarketScope; label: string }[] = [
  { key: "state", label: "State" },
  { key: "district", label: "Fed district" },
  { key: "national", label: "National" },
];

const noopSubscribe = () => () => {};

function scopeFromUrl(): MarketScope | null {
  return window.location.hash === "#districts" || new URLSearchParams(window.location.search).has("fee") ? "district" : null;
}

/**
 * The hub's one geography selector (James, Oct 19: "one Explore your market section"): State ·
 * Fed district · National as tabs over one panel each, so state and district links appear once
 * on the page. Arrow, Home and End keys move between tabs. A link to #districts (where /districts redirects),
 * or one carrying the district map's ?fee=, opens the district tab.
 */
export function ExploreMarket({ state, district, national }: { state: ReactNode; district: ReactNode; national: ReactNode }) {
  const [picked, setScope] = useState<MarketScope | null>(null);
  // The link's request is read in the browser (the page is cached); a tab the reader picks wins.
  const requested = useSyncExternalStore(noopSubscribe, scopeFromUrl, () => null);
  const scope = picked ?? requested ?? "state";
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = SCOPES.length - 1;
    const next =
      e.key === "ArrowRight" ? (i + 1) % SCOPES.length
      : e.key === "ArrowLeft" ? (i + last) % SCOPES.length
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setScope(SCOPES[next].key);
    tabs.current[next]?.focus();
  }

  const panels: Record<MarketScope, ReactNode> = { state, district, national };

  return (
    <div>
      {/* /districts and older links land here; scopeFromUrl opens the district tab. */}
      <span id="districts" aria-hidden="true" />
      <div role="tablist" aria-label="Explore by" className="grid w-full max-w-sm grid-cols-3 gap-1 rounded-full border border-border bg-surface-0 p-1 sm:inline-grid sm:w-auto sm:max-w-none">
        {SCOPES.map((s, i) => (
          <button
            key={s.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${s.key}-tab`}
            aria-selected={scope === s.key}
            aria-controls={`${base}-${s.key}`}
            tabIndex={scope === s.key ? 0 : -1}
            onClick={() => setScope(s.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-1 text-[13px] font-semibold transition-colors sm:px-5 sm:text-[14px] ${
              scope === s.key ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {SCOPES.map((s) => (
        <div
          key={s.key}
          role="tabpanel"
          id={`${base}-${s.key}`}
          aria-labelledby={`${base}-${s.key}-tab`}
          hidden={scope !== s.key}
          className="mt-6"
        >
          {panels[s.key]}
        </div>
      ))}
    </div>
  );
}
