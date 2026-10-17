import { money } from "./format";
import type { LocalFee } from "./market-view";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";

export interface ComparisonBar {
  /** "Atlanta", "Georgia", "U.S." */
  name: string;
  /** Who the median covers, with its count: "27 institutions with a branch here". */
  sample: string;
  value: number | null;
  /** Why there is no value, when there is none. */
  missing?: string;
}

/**
 * One fee's median for the place, its state and the U.S., as three bars from zero. The place
 * comes first and in brick; the benchmarks are ink. Pure markup, so the server opening and the
 * client fee picker draw the same figure.
 */
export function ComparisonBars({ bars, size = "md" }: { bars: ComparisonBar[]; size?: "md" | "lg" }) {
  const top = Math.max(...bars.map((b) => b.value ?? 0), 0.01);
  const amount = size === "lg" ? "text-[22px] sm:text-[28px]" : "text-[18px] sm:text-[22px]";
  return (
    <ul className="space-y-3">
      {bars.map((b, i) => (
        <li key={b.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className={`text-[14px] ${i === 0 ? "font-semibold text-ink" : "text-ink-soft"}`}>{b.name}</p>
            <p className="text-[12px] text-ink-muted">{b.sample}</p>
          </div>
          <p className={`font-mono tabular-nums ${amount} ${i === 0 ? "font-semibold text-ink" : "text-ink-soft"}`}>
            {b.value != null ? money(b.value) : <span className="font-sans text-[12px] font-normal text-ink-muted">{b.missing ?? "No median"}</span>}
          </p>
          <span className="col-span-2 block h-3 rounded-full bg-paper" aria-hidden="true">
            {b.value != null && (
              <span
                className={`block h-full rounded-full ${i === 0 ? "bg-brick" : "bg-ink/45"}`}
                style={{ width: `${Math.max((b.value / top) * 100, b.value > 0 ? 2 : 0)}%` }}
              />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The three bars for one fee. Each names whose fees its median covers: the place's institutions
 * are those with a branch there, wherever headquartered; the state's are those headquartered in
 * it; the U.S. is every institution in the index.
 */
export function feeBars(fee: LocalFee, placeName: string, stateName: string): ComparisonBar[] {
  return [
    {
      name: placeName,
      sample: count(fee.n, "institution with a branch here", "institutions with a branch here"),
      value: fee.median,
      missing: fee.n === 0 ? "None published" : `Too few for a median (${MIN_INSTITUTIONS_FOR_MEDIAN} needed)`,
    },
    {
      name: stateName,
      sample: fee.state_n != null ? count(fee.state_n, `institution headquartered in ${stateName}`, `institutions headquartered in ${stateName}`) : `Institutions headquartered in ${stateName}`,
      value: fee.state_median,
    },
    {
      name: "U.S.",
      sample: fee.us_n != null ? count(fee.us_n, "institution in the index", "institutions in the index") : "All institutions in the index",
      value: fee.us_median,
    },
  ];
}
