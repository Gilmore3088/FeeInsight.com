import { formatAmount } from "@/lib/format";
import { screenScale, type HamiltonScreen } from "./contact-view";

const DOT = {
  above_market: "bg-brick",
  in_market: "bg-ink",
  below_market: "bg-below-market",
  free: "bg-below-market",
} as const;

const WORDS = { above_market: "above", in_market: "inside", below_market: "below", free: "free, below" } as const;

/** A Hamilton window drawn from the live sample report: what a demo walks through. */
export function ContactScreen({ screen }: { screen: HamiltonScreen }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-surface-0 shadow-fi-2">
      <div className="flex items-center gap-1.5 border-b border-border bg-paper px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-surface-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-200" />
        <span className="ml-3 text-[12px] font-medium text-ink-muted">Hamilton · Fee position</span>
      </div>
      <div className="p-4 sm:p-5">
        <p className="text-[15px] font-semibold text-ink">{screen.institution}</p>
        <p className="text-[12px] text-ink-muted">Against {screen.competitors} local competitors that publish fees</p>
        <ol className="mt-3 divide-y divide-border">
          {screen.lines.map((l) => {
            const x = screenScale(l);
            return (
              <li key={l.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-2 text-[12px]">
                <span className="leading-tight text-ink">
                  {l.label}
                  <span className="sr-only">, {WORDS[l.position]} the local middle half</span>
                </span>
                <span className="relative h-4" aria-hidden="true">
                  <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                  <span
                    className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brick-tint"
                    style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }}
                  />
                  <span className="absolute top-0 h-4 w-[2px] bg-ink/60" style={{ left: `${x(l.median)}%` }} />
                  <span
                    className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${DOT[l.position]}`}
                    style={{ left: `${x(l.own)}%` }}
                  />
                </span>
                <span className="text-right font-mono font-semibold tabular-nums text-ink">{formatAmount(l.own)}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <figcaption className="border-t border-border px-4 py-2.5 text-[11px] text-ink-muted sm:px-5">
        Live, from each bank&apos;s own published fee schedule. The shaded band is the local middle half.
      </figcaption>
    </figure>
  );
}
