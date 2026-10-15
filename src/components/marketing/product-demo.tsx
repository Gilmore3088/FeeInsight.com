"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";

export interface DemoView {
  key: string;
  /** The tab's name, e.g. "District map". */
  label: string;
  /** A shorter name for a phone's tab row, e.g. "Map". */
  short?: string;
  view: ReactNode;
}

/**
 * The homepage product demo: one product window whose tabs are the navigation. Nothing
 * plays or advances on its own; the visitor opens a view with its tab (click, or arrow keys
 * on the tab row), and the view plays a short entrance as it opens (globals.css, skipped
 * under reduced motion). Each view is as tall as its own content, so no view leaves an
 * empty area under it. It adds no landmark of its own: the page section around it names it.
 * Each tab a visitor opens is counted (brief 06 §4.4), so we learn which views people open.
 */
export function ProductDemo({ mark, label, views }: { mark?: ReactNode; label?: string; views: DemoView[] }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (views.length === 0) return null;

  const open = (i: number) => {
    if (i === active) return;
    setActive(i);
    const key = views[i]?.key;
    if (key) trackEvent("demo_view_opened", { view: key });
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = views.length - 1;
    const next =
      event.key === "ArrowRight" ? (i === last ? 0 : i + 1) : event.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    open(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="fi-demo" data-active-view={views[active]?.key}>
      <div className="fi-window fi-window-hero relative min-w-0 overflow-hidden rounded-2xl border border-border bg-surface-0">
        <div className="flex items-center gap-3 border-b border-border bg-paper/70 pl-4 pr-2 sm:pr-4">
          <span aria-hidden className="hidden gap-1.5 sm:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
            <span className="h-2.5 w-2.5 rounded-full bg-border" />
          </span>
          {mark ? <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold text-ink">{mark}</span> : null}
          <div
            role="tablist"
            aria-label={label ?? "Demo views"}
            className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] sm:ml-2"
          >
            {views.map((view, i) => {
              const on = i === active;
              return (
                <button
                  key={view.key}
                  ref={(node) => {
                    tabs.current[i] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${view.key}`}
                  aria-selected={on}
                  aria-label={view.short ? view.label : undefined}
                  aria-controls={`${id}-view-${view.key}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => open(i)}
                  onKeyDown={(event) => onKey(event, i)}
                  data-tab={view.key}
                  className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ink sm:px-3 sm:text-[14px] ${
                    on ? "border-ink font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {view.short ? (
                    <>
                      <span className="sm:hidden">{view.short}</span>
                      <span className="max-sm:hidden">{view.label}</span>
                    </>
                  ) : (
                    view.label
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {views.map((view, i) => (
          <div
            key={view.key}
            role="tabpanel"
            id={`${id}-view-${view.key}`}
            aria-labelledby={`${id}-tab-${view.key}`}
            hidden={i !== active}
            data-view={view.key}
            className="fi-demo-view"
          >
            {view.view}
          </div>
        ))}
      </div>
    </div>
  );
}
