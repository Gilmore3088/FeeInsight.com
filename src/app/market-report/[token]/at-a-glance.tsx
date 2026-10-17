import { positionCounts, type ReportChange, type ReportLine } from "@/lib/custom-report/analysis";
import { EXTRA_ROW, ROWS_SHOWN } from "../rows";
import { ShowAll } from "../show-all";

const SERIF = { fontFamily: "var(--fi-font-sans)" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export type PlottedLine = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

const TONE: Record<"above" | "inside" | "below", { dot: string; text: string }> = {
  above: { dot: "bg-brick", text: "text-brick" },
  inside: { dot: "bg-ink-soft", text: "text-ink" },
  below: { dot: "bg-below-market", text: "text-below-market" },
};

function toneFor(line: ReportLine): keyof typeof TONE {
  if (line.position === "above_market") return "above";
  if (line.position === "in_market") return "inside";
  return "below";
}

/**
 * Where the fee ranks among local competitors, 0 (lowest) to 100 (highest), counting ties
 * as half. Every row shares this one scale, so the rows line up against one median and one
 * middle-half band. A fee the report calls "inside the middle half" (by amount) is kept on
 * the band's edge when ties would nudge its rank just past it.
 */
export function rankOf(line: PlottedLine): number {
  const n = line.peerFigures.length || line.peers.n;
  const less = line.peerFigures.filter((f) => f.amount < line.own.amount).length;
  const equal = line.peerFigures.filter((f) => f.amount === line.own.amount).length;
  const rank = n ? ((less + equal / 2) / n) * 100 : 50;
  if (line.position === "in_market") return Math.min(75, Math.max(25, rank));
  if (line.position === "above_market") return Math.max(rank, 75);
  return Math.min(rank, 25);
}

/** "1st", "2nd", "3rd", "11th", "100th": the rank is a percentile, not a count of competitors. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function gap(line: PlottedLine): string {
  const diff = line.own.amount - line.peers.median;
  if (Math.abs(diff) < 0.005) return "at median";
  return `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`;
}

/**
 * The top of the report: every comparable fee ranked against the same local market on one
 * shared scale, highest-ranked first, with the dollar gap to the local median beside it.
 * The homepage's excerpt (`narrow`) keeps the phone layout at every width, since it sits in a
 * half-width frame, and marks the one fee its example follows (`highlight`, a line key).
 */
export function AtAGlance({
  lines,
  narrow = false,
  highlight,
  limit,
}: {
  lines: ReportLine[];
  narrow?: boolean;
  highlight?: string;
  /** Rows shown (the highlighted one always among them); the rest are counted under the list. */
  limit?: number;
}) {
  const wide = (classes: string) => (narrow ? "" : classes);
  const counts = positionCounts(lines);
  const plotted = lines
    .filter((l): l is PlottedLine => l.comparable && !!l.own && !!l.peers)
    .map((line) => ({ line, rank: rankOf(line), tone: toneFor(line) }))
    .sort((a, b) => b.rank - a.rank);
  const shown = limit && plotted.length > limit
    ? plotted.filter((p, i) => i < limit - 1 || p.line.key === highlight || (i === limit - 1 && !plotted.slice(limit).some((q) => q.line.key === highlight)))
    : plotted;
  const total = counts.above + counts.inside + counts.below;
  const summary = [
    { n: counts.above, text: "above the local middle half", tone: TONE.above },
    { n: counts.inside, text: "inside it", tone: TONE.inside },
    { n: counts.below, text: "below it", tone: TONE.below },
  ];

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface-0 p-6 sm:p-8" aria-labelledby="glance-heading">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">At a glance</p>
      <h2 id="glance-heading" className="font-bold mt-2 text-[1.35rem] leading-snug text-ink sm:text-[1.6rem]" style={SERIF}>
        Of your {total} comparable fees,{" "}
        {summary.map((part, i) => (
          <span key={part.text}>
            <span className={`tabular-nums ${part.tone.text}`}>{part.n}</span> {part.text}
            {i === 0 ? ", " : i === 1 ? " and " : "."}
          </span>
        ))}
      </h2>

      <div className="mt-6" role="table" aria-label="Each comparable fee ranked against local competitors">
        <div
          role="row"
          className={`hidden border-b border-border pb-2 text-[11px] uppercase tracking-[0.08em] text-ink-muted ${wide("sm:grid sm:grid-cols-[13rem_1fr_5.5rem_6rem] sm:gap-x-5")}`}
        >
          <span role="columnheader">Fee</span>
          <span role="columnheader" className="flex justify-between">
            <span>Lower</span>
            <span>Local median</span>
            <span>Higher</span>
          </span>
          <span role="columnheader" className="text-right">Yours</span>
          <span role="columnheader" className="text-right">vs median</span>
        </div>

        {shown.map(({ line, rank, tone }) => (
          <div
            key={line.key}
            role="row"
            data-highlight={line.key === highlight ? "" : undefined}
            className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-[#F1ECE4] py-2.5 last:border-0 ${wide("sm:grid-cols-[13rem_1fr_5.5rem_6rem] sm:gap-x-5 sm:border-0 sm:py-0")} ${
              line.key === highlight ? "-mx-3 rounded-lg bg-ink/[0.04] px-3 ring-1 ring-inset ring-border" : ""
            }`}
          >
            <span role="cell" className={`text-[14px] text-ink ${line.key === highlight ? "font-semibold" : ""}`}>{line.label}</span>
            <span
              role="cell"
              className={`relative order-last col-span-3 mt-2 block h-6 ${wide("sm:order-none sm:col-span-1 sm:mt-0 sm:h-10")}`}
              title={`${line.label}: yours ${money(line.own.amount)}; local median ${money(line.peers.median)}; middle half ${money(line.peers.p25)}–${money(line.peers.p75)} across ${line.peers.n} competitors`}
            >
              <span className="absolute inset-y-0 left-1/4 right-1/4 bg-surface-200" aria-hidden="true" />
              <span className="absolute inset-y-0 left-1/2 w-px bg-ink-muted" aria-hidden="true" />
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
              <span
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${TONE[tone].dot}`}
                style={{ left: `${Math.min(98, Math.max(2, rank))}%` }}
                aria-label={`${ordinal(Math.round(rank))} percentile among local competitors`}
              />
            </span>
            <span role="cell" className="text-right text-[14px] font-semibold tabular-nums text-ink">
              {money(line.own.amount)}
            </span>
            <span role="cell" className={`text-right text-[13px] tabular-nums ${TONE[tone].text}`}>
              {gap(line)}
            </span>
          </div>
        ))}

        <div className={`mt-2 flex justify-between text-[11px] text-ink-muted ${wide("sm:hidden")}`} aria-hidden="true">
          <span>Lower</span>
          <span>Median</span>
          <span>Higher</span>
        </div>
        {shown.length < plotted.length ? (
          <p className="mt-3 text-[13px] text-ink-muted" data-glance-more="">
            {plotted.length - shown.length} more fees in the full report
          </p>
        ) : null}
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-ink-muted">
        Each dot is your fee, ranked against the local competitors that publish the same fee. The shaded band is the
        middle half of those competitors and the line is the median. The last column is your fee less the local median.
      </p>
    </section>
  );
}

function whose(change: ReportChange, name: string): string {
  if (change.subject === "own") return name;
  if (change.subject === "median") return "Local median, all competitors";
  return change.who ?? "Named competitor";
}

/** The line under "Since this report was bought". */
export function sinceBoughtFinding(savedAt: string, changes: ReportChange[]): string {
  const on = DATE.format(new Date(savedAt));
  if (changes.length === 0) return `No figure has moved since the copy saved on ${on}.`;
  return `${changes.length} ${changes.length === 1 ? "figure has" : "figures have"} moved since the copy saved on ${on}.`;
}

/**
 * For a bought report shown on live data: what moved since the copy saved at payment, the
 * institution's own fees first, then the local medians, then named competitors. The page sets
 * the section title, finding and source around it; nothing is drawn when nothing moved.
 */
export function SinceBought({ name, changes }: { name: string; changes: ReportChange[] }) {
  if (changes.length === 0) return null;
  const order = ["own", "median", "competitor"];
  const ordered = [...changes].sort((a, b) => order.indexOf(a.subject) - order.indexOf(b.subject));
  return (
    <figure className="min-w-0 max-w-5xl">
      <figcaption className="text-[14px] font-semibold text-ink">Figures that moved since purchase, then and now</figcaption>
      <ShowAll total={ordered.length} shown={ROWS_SHOWN} noun="changes">
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[20rem] text-left text-[14px]">
        <thead className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            <th className="py-2 pr-3 font-semibold">Whose figure</th>
            <th className="py-2 pr-3 font-semibold">Fee</th>
            <th className="py-2 pr-3 text-right font-semibold">Then</th>
            <th className="py-2 text-right font-semibold">Now</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((change, index) => (
            <tr
              key={`${change.subject}:${change.who ?? ""}:${change.key}`}
              className={`border-b border-border last:border-0 ${index >= ROWS_SHOWN ? EXTRA_ROW : ""}`}
            >
              <td className="py-2.5 pr-3 text-ink">{whose(change, name)}</td>
              <td className="py-2.5 pr-3 text-ink-soft">{change.label}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-ink-muted">
                {change.before === null ? "not published" : money(change.before)}
              </td>
              <td className="py-2.5 text-right font-semibold tabular-nums text-ink">
                {change.after === null ? "no longer published" : money(change.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      </ShowAll>
    </figure>
  );
}
