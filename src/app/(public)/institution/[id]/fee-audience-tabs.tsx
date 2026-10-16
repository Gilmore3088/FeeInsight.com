"use client";

/**
 * Personal / Business tabs over the fee list (#1062). Both lists are already rendered on the
 * server, so a tab switches at once. Arrow keys, Home and End move between tabs (WAI-ARIA tabs).
 * A `#fee-<category>` link followed on the page opens the tab that lists that fee and scrolls
 * to its row, so the link never lands on a hidden row (#1592).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** The tab to show for a `#fee-<category>` hash: the active one when it lists the fee, else the first that does. */
export function tabForHash(
  hash: string,
  active: FeeAudienceTab["key"] | undefined,
  lists: (key: FeeAudienceTab["key"], category: string) => boolean,
  keys: FeeAudienceTab["key"][],
): FeeAudienceTab["key"] | null {
  if (!hash.startsWith("#fee-")) return null;
  const category = decodeURIComponent(hash.slice("#fee-".length));
  if (!category) return null;
  if (active && lists(active, category)) return active;
  return keys.find((key) => lists(key, category)) ?? null;
}

export interface FeeAudienceTab {
  key: "personal" | "business";
  label: string;
  panel: ReactNode;
}

export function FeeAudienceTabs({ tabs, initial }: { tabs: FeeAudienceTab[]; initial: FeeAudienceTab["key"] }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = useRef<Partial<Record<FeeAudienceTab["key"], HTMLDivElement | null>>>({});

  useEffect(() => {
    const onHash = () => {
      const lists = (key: FeeAudienceTab["key"], category: string) =>
        Boolean(panels.current[key]?.querySelector(`[data-fee-anchor="${CSS.escape(category)}"]`));
      const target = tabForHash(window.location.hash, active, lists, tabs.map((tab) => tab.key));
      if (!target) return;
      setActive(target);
      const category = decodeURIComponent(window.location.hash.slice("#fee-".length));
      // After the tab shows, scroll to the row that is actually displayed (table or phone list).
      window.requestAnimationFrame(() => {
        const anchors = panels.current[target]?.querySelectorAll<HTMLElement>(`[data-fee-anchor="${CSS.escape(category)}"]`);
        Array.from(anchors ?? []).find((el) => el.offsetParent !== null)?.scrollIntoView({ block: "start" });
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [active, tabs]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(tabs[next].key);
    buttons.current[next]?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label="Fees by account type" className="flex gap-1.5 border-b border-surface-200 px-4 py-2.5">
        {tabs.map((tab, index) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`fee-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`fee-panel-${tab.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={
                "rounded-md border px-3 py-1.5 text-sm font-medium " +
                (on ? "border-warm-900 bg-warm-900 text-warm-ink-50" : "border-warm-300 bg-warm-50 text-warm-700 hover:border-warm-500")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          ref={(el) => {
            panels.current[tab.key] = el;
          }}
          role="tabpanel"
          id={`fee-panel-${tab.key}`}
          aria-labelledby={`fee-tab-${tab.key}`}
          hidden={tab.key !== active}
        >
          {tab.panel}
        </div>
      ))}
    </>
  );
}
