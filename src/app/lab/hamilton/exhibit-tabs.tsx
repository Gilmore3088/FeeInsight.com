"use client";

import { useId, useState, type ReactNode } from "react";

/** Lab only: one Hamilton exhibit at a time, picked from a row of short names. */
export function ExhibitTabs({ items }: { items: { id: string; label: string; panel: ReactNode }[] }) {
  const base = useId();
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" aria-label="Hamilton's exhibits" className="flex gap-1.5 overflow-x-auto border-b border-border px-4 pt-3 sm:px-6">
        {items.map((it, i) => (
          <button
            key={it.id}
            id={`${base}-t${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`${base}-p${i}`}
            onClick={() => setActive(i)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 pb-2.5 text-[14px] font-semibold ${
              i === active ? "border-terra text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
      {items.map((it, i) => (
        <div key={it.id} id={`${base}-p${i}`} role="tabpanel" aria-labelledby={`${base}-t${i}`} hidden={i !== active} className="px-4 py-5 sm:px-6">
          {it.panel}
        </div>
      ))}
    </div>
  );
}
