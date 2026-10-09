import { positionCounts, type ReportChange, type ReportLine } from "@/lib/custom-report/analysis";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

type PlottedLine = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

const TONE: Record<"above" | "inside" | "below", { dot: string; text: string }> = {
  above: { dot: "bg-[#C44B2E]", text: "text-[#A93D25]" },
  inside: { dot: "bg-[#5A5347]", text: "text-[#1A1815]" },
  below: { dot: "bg-[#2F5585]", text: "text-[#2F5585]" },
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
function rankOf(line: PlottedLine): number {
  const n = line.peerFigures.length || line.peers.n;
  const less = line.peerFigures.filter((f) => f.amount < line.own.amount).length;
  const equal = line.peerFigures.filter((f) => f.amount === line.own.amount).length;
  const rank = n ? ((less + equal / 2) / n) * 100 : 50;
  if (line.position === "in_market") return Math.min(75, Math.max(25, rank));
  if (line.position === "above_market") return Math.max(rank, 75);
  return Math.min(rank, 25);
}

function gap(line: PlottedLine): string {
  const diff = line.own.amount - line.peers.median;
  if (Math.abs(diff) < 0.005) return "at median";
  return `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`;
}

/**
 * The top of the report: every comparable fee ranked against the same local market on one
 * shared scale, highest-ranked first, with the dollar gap to the local median beside it.
 */
export function AtAGlance({ lines }: { lines: ReportLine[] }) {
  const counts = positionCounts(lines);
  const plotted = lines
    .filter((l): l is PlottedLine => l.comparable && !!l.own && !!l.peers)
    .map((line) => ({ line, rank: rankOf(line), tone: toneFor(line) }))
    .sort((a, b) => b.rank - a.rank);
  const total = counts.above + counts.inside + counts.below;
  const summary = [
    { n: counts.above, text: "above the local middle range", tone: TONE.above },
    { n: counts.inside, text: "inside it", tone: TONE.inside },
    { n: counts.below, text: "below it", tone: TONE.below },
  ];

  return (
    <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 sm:p-8" aria-labelledby="glance-heading">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">At a glance</p>
      <h2 id="glance-heading" className="mt-2 text-[1.35rem] leading-snug text-[#1A1815] sm:text-[1.6rem]" style={SERIF}>
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
          className="hidden border-b border-[#E0D7C9] pb-2 text-[11px] uppercase tracking-[0.08em] text-[#6B6255] sm:grid sm:grid-cols-[13rem_1fr_5.5rem_6rem] sm:gap-x-5"
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

        {plotted.map(({ line, rank, tone }) => (
          <div
            key={line.key}
            role="row"
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-[#F1ECE4] py-2.5 last:border-0 sm:grid-cols-[13rem_1fr_5.5rem_6rem] sm:gap-x-5 sm:border-0 sm:py-0"
          >
            <span role="cell" className="text-[14px] text-[#1A1815]">{line.label}</span>
            <span
              role="cell"
              className="relative order-last col-span-3 mt-2 block h-6 sm:order-none sm:col-span-1 sm:mt-0 sm:h-10"
              title={`${line.label}: yours ${money(line.own.amount)}; local median ${money(line.peers.median)}; middle half ${money(line.peers.p25)}–${money(line.peers.p75)} across ${line.peers.n} competitors`}
            >
              <span className="absolute inset-y-0 left-1/4 right-1/4 bg-[#EFE8DD]" aria-hidden="true" />
              <span className="absolute inset-y-0 left-1/2 w-px bg-[#8A8173]" aria-hidden="true" />
              <span className="absolute inset-x-0 top-1/2 h-px bg-[#E0D7C9]" aria-hidden="true" />
              <span
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#FDFBF8] ${TONE[tone].dot}`}
                style={{ left: `${Math.min(98, Math.max(2, rank))}%` }}
                aria-label={`ranks ${Math.round(rank)} of 100 locally`}
              />
            </span>
            <span role="cell" className="text-right text-[14px] font-semibold tabular-nums text-[#1A1815]">
              {money(line.own.amount)}
            </span>
            <span role="cell" className={`text-right text-[13px] tabular-nums ${TONE[tone].text}`}>
              {gap(line)}
            </span>
          </div>
        ))}

        <div className="mt-2 flex justify-between text-[11px] text-warm-600 sm:hidden" aria-hidden="true">
          <span>Lower</span>
          <span>Median</span>
          <span>Higher</span>
        </div>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-warm-600">
        Each dot is your fee, ranked against the local competitors that publish the same fee. The shaded band is the
        middle half of those competitors and the line is the median. The last column is your fee less the local median.
      </p>
    </section>
  );
}

function whose(change: ReportChange): string {
  if (change.subject === "own") return "You";
  if (change.subject === "median") return "Local median";
  return change.who ?? "Competitor";
}

/** For a bought report shown on live data: what moved since the copy saved at payment. */
export function SinceBought({ savedAt, changes }: { savedAt: string; changes: ReportChange[] }) {
  const order = ["own", "median", "competitor"];
  const ordered = [...changes].sort((a, b) => order.indexOf(a.subject) - order.indexOf(b.subject));
  return (
    <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 sm:p-8" aria-labelledby="since-heading">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">Since you bought this report</p>
      <h2 id="since-heading" className="mt-2 text-[1.35rem] leading-snug text-[#1A1815] sm:text-[1.6rem]" style={SERIF}>
        {ordered.length === 0
          ? "Nothing has moved in your market."
          : `${ordered.length} ${ordered.length === 1 ? "figure has" : "figures have"} moved since ${DATE.format(new Date(savedAt))}.`}
      </h2>
      {ordered.length === 0 ? (
        <p className="mt-2 text-[14px] text-[#5A5347]">
          Your fees, the local medians and the named competitors&apos; fees match the copy saved on{" "}
          {DATE.format(new Date(savedAt))}.
        </p>
      ) : (
        <table className="mt-5 w-full text-left text-[14px]">
          <thead className="border-b border-[#E0D7C9] text-[11px] uppercase tracking-[0.08em] text-[#6B6255]">
            <tr>
              <th className="py-2 pr-3 font-semibold">Who</th>
              <th className="py-2 pr-3 font-semibold">Fee</th>
              <th className="py-2 pr-3 text-right font-semibold">Then</th>
              <th className="py-2 text-right font-semibold">Now</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((change) => (
              <tr key={`${change.subject}:${change.who ?? ""}:${change.key}`} className="border-b border-[#F1ECE4] last:border-0">
                <td className="py-2.5 pr-3 text-[#1A1815]">{whose(change)}</td>
                <td className="py-2.5 pr-3 text-[#5A5347]">{change.label}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-warm-600">
                  {change.before === null ? "not published" : money(change.before)}
                </td>
                <td className="py-2.5 text-right font-semibold tabular-nums text-[#1A1815]">
                  {change.after === null ? "no longer published" : money(change.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
