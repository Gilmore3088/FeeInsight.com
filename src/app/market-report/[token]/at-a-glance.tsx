import { positionCounts, type ReportChange, type ReportLine } from "@/lib/custom-report/analysis";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

type PlottedLine = ReportLine & { own: NonNullable<ReportLine["own"]>; peers: NonNullable<ReportLine["peers"]> };

/**
 * One row per comparable line: the local low-to-high range, the middle half as a band, the
 * median as a tick and the institution's own fee as a dot. Each row has its own scale (fees
 * run from $2 to $45), so rows are read for position, not compared for length.
 */
function PositionStrip({ line }: { line: PlottedLine }) {
  const low = Math.min(line.peers.min, line.own.amount);
  const high = Math.max(line.peers.max, line.own.amount);
  const span = high - low || 1;
  const at = (value: number) => `${((value - low) / span) * 100}%`;
  const dot =
    line.position === "above_market" ? "bg-[#C44B2E]" : line.position === "in_market" ? "bg-[#1A1815]" : "bg-[#2F5585]";
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[12rem_1fr_7rem] sm:py-1.5">
      <span className="truncate text-[13px] text-[#1A1815]">{line.label}</span>
      <span
        className="relative order-last col-span-2 mx-1.5 block h-5 sm:order-none sm:col-span-1"
        role="img"
        aria-label={`${line.label}: yours ${money(line.own.amount)}, local median ${money(line.peers.median)}, middle half ${money(line.peers.p25)} to ${money(line.peers.p75)}`}
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#D5CBBF]" />
        <span
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm bg-[#E6DED2]"
          style={{ left: at(line.peers.p25), width: `calc(${at(line.peers.p75)} - ${at(line.peers.p25)})` }}
        />
        <span className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-[#6B6255]" style={{ left: at(line.peers.median) }} />
        <span
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${dot}`}
          style={{ left: at(line.own.amount) }}
        />
      </span>
      <span className="text-right text-[12px] tabular-nums text-[#5A5347]">
        {money(line.own.amount)} <span className="text-[#8A8173]">vs {money(line.peers.median)}</span>
      </span>
    </li>
  );
}

/** The top of the report: where the institution sits on every comparable line, at a glance. */
export function AtAGlance({ lines }: { lines: ReportLine[] }) {
  const counts = positionCounts(lines);
  const plotted = lines.filter((l): l is PlottedLine => l.comparable && !!l.own && !!l.peers);
  const total = counts.above + counts.inside + counts.below;
  const tiles = [
    { label: "Above the local middle half", value: counts.above, tone: "text-[#A93D25]" },
    { label: "Inside it", value: counts.inside, tone: "text-[#3D6B3A]" },
    { label: "Below it, or free", value: counts.below, tone: "text-[#2F5585]" },
  ];
  return (
    <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6" aria-labelledby="glance-heading">
      <h2 id="glance-heading" className="text-xl text-[#1A1815]" style={SERIF}>
        At a glance
      </h2>
      <p className="mt-1 text-[13px] text-[#6B6255]">Your {total} comparable fee lines against local competitors.</p>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-[#EFE8DD] bg-white px-3 py-3">
            <dt className="text-[12px] leading-snug text-[#6B6255]">{tile.label}</dt>
            <dd className={`mt-1 text-2xl tabular-nums ${tile.tone}`} style={SERIF}>
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-5 divide-y divide-[#F3EEE6]">
        {plotted.map((line) => (
          <PositionStrip key={line.key} line={line} />
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-[#8A8173]">
        Each line runs from the lowest to the highest local fee. The shaded band is the middle half of competitors, the
        tick is the median, and the dot is your fee: red above the middle half, blue below it.
      </p>
    </section>
  );
}

function describeChange(change: ReportChange): string {
  const was = change.before === null ? "not published" : money(change.before);
  const now = change.after === null ? "no longer published" : money(change.after);
  if (change.subject === "own") return `Your ${change.label.toLowerCase()} fee: ${was} then, ${now} now.`;
  if (change.subject === "median") return `Local median for ${change.label.toLowerCase()}: ${was} then, ${now} now.`;
  return `${change.who} ${change.label.toLowerCase()}: ${was} then, ${now} now.`;
}

/** For a bought report shown on live data: what moved since the copy saved at payment. */
export function SinceBought({ savedAt, changes }: { savedAt: string; changes: ReportChange[] }) {
  const ordered = [...changes].sort((a, b) => ["own", "median", "competitor"].indexOf(a.subject) - ["own", "median", "competitor"].indexOf(b.subject));
  return (
    <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6" aria-labelledby="since-heading">
      <h2 id="since-heading" className="text-xl text-[#1A1815]" style={SERIF}>
        What changed since you bought this report
      </h2>
      <p className="mt-1 text-[13px] text-[#6B6255]">Today&apos;s figures against the copy saved on {DATE.format(new Date(savedAt))}.</p>
      {ordered.length === 0 ? (
        <p className="mt-3 text-[15px] text-[#1A1815]">Nothing has moved: your fees, the local medians and the named competitors&apos; fees are the same.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-[14px] leading-relaxed text-[#1A1815]">
          {ordered.map((change) => (
            <li key={`${change.subject}:${change.who ?? ""}:${change.key}`} className="flex gap-2">
              <span className="text-[#A93D25]">●</span>
              {describeChange(change)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
