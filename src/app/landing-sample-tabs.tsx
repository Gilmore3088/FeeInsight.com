"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * The live samples, one at a time (James's notes of Oct 16): a row of labelled buttons picks
 * the sample, and only that one shows, at full size. Every panel is in the server markup; the
 * others are hidden until picked. Arrow keys move between the buttons (WAI-ARIA tabs).
 */
export function SampleTabs({ tabs }: { tabs: { key: string; label: string; panel: ReactNode }[] }) {
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
        <div role="tablist" aria-label="Live samples" className="mx-auto flex w-fit max-w-full gap-1 rounded-full border border-border bg-surface-0 p-1">
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
                className={`min-h-11 rounded-full px-4 text-[14px] font-semibold sm:px-5 ${on ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
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

/**
 * Shows only the first entry of a list until the reader asks for the rest. Children mark the
 * entries after the first with `group-data-[collapsed]/more:hidden`.
 */
export function ShowMore({ count, label, children }: { count: number; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group/more" data-collapsed={open ? undefined : ""}>
      {children}
      {count > 1 ? (
        <div className="px-4 pb-4 sm:px-6 sm:pb-5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            {open ? "Show one fee" : label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
