/**
 * The market slice a question named ("$10B and up"), as a ranked table: each institution's
 * assets, its published fee drawn as a bar against the bank's own, its daily cap and a link
 * to the schedule it came from. Data from the engine's segment research; nothing computed
 * here beyond formatting.
 */
import { More, SERIF, fmtMoney } from "./memo";

export interface SegmentRow {
  institutionId: number;
  institutionName: string;
  amount: number;
  stateCode: string | null;
  documentUrls: string[];
  /** Thousands of dollars. */
  totalAssets: number | null;
  dailyCap: number | null;
  /** At most this many of the fee a day, with the schedule line that says so. */
  dailyFeeLimit?: { count: number; line: string } | null;
}

export interface SegmentData {
  segment: { label: string };
  institutionsInSegment: number;
  members: SegmentRow[];
  band: { p25: number; median: number; p75: number; n: number } | null;
  zeroCount: number;
  withDailyCap: number;
  problem: string | null;
  source: { label: string; asOf?: string | null };
}

/** Assets stored in thousands, shown as "$1.2T", "$48.3B" or "$950M". */
export function fmtAssets(thousands: number | null): string {
  if (thousands == null) return "—";
  const dollars = thousands * 1000;
  if (dollars >= 1e12) return `$${(dollars / 1e12).toFixed(1)}T`;
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`;
  return `$${Math.round(dollars / 1e6)}M`;
}

const SHOWN = 15;

/** The schedule's daily limit: a count of fees ("3 a day") or a dollar cap ("$105 a day"). */
export function dailyLimitText(m: Pick<SegmentRow, "dailyCap" | "dailyFeeLimit">): string {
  if (m.dailyFeeLimit) return `${m.dailyFeeLimit.count} a day`;
  if (m.dailyCap != null) return `${fmtMoney(m.dailyCap)} a day`;
  return "—";
}

function Rows({ rows, start, own, max }: { rows: SegmentRow[]; start: number; own: number | null; max: number }) {
  return (
    <tbody>
      {rows.map((m, i) => {
        const width = max > 0 ? Math.max(2, (m.amount / max) * 100) : 0;
        const tone = own == null ? "bg-warm-400" : m.amount < own - 0.005 ? "bg-terra/70" : "bg-warm-400";
        return (
          <tr key={m.institutionId} className="border-b border-warm-100 last:border-0">
            <td className="px-3 py-2 text-right text-xs text-warm-500 [font-variant-numeric:tabular-nums]">{start + i}</td>
            <th scope="row" className="px-3 py-2 text-left font-normal text-warm-900">
              {m.institutionName}
              {m.stateCode ? <span className="ml-1.5 text-xs text-warm-500">{m.stateCode}</span> : null}
            </th>
            <td className="hidden px-3 py-2 text-right sm:table-cell text-warm-700 [font-variant-numeric:tabular-nums]">{fmtAssets(m.totalAssets)}</td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-right text-warm-900 [font-variant-numeric:tabular-nums]">{fmtMoney(m.amount)}</span>
                <span className="hidden h-2 flex-1 rounded-full bg-warm-100 sm:block">
                  <span className={`block h-2 rounded-full ${tone}`} style={{ width: `${width}%` }} />
                </span>
              </div>
            </td>
            <td className="hidden px-3 py-2 text-right sm:table-cell text-warm-700 [font-variant-numeric:tabular-nums]" title={m.dailyFeeLimit?.line}>
              {dailyLimitText(m)}
            </td>
            <td className="hidden px-3 py-2 text-right sm:table-cell">
              {m.documentUrls[0] ? (
                <a href={m.documentUrls[0]} target="_blank" rel="noreferrer" className="text-xs text-terra-text underline">
                  Schedule
                </a>
              ) : null}
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

function Head() {
  const th = "px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] text-warm-600";
  return (
    <thead>
      <tr className="border-b border-warm-200">
        <th className={`${th} w-8 text-right`} scope="col">
          <span className="sr-only">Rank by assets</span>#
        </th>
        <th className={`${th} text-left`} scope="col">Institution</th>
        <th className={`${th} hidden text-right sm:table-cell`} scope="col">Assets</th>
        <th className={`${th} text-left`} scope="col">Fee</th>
        <th className={`${th} hidden text-right sm:table-cell`} scope="col">Daily limit</th>
        <th className={`${th} hidden sm:table-cell`} scope="col">
          <span className="sr-only">Source</span>
        </th>
      </tr>
    </thead>
  );
}

export function SegmentTable({
  data,
  own,
  ownLabel,
  number = 2,
  title: titleOverride,
  showCounts = true,
}: {
  data: SegmentData;
  own: number | null;
  ownLabel: string;
  number?: number;
  /** The exhibit's point, when a storyline gives one. */
  title?: string;
  /** The segment counts strip; off when the caller has only the members. */
  showCounts?: boolean;
}) {
  // When the slice could not be built, the answer's first line already says why.
  if (data.problem || data.members.length === 0) return null;
  const max = Math.max(own ?? 0, ...data.members.map((m) => m.amount));
  const shown = data.members.slice(0, SHOWN);
  const rest = data.members.slice(SHOWN);
  const title = titleOverride ?? `The ${data.members.length === 1 ? "one" : data.members.length.toLocaleString("en-US")} ${data.segment.label} that publish this fee, largest first`;
  return (
    <figure className="rounded-lg border border-warm-300 bg-warm-50 p-5 break-inside-avoid">
      <figcaption className="mb-4">
        <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">Exhibit {number}</span>
        <span className="text-base text-warm-900" style={SERIF}>
          {title}
        </span>
      </figcaption>
      {showCounts ? (
      <dl className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-warm-600">In the segment</dt>
          <dd className="text-lg text-warm-900 [font-variant-numeric:tabular-nums]">{data.institutionsInSegment.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-xs text-warm-600">Publish this fee</dt>
          <dd className="text-lg text-warm-900 [font-variant-numeric:tabular-nums]">{data.members.length.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-xs text-warm-600">Charge $0</dt>
          <dd className="text-lg text-warm-900 [font-variant-numeric:tabular-nums]">{data.zeroCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-warm-600">Publish a daily limit</dt>
          <dd className="text-lg text-warm-900 [font-variant-numeric:tabular-nums]">
            {data.members.filter((m) => m.dailyCap != null || m.dailyFeeLimit != null).length}
          </dd>
        </div>
      </dl>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
        <table className="w-full text-sm sm:min-w-[40rem]">
          <Head />
          {own != null ? (
            <tbody className="border-b-2 border-warm-200 bg-terra-soft/40">
              <tr>
                <td className="px-3 py-2" />
                <th scope="row" className="px-3 py-2 text-left font-medium text-terra-text">
                  {ownLabel}
                </th>
                <td className="hidden px-3 py-2 sm:table-cell" />
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-right font-medium text-terra-text [font-variant-numeric:tabular-nums]">{fmtMoney(own)}</span>
                    <span className="hidden h-2 flex-1 rounded-full bg-warm-100 sm:block">
                      <span className="block h-2 rounded-full bg-terra" style={{ width: `${max > 0 ? Math.max(2, (own / max) * 100) : 0}%` }} />
                    </span>
                  </div>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell" />
                <td className="hidden px-3 py-2 sm:table-cell" />
              </tr>
            </tbody>
          ) : null}
          <Rows rows={shown} start={1} own={own} max={max} />
        </table>
      </div>
      {rest.length > 0 ? (
        <div className="mt-3">
          <More label={`The other ${rest.length.toLocaleString("en-US")}`}>
            <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
              <table className="w-full text-sm sm:min-w-[40rem]">
                <Head />
                <Rows rows={rest} start={SHOWN + 1} own={own} max={max} />
              </table>
            </div>
          </More>
        </div>
      ) : null}
      <p className="mt-3 border-t border-warm-200 pt-2 text-xs text-warm-600">
        {own != null ? `Bars in terra charge less than ${ownLabel}. ` : ""}Assets from the institution registry. Source: {data.source.label}
        {data.source.asOf ? `, ${data.source.asOf.slice(0, 10)}` : ""}.
      </p>
    </figure>
  );
}
