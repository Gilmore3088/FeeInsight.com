"use client";

import { useState, type ReactNode } from "react";

export interface DrilldownPanel {
  key: string;
  label: string;
  /** One line under the tabs saying what this level shows. */
  blurb: string;
  body: ReactNode;
}

/** Tabs over server-rendered map panels: the nation down to one institution's branches. */
export function DrilldownTabs({ panels }: { panels: DrilldownPanel[] }) {
  const [active, setActive] = useState(panels[0]?.key ?? "");
  const current = panels.find((panel) => panel.key === active) ?? panels[0];
  if (!current) return null;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Market level">
        {panels.map((panel) => {
          const selected = panel.key === current.key;
          return (
            <button
              key={panel.key}
              id={`drill-tab-${panel.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`drill-panel-${panel.key}`}
              onClick={() => setActive(panel.key)}
              className={`rounded-md px-3.5 py-2 text-[14px] font-semibold transition-colors duration-150 ${
                selected ? "bg-ink text-on-ink" : "border border-border bg-surface-0 text-ink hover:bg-surface-200"
              }`}
            >
              {panel.label}
            </button>
          );
        })}
      </div>
      <p className="text-[15px] text-ink-soft">{current.blurb}</p>
      {panels.map((panel) => (
        <div
          key={panel.key}
          id={`drill-panel-${panel.key}`}
          role="tabpanel"
          aria-labelledby={`drill-tab-${panel.key}`}
          hidden={panel.key !== current.key}
          className="min-w-0"
        >
          {panel.body}
        </div>
      ))}
    </div>
  );
}
