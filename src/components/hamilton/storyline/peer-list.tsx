/**
 * A list question's answer (#2033): every institution in the group by name, with its published
 * fee, assets, the schedule it came from and when, or why no fee is on file. Rows come from the
 * engine; nothing is computed here beyond formatting.
 */
import type { PeerListExhibit, PeerListRow } from "@/lib/hamilton/workspace/storyline-types";
import { ExhibitFrame } from "@/components/hamilton/memo/exhibit-view";
import { ANSWER_TYPE, More, dayDate, fmtMoney } from "@/components/hamilton/memo/memo";
import { fmtAssets } from "@/components/hamilton/memo/segment-table";

const th = ANSWER_TYPE.th;
/** Rows shown before the rest fold under "Show all". */
const SHOWN = 40;

const MISSING: Record<Exclude<PeerListRow["status"], "published">, string> = {
  not_counted: "On its schedule, not counted",
  not_on_schedule: "Not found on its schedule",
  no_schedule: "No schedule on file",
};

function feeText(r: PeerListRow): string {
  if (r.status !== "published" || r.amount === null) return MISSING[r.status === "published" ? "not_on_schedule" : r.status];
  return r.amountText ?? fmtMoney(r.amount);
}

function Source({ r }: { r: PeerListRow }) {
  if (r.status !== "published") return null;
  const date = r.publishedAt ? dayDate(r.publishedAt) : null;
  return r.documentUrl ? (
    <a href={r.documentUrl} target="_blank" rel="noreferrer" className="text-terra-text underline decoration-terra/40 hover:decoration-terra">
      Schedule{date ? `, ${date}` : ""}
    </a>
  ) : (
    <span className="text-warm-700">{date ?? "On file"}</span>
  );
}

function Rows({ rows }: { rows: PeerListRow[] }) {
  return (
    <>
      {/* On a phone each institution is one card, so nothing scrolls sideways. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((r) => (
          <li key={r.institutionId} className={`rounded-md border px-3 py-2 ${r.own ? "border-terra/40 bg-terra-soft/40" : "border-warm-200 bg-white"}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className={`text-sm font-medium ${r.own ? "text-terra-text" : "text-warm-900"}`}>
                {r.institutionName}
                {r.stateCode ? <span className="ml-1.5 text-xs font-normal text-warm-500">{r.stateCode}</span> : null}
              </p>
              <p className={`shrink-0 text-sm ${ANSWER_TYPE.num} ${r.status === "published" ? "font-semibold text-warm-900" : "text-warm-600"}`}>{feeText(r)}</p>
            </div>
            <p className={`mt-0.5 text-xs text-warm-600 ${ANSWER_TYPE.num}`}>
              {[
                r.own ? null : <span key="a">Assets {r.totalAssets == null ? "not available" : fmtAssets(r.totalAssets)}</span>,
                r.status === "published" ? <Source key="s" r={r} /> : null,
              ]
                .filter(Boolean)
                .flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md border border-warm-200 bg-white sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-200">
              <th className={th} scope="col">Institution</th>
              <th className={`${th} text-right`} scope="col">Assets</th>
              <th className={`${th} text-right`} scope="col">Fee</th>
              <th className={th} scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.institutionId} className={`border-b border-warm-100 last:border-0 ${r.own ? "bg-terra-soft/40" : ""}`}>
                <th scope="row" className={`px-3 py-2 text-left font-normal ${r.own ? "font-medium text-terra-text" : "text-warm-900"}`}>
                  {r.institutionName}
                  {r.stateCode ? <span className="ml-1.5 text-xs text-warm-500">{r.stateCode}</span> : null}
                </th>
                <td className={`px-3 py-2 text-right text-warm-700 ${ANSWER_TYPE.num}`}>{r.own ? "" : fmtAssets(r.totalAssets)}</td>
                <td className={`px-3 py-2 text-right ${ANSWER_TYPE.num} ${r.status === "published" ? "font-semibold text-warm-900" : "text-warm-600"}`}>{feeText(r)}</td>
                <td className="px-3 py-2 text-warm-700">
                  <Source r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PeerList({ exhibit, title, number }: { exhibit: PeerListExhibit; title: string; number: number }) {
  const shown = exhibit.rows.slice(0, SHOWN);
  const rest = exhibit.rows.slice(SHOWN);
  return (
    <ExhibitFrame title={title} sources={exhibit.sources} note={exhibit.note} number={number}>
      <Rows rows={shown} />
      {rest.length > 0 ? (
        <div className="mt-2">
          <More label={`Show all ${exhibit.rows.length.toLocaleString("en-US")}`}>
            <div className="mt-2">
              <Rows rows={rest} />
            </div>
          </More>
        </div>
      ) : null}
      {exhibit.unlisted > 0 ? (
        <p className="mt-2 text-xs text-warm-600">
          {exhibit.unlisted.toLocaleString("en-US")} more {exhibit.unlisted === 1 ? "peer in this group is" : "peers in this group are"} not shown.
        </p>
      ) : null}
    </ExhibitFrame>
  );
}
