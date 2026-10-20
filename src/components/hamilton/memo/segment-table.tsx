/**
 * The market slice a question named ("$10B and up"), as a ranked table: each institution's
 * assets, its published fee drawn as a bar against the bank's own, its daily cap and a link
 * to the schedule it came from. Data from the engine's segment research; nothing computed
 * here beyond formatting.
 */
import { ANSWER_TYPE, More, fmtMoney } from "./memo";
import { ExhibitFrame } from "./exhibit-view";
import { feeScheduleUrls, ownFeeList, statedFeeLabel, type SeveralFees } from "@/lib/own-fee";
import { formatPeerAssets } from "@/lib/hamilton/peer-list";

export interface SegmentRow {
  institutionId: number;
  institutionName: string;
  amount: number;
  several?: SeveralFees;
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

/** Assets stored in thousands, shown as "$1.2T", "$48.3B" or "$950M"; missing assets say so. */
export function fmtAssets(thousands: number | null): string {
  return formatPeerAssets(thousands == null ? null : thousands * 1000);
}

const SHOWN = 15;

/** The schedule's daily limit: a count of fees ("3 a day") or a dollar cap ("$105 a day"). */
export function dailyLimitText(m: Pick<SegmentRow, "dailyCap" | "dailyFeeLimit">): string {
  if (m.dailyFeeLimit) return `${m.dailyFeeLimit.count} a day`;
  if (m.dailyCap != null) return `${fmtMoney(m.dailyCap)} a day`;
  return "Not published";
}

function Rows({ rows, start, own, max }: { rows: SegmentRow[]; start: number; own: number | null; max: number }) {
  return (
    <tbody>
      {rows.map((m, i) => {
        const width = max > 0 ? Math.max(2, (m.amount / max) * 100) : 0;
        const tone = own == null ? "bg-warm-400" : m.amount < own - 0.005 ? "bg-terra/70" : "bg-warm-400";
        const urls = feeScheduleUrls(m.documentUrls);
        const links = urls.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs text-terra-text underline">Schedule{urls.length > 1 ? ` ${i + 1}` : ""}</a>);
        return (
          <tr key={m.institutionId} className="border-b border-warm-100 last:border-0">
            <td className={`px-3 py-2 text-right text-xs text-warm-500 ${ANSWER_TYPE.num}`}>{start + i}</td>
            <th scope="row" className="px-3 py-2 text-left font-normal text-warm-900">
              {m.institutionName}
              {m.stateCode ? <span className="ml-1.5 text-xs text-warm-500">{m.stateCode}</span> : null}
              {/* On a phone the assets, limit and source columns fold into one line here, so nothing scrolls sideways. */}
              <span className={`mt-0.5 block text-xs text-warm-600 sm:hidden ${ANSWER_TYPE.num}`}>
                Assets {m.totalAssets == null ? "not available" : fmtAssets(m.totalAssets)} · Daily limit {dailyLimitText(m).toLowerCase()}
                {urls.length ? (
                  <>
                    {" · "}
                    {links}
                  </>
                ) : null}
              </span>
            </th>
            <td className={`hidden px-3 py-2 text-right sm:table-cell text-warm-700 ${ANSWER_TYPE.num}`}>{fmtAssets(m.totalAssets)}</td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`shrink-0 text-right text-warm-900 ${m.several ? "text-xs" : "w-14"} ${ANSWER_TYPE.num}`}>{statedFeeLabel(m.amount, m.several, fmtMoney)}</span>
                <span className="relative hidden h-2 flex-1 rounded-full bg-warm-100 sm:block">
                  {m.several ? <span className="absolute block h-2 rounded-full bg-warm-400" style={{ left: `${max > 0 ? m.several.low / max * 100 : 0}%`, width: `${max > 0 ? Math.max(1, (m.several.high - m.several.low) / max * 100) : 0}%` }} />
                    : <span className={`block h-2 rounded-full ${tone}`} style={{ width: `${width}%` }} />}
                </span>
              </div>
              {m.several ? <span className="mt-0.5 block text-xs text-warm-600">{ownFeeList(m.several, fmtMoney)}</span> : null}
            </td>
            <td className={`hidden px-3 py-2 text-right sm:table-cell text-warm-700 ${ANSWER_TYPE.num}`} title={m.dailyFeeLimit?.line}>
              {dailyLimitText(m)}
            </td>
            <td className="hidden px-3 py-2 text-right sm:table-cell">
              <span className="flex flex-col gap-1">{links}</span>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

function Head() {
  // The shared heading cell, without its text-left so each column keeps its own alignment.
  const th = ANSWER_TYPE.th.replace(" text-left", "");
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
  const max = Math.max(own ?? 0, ...data.members.map((m) => m.several?.high ?? m.amount));
  const shown = data.members.slice(0, SHOWN);
  const rest = data.members.slice(SHOWN);
  // The bars only draw from sm up, so their key shows only there; the caption is about the data.
  const caption = "Assets from the institution registry.";
  const title = titleOverride ?? `The ${data.members.length === 1 ? "one" : data.members.length.toLocaleString("en-US")} ${data.segment.label} that publish this fee, largest first`;
  return (
    // The shared exhibit treatment: label, headline, table, then the source line with its "Sep 2026" date.
    <ExhibitFrame title={title} number={number} sources={[{ label: data.source.label, asOf: data.source.asOf ?? null }]} note={caption}>
      {showCounts ? (
      <dl className="mb-4 mt-2 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-warm-600">In the segment</dt>
          <dd className={`text-lg text-warm-900 ${ANSWER_TYPE.num}`}>{data.institutionsInSegment.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-xs text-warm-600">Publish this fee</dt>
          <dd className={`text-lg text-warm-900 ${ANSWER_TYPE.num}`}>{data.members.length.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-xs text-warm-600">{data.members.some(m => m.amount === 0 && m.several) ? "Group values at $0" : "Charge $0"}</dt>
          <dd className={`text-lg text-warm-900 ${ANSWER_TYPE.num}`}>{data.zeroCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-warm-600">Publish a daily limit</dt>
          <dd className={`text-lg text-warm-900 ${ANSWER_TYPE.num}`}>
            {data.members.filter((m) => m.dailyCap != null || m.dailyFeeLimit != null).length}
          </dd>
        </div>
      </dl>
      ) : null}
      {own != null ? (
        <p className="mb-2 hidden items-center gap-2 text-xs text-warm-700 sm:flex">
          <span aria-hidden className="h-2 w-5 rounded-full bg-terra/70" />
          Charges less than {ownLabel}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
        <table className="w-full text-sm">
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
                    <span className={`w-14 shrink-0 text-right font-medium text-terra-text ${ANSWER_TYPE.num}`}>{fmtMoney(own)}</span>
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
              <table className="w-full text-sm">
                <Head />
                <Rows rows={rest} start={SHOWN + 1} own={own} max={max} />
              </table>
            </div>
          </More>
        </div>
      ) : null}
    </ExhibitFrame>
  );
}
