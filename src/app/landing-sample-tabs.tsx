"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * One panel at a time (James's notes of Oct 16): a row of labelled buttons picks the panel,
 * and only that one shows, at full size. Every panel is in the server markup; the
 * others are hidden until picked. Arrow keys move between the buttons (WAI-ARIA tabs).
 */
export function SampleTabs({ tabs, label }: { tabs: { key: string; label: string; panel: ReactNode }[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (i + step + tabs.length) % tabs.length;
    setActive(tabs[next].key);
    buttons.current[next]?.focus();
  };
  if (tabs.length === 0) return null;
  return (
    <div>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={label} className="mx-auto flex w-fit max-w-full gap-1 rounded-full border border-border bg-surface-0 p-1">
          {tabs.map((tab, i) => {
            const on = tab.key === active;
            return (
              <button
                key={tab.key}
                ref={(node) => {
                  buttons.current[i] = node;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${tab.key}`}
                aria-selected={on}
                aria-controls={`${id}-panel-${tab.key}`}
                tabIndex={on ? 0 : -1}
                data-sample-tab={tab.key}
                onClick={() => setActive(tab.key)}
                onKeyDown={(event) => onKey(event, i)}
                className={`min-h-11 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold sm:px-5 ${on ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role={tabs.length > 1 ? "tabpanel" : undefined}
          id={`${id}-panel-${tab.key}`}
          aria-labelledby={tabs.length > 1 ? `${id}-tab-${tab.key}` : undefined}
          hidden={tab.key !== active}
          data-sample={tab.key}
          className="mt-8 sm:mt-12"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
