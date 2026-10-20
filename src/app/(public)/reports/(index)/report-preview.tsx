import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { defaultLine, dollarAxis, money, SERIF, type SampleExhibit } from "./report-view";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const PAGE =
  "absolute overflow-hidden rounded-[4px] bg-white text-left ring-1 ring-[#dfe3ea] shadow-[0_24px_48px_-24px_rgba(19,35,56,0.35)]";

/**
 * The report as delivered, drawn from the live sample itself: the cover, the position page for
 * the line the page opens on with the named competitors, and the next page's edge, so the
 * picture and the sample never tell two stories. Hidden when the sample is offline, so no
 * stale picture stands in for it.
 */
export function ReportPreview({ sample, preparedOn }: { sample: SampleExhibit; preparedOn: Date }) {
  const line = defaultLine(sample);
  const above = sample.lines.filter((l) => l.position === "above_market").length;
  const bars = [
    { label: sample.name, value: line.own, own: true },
    { label: "Local median", value: line.median },
    { label: "Lowest", value: line.min },
    { label: "Highest", value: line.max },
  ];
  const axis = dollarAxis(bars.map((b) => b.value));
  const competitors = sample.named.filter((c) => c.fees[line.key] !== undefined).slice(0, 6);
  const table = [...competitors.map((c) => ({ name: c.name, fee: c.fees[line.key], own: false })), { name: sample.name, fee: line.own, own: true }].sort(
    (a, b) => a.fee - b.fee,
  );

  return (
    <div aria-hidden="true" className="relative mx-auto h-[24rem] w-full max-w-[38rem] sm:h-[30rem] lg:h-[31rem]">
      {/* The next page, peeking out behind. */}
      <div className={`${PAGE} right-[-1%] top-[6%] h-[82%] w-[55%] rotate-[4deg]`} />

      {/* The position page: the opening line against the market, then the named competitors. */}
      <div className={`${PAGE} right-[1%] top-[2%] h-[84%] w-[56%] rotate-[1.5deg] py-4 pl-6 pr-4 sm:py-5 sm:pl-8 sm:pr-5`}>
        <p className="text-[9px] font-semibold text-ink sm:text-[10px]">{line.label}</p>
        <p className="text-[8px] text-ink-muted">Local competitive comparison</p>
        <ul className="mt-3 space-y-2">
          {bars.map((b) => (
            <li key={b.label} className="grid grid-cols-[4.4rem_minmax(0,1fr)] items-center gap-2">
              <span className={`truncate text-[8px] ${b.own ? "font-semibold text-ink" : "text-ink-muted"}`}>{b.label}</span>
              <span className="flex items-center gap-1">
                <span
                  className={`block h-2.5 rounded-[2px] ${b.own ? "bg-ink" : "bg-[#9fbbdc]"}`}
                  style={{ width: `${Math.max((b.value / axis.max) * 74, 2)}%` }}
                />
                <span className="font-mono text-[8px] tabular-nums text-ink">{money(b.value)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[8px] leading-snug text-ink-muted">
          Middle half {money(line.p25)} to {money(line.p75)} · {line.peers} competitors
        </p>
        <p className="mt-4 border-t border-[#eef1f5] pt-3 text-[9px] font-semibold text-ink">Named local competitors</p>
        <table className="mt-1.5 w-full text-[8px] text-ink">
          <tbody>
            {table.map((row) => (
              <tr key={row.name} className={row.own ? "bg-[#e8eff8] font-semibold" : "border-b border-[#eef1f5]"}>
                <td className="max-w-0 truncate py-1 pl-1 pr-2">{row.name}</td>
                <td className="py-1 pr-1 text-right font-mono tabular-nums">{money(row.fee)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cover, in front. */}
      <div className={`${PAGE} left-0 top-[12%] w-[52%] -rotate-[1.5deg] p-4 sm:w-[46%] sm:p-5`}>
        <div className="flex items-start justify-between gap-3">
          <p className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em] text-ink">{SITE_NAME}</p>
          <p className="text-right text-[7px] leading-tight text-ink-muted">{MONTH.format(preparedOn)}</p>
        </div>
        <p className="mt-6 text-[19px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[21px]" style={SERIF}>
          {sample.name}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-ink-soft" style={SERIF}>
          {REPORT_OFFER.name}
        </p>
        {sample.place && <p className="mt-1 text-[9px] text-ink-muted">{sample.place}</p>}
        {/* The cover's band: the report's own lines, each fee on its local middle half. */}
        <div className="mt-4 space-y-1.5 rounded-[3px] bg-ink px-3 py-3">
          {sample.lines.slice(0, 5).map((l) => {
            const a = dollarAxis([l.own, l.p75]);
            return (
              <span key={l.key} className="relative block h-1.5">
                <span className="absolute inset-x-0 top-1/2 border-t border-white/15" />
                <span
                  className="absolute top-0 h-1.5 rounded-full bg-[#9fbbdc]/60"
                  style={{ left: `${(l.p25 / a.max) * 100}%`, width: `${Math.max(((l.p75 - l.p25) / a.max) * 100, 1.5)}%` }}
                />
                <span className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${(l.own / a.max) * 100}%` }} />
              </span>
            );
          })}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[#eef1f5] pt-3 text-center">
          {[
            { value: sample.competitorsWithData, label: "Local competitors" },
            { value: sample.lines.length, label: "Fees compared" },
            { value: above, label: "Above the middle half" },
          ].map((s) => (
            <div key={s.label}>
              <dt className="sr-only">{s.label}</dt>
              <dd className="font-mono text-[15px] font-semibold tabular-nums text-ink">{s.value}</dd>
              <dd className="text-[7px] leading-tight text-ink-muted">{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
