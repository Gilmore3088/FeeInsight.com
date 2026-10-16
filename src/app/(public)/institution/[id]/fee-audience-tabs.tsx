"use client";

/**
 * Personal / Business tabs over the fee list (#1062). Both lists are already rendered on the
 * server, so a tab switches at once. Arrow keys, Home and End move between tabs (WAI-ARIA tabs).
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface FeeAudienceTab {
  key: "personal" | "business";
  label: string;
  panel: ReactNode;
}

export function FeeAudienceTabs({ tabs, initial }: { tabs: FeeAudienceTab[]; initial: FeeAudienceTab["key"] }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

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
