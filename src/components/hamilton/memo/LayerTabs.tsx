"use client";

/**
 * Market-layer tabs that switch at once: every layer's exhibit is already on the page, so a
 * tap shows it without a round trip to the server (which felt broken on a slow connection).
 * The address bar follows the tab, so a shared link opens on the same layer.
 */
import { useState, type ReactNode } from "react";

export interface LayerTab {
  key: string;
  label: string;
  meta?: string;
  href: string;
  panel: ReactNode;
}

export function LayerTabs({ tabs, initial, label }: { tabs: LayerTab[]; initial: string; label: string }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : (tabs[0]?.key ?? ""));
  const choose = (tab: LayerTab) => {
    setActive(tab.key);
    try {
      window.history.replaceState(window.history.state, "", tab.href);
    } catch {
      // The address bar is a convenience; the tab still switches.
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`layer-tab-${t.key}`}
              aria-selected={on}
              aria-controls={`layer-panel-${t.key}`}
              onClick={() => choose(t)}
              className={
                "rounded-md border px-3 py-1.5 text-sm " +
                (on ? "border-warm-900 bg-warm-900 text-warm-ink-50" : "border-warm-300 bg-warm-50 text-warm-700 hover:border-warm-500")
              }
            >
              {t.label}
              {t.meta ? <span className={on ? "ml-1.5 text-warm-ink-300" : "ml-1.5 text-warm-600"}>{t.meta}</span> : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`layer-panel-${t.key}`} aria-labelledby={`layer-tab-${t.key}`} hidden={t.key !== active}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
