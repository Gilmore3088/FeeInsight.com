"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";

export interface HamiltonStep {
  id: string;
  label: string;
  /** The caption's first sentence, set in ink; `detail` follows in the softer tone. */
  lead: string;
  detail: string;
  panel: ReactNode;
}

/**
 * Three steps above one large product view (James, Oct 17 04:08). Every panel is rendered on
 * the server (the inactive ones hidden), so their content is in the page for crawlers. On a
 * phone the view is cropped to a readable height with a control that opens it in full.
 */
export function HamiltonTabs({ steps }: { steps: HamiltonStep[] }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(i: number) {
    if (i !== active) trackEvent("demo_view_opened", { view: steps[i].id, placement: "home_hamilton" });
    setActive(i);
    setExpanded(false);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const next =
      e.key === "ArrowRight" ? (active + 1) % steps.length
      : e.key === "ArrowLeft" ? (active - 1 + steps.length) % steps.length
      : e.key === "Home" ? 0
      : e.key === "End" ? steps.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }

  const current = steps[active];
  return (
    <div data-hamilton-tabs="">
      <div role="tablist" aria-label="How Hamilton works" onKeyDown={onKey} className="mx-auto grid max-w-4xl grid-cols-3 gap-1.5 rounded-xl border border-border bg-surface-0 p-1.5 sm:gap-2">
        {steps.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`${base}-tab-${s.id}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`${base}-panel-${s.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center sm:flex-row sm:gap-2 text-[13px] font-semibold leading-tight transition-colors sm:text-[15px] ${
              i === active ? "bg-ink text-white" : "text-ink-soft hover:bg-paper hover:text-ink"
            }`}
          >
            <span aria-hidden="true" className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] sm:h-6 sm:w-6 sm:text-[12px] ${i === active ? "bg-white/15" : "bg-paper"}`}>
              {i + 1}
            </span>
            {s.label}
          </button>
        ))}
      </div>
      <p className="mx-auto mt-5 max-w-2xl text-center text-[16px] leading-relaxed text-ink-soft" data-hamilton-caption="">
        <span className="font-semibold text-ink">{current.lead}</span> {current.detail}
      </p>
      {steps.map((s, i) => (
        <div
          key={s.id}
          id={`${base}-panel-${s.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${s.id}`}
          hidden={i !== active}
          tabIndex={0}
          className="mt-6 focus-visible:outline-none"
          data-hamilton-panel={s.id}
        >
          {/* Phones: a readable crop with a fade and a control to open the whole view. */}
          {/* Focus moving into the cropped part opens the whole view, so nothing focused is hidden. */}
          <div id={`${base}-view-${s.id}`} onFocus={() => setExpanded(true)} className={`relative ${expanded ? "" : "max-lg:max-h-[34rem] max-lg:overflow-hidden"}`}>
            {s.panel}
            {expanded ? null : (
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-paper to-transparent lg:hidden" />
            )}
          </div>
          <div className="mt-3 flex justify-center lg:hidden">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`${base}-view-${s.id}`}
              onClick={() => {
                if (!expanded) trackEvent("demo_view_opened", { view: `${s.id}_expanded`, placement: "home_hamilton" });
                else document.getElementById(`${base}-panel-${s.id}`)?.scrollIntoView({ block: "start" });
                setExpanded((v) => !v);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 px-3 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              {expanded ? "Show less" : "Show the full view"}
              <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
