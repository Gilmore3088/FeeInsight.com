import Link from "next/link";
import type { NeedsYouItem } from "@/lib/console/needs-you";
import type { SpendLine } from "@/lib/data-store/console-spend";

const SEVERITY_STRIPE: Record<NeedsYouItem["severity"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-400",
  work: "bg-sky-500",
};

const SEVERITY_LABEL: Record<NeedsYouItem["severity"], string> = {
  critical: "Now",
  warning: "Soon",
  work: "When you can",
};

export function NeedsYouList({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) {
    return (
      <section aria-label="Needs you" className="admin-card flex items-center gap-3 px-4 py-4">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-emerald-500 text-sm font-bold text-white">✓</span>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Nothing needs you right now.</p>
          <p className="text-xs text-gray-500">No failing agents, no waiting leads, no decisions queued.</p>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Needs you" className="space-y-2">
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="admin-card grid grid-cols-[4px_minmax(0,1fr)] items-center gap-x-3 overflow-hidden py-2.5 pr-3 sm:grid-cols-[4px_minmax(0,1fr)_auto]"
          >
            <span aria-hidden="true" className={`self-stretch rounded-r ${SEVERITY_STRIPE[item.severity]}`} />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold leading-snug text-gray-900 dark:text-gray-100">{item.title}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold">{SEVERITY_LABEL[item.severity]}</span> · {item.area} · {item.detail}
              </p>
            </div>
            <Link
              href={item.href}
              prefetch={false}
              className="col-start-2 mt-2 w-fit rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 transition-colors hover:border-gray-300 hover:bg-gray-50 sm:col-start-3 sm:mt-0 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100 dark:hover:bg-white/[0.08]"
            >
              {item.action}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Meter({ used, cap }: { used: number; cap: number | null }) {
  if (!cap) return null;
  const share = Math.min(1, used / cap);
  const tone = share >= 0.9 ? "bg-red-500" : share >= 0.7 ? "bg-amber-400" : "bg-[var(--brand-primary)]";
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="presentation">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(share * 100, used > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export interface Vital {
  label: string;
  /** null when the value could not be read; the tile says so instead of showing a number. */
  value: string | null;
  note: string;
  href: string;
  meter?: { used: number; cap: number | null };
}

export function spendVitals(total: SpendLine | null): Vital[] {
  if (!total) {
    return [
      { label: "Spend today", value: null, note: "Could not read provider usage.", href: "/admin/controls" },
      { label: "Spend this month", value: null, note: "Could not read provider usage.", href: "/admin/controls" },
    ];
  }
  return [
    {
      label: "Spend today",
      value: money(total.todayUsd),
      note: total.dailyCapUsd ? `of ${money(total.dailyCapUsd)} daily cap (UTC day)` : "No daily cap set",
      href: "/admin/controls",
      meter: { used: total.todayUsd, cap: total.dailyCapUsd },
    },
    {
      label: "Spend this month",
      value: money(total.monthUsd),
      note: total.monthlyCapUsd ? `of ${money(total.monthlyCapUsd)} monthly cap` : "No monthly cap set",
      href: "/admin/controls",
      meter: { used: total.monthUsd, cap: total.monthlyCapUsd },
    },
  ];
}

export function VitalsRow({ vitals }: { vitals: Vital[] }) {
  return (
    <section aria-label="Vitals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {vitals.map((vital) => (
        <Link
          key={vital.label}
          href={vital.href}
          prefetch={false}
          className="admin-card block px-4 py-3 transition-colors hover:border-gray-300 dark:hover:border-white/15"
        >
          <p className="text-xs text-gray-500 dark:text-gray-400">{vital.label}</p>
          <p
            className={`mt-1 font-mono text-2xl font-medium tabular-nums ${
              vital.value === null ? "text-gray-400" : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {vital.value ?? "Not read"}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">{vital.note}</p>
          {vital.meter ? <Meter used={vital.meter.used} cap={vital.meter.cap} /> : null}
        </Link>
      ))}
    </section>
  );
}
