import { lineScale, type SampleExhibit } from "./report-view";

const PREPARED = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

const PAGE = "aspect-[17/22] overflow-hidden rounded-[3px] bg-white text-left shadow-[0_18px_48px_-18px_rgba(26,24,21,0.45)] ring-1 ring-border";

const DOT = { above_market: "bg-brick", in_market: "bg-ink", below_market: "bg-[#2f6b4f]", free: "bg-[#2f6b4f]" } as const;

/**
 * The report as delivered, drawn from the live sample itself: the same institution, competitor
 * count, date and fee lines a reader finds in the full sample, so the picture and the sample
 * never tell two stories. Phones show the cover; wider screens fan the summary and position
 * pages behind it. Hidden when the sample is offline, so no stale picture stands in for it.
 */
export function ReportShowcase({ sample, preparedOn }: { sample: SampleExhibit | null; preparedOn: Date }) {
  if (!sample) return null;
  const lines = sample.lines.slice(0, 7);
  return (
    <div aria-hidden="true" className="relative mx-auto mt-10 h-[22rem] w-full max-w-[44rem] sm:mt-12 sm:h-[26rem]">
      <span className="absolute inset-x-[8%] bottom-0 top-[18%] rounded-[2rem] bg-brick-tint/60" />
      {/* Summary page, left. */}
      <div className={`absolute left-[6%] top-[14%] hidden w-[34%] -rotate-[5deg] p-4 sm:block ${PAGE}`}>
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-brick">What stands out</p>
        <ul className="mt-2 space-y-2">
          {sample.findings.map((f) => (
            <li key={f} className="flex gap-1.5 text-[9px] leading-[1.35] text-ink">
              <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-brick" />
              <span className="line-clamp-4">{f}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Position page, right. */}
      <div className={`absolute right-[6%] top-[14%] hidden w-[34%] rotate-[5deg] p-4 sm:block ${PAGE}`}>
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-brick">Against local competitors</p>
        <ul className="mt-2 space-y-2.5">
          {lines.map((l) => {
            const x = lineScale(l);
            return (
              <li key={l.key}>
                <span className="flex justify-between text-[8px] leading-none text-ink">
                  <span className="truncate pr-1">{l.label}</span>
                  <span className="font-mono tabular-nums">{money(l.own)}</span>
                </span>
                <span className="relative mt-1 block h-2">
                  <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                  <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brick-tint" style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }} />
                  <span className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${DOT[l.position]}`} style={{ left: `${x(l.own)}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Cover, in front. */}
      <div className={`absolute left-1/2 top-0 w-[62%] -translate-x-1/2 p-5 sm:w-[40%] ${PAGE}`}>
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-brick">Competitive Fee Position Report</p>
        <p className="mt-3 text-[17px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[18px]">
          {sample.name} against its local market
        </p>
        <p className="mt-2 text-[10px] leading-snug text-ink-muted">
          {sample.place ? `${sample.place} area · ` : ""}verified fees for {sample.competitorsWithData} of {sample.competitorsInMarket} local competitors
        </p>
        <p className="mt-1 text-[10px] text-ink-muted">Prepared {PREPARED.format(preparedOn)}</p>
        <ul className="mt-4 space-y-2">
          {lines.slice(0, 4).map((l) => {
            const x = lineScale(l);
            return (
              <li key={l.key} className="relative block h-2">
                <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brick-tint" style={{ left: `${x(l.p25)}%`, width: `${Math.max(x(l.p75) - x(l.p25), 1)}%` }} />
                <span className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${DOT[l.position]}`} style={{ left: `${x(l.own)}%` }} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
