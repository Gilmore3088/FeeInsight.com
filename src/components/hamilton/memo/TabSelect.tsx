"use client";

import { useRouter } from "next/navigation";
import type { TabItem } from "./memo";

/** The phone form of a long tab row: one menu, the current choice showing, a pick navigates. */
export function TabSelect({ items, label }: { items: TabItem[]; label: string }) {
  const router = useRouter();
  const current = items.find((t) => t.active);
  return (
    <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.1em] text-warm-600 sm:hidden">
      {label}
      <select
        value={current?.href ?? ""}
        onChange={(e) => router.push(e.target.value)}
        className="min-h-11 rounded-md border border-warm-300 bg-warm-50 px-3 text-base normal-case tracking-normal text-warm-900"
      >
        {current ? null : <option value="">Choose…</option>}
        {items.map((t) => (
          <option key={t.href} value={t.href}>
            {t.meta ? `${t.label} (${t.meta})` : t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
