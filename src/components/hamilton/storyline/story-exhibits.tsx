/**
 * Draws one storyline exhibit under its action title. The engine's existing charts reuse
 * ExhibitView; the storyline's own kinds (segment table, change timeline, structure matrix,
 * money at stake, pricing models) are drawn here.
 */
import { ExhibitFrame, ExhibitView, EVIDENCE_LABELS, SourceChip } from "@/components/hamilton/memo/exhibit-view";
import { SegmentTable } from "@/components/hamilton/memo/segment-table";
import { fmtMoney, fmtSignedMoney } from "@/components/hamilton/memo/memo";
import type { StoryExhibit } from "./types";

function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-warm-600";

export function StoryExhibitView({ item, number }: { item: StoryExhibit; number: number }) {
  const x = item.exhibit;
  const takeaway = item.takeaway ? (
    <p className="mt-3 border-l-2 border-terra pl-3 text-sm font-medium text-warm-900">
      {item.takeaway.text} <SourceChip source={item.takeaway.source} n={item.takeaway.sampleSize} />
    </p>
  ) : null;

  if (x.kind === "fee_position" || x.kind === "competitor_range" || x.kind === "trend") {
    return (
      <div>
        <ExhibitView exhibit={x} number={number} title={item.actionTitle} />
        {takeaway}
      </div>
    );
  }
  if (x.kind === "segment_table") {
    return (
      <div>
        <SegmentTable
          data={{
            segment: { label: "" },
            institutionsInSegment: x.members.length,
            members: x.members,
            band: null,
            zeroCount: x.members.filter((m) => m.amount === 0).length,
            withDailyCap: x.members.filter((m) => m.dailyCap != null).length,
            problem: null,
            source: x.sources[0] ?? { label: "Bank Fee Index" },
          }}
          own={x.own}
          ownLabel={x.ownLabel}
          number={number}
          title={item.actionTitle}
          showCounts={false}
        />
        {takeaway}
      </div>
    );
  }
  if (x.kind === "change_timeline") {
    return (
      <ExhibitFrame title={item.actionTitle} sources={x.sources} note={x.note} number={number}>
        {x.events.length === 0 ? (
          <p className="text-sm text-warm-700">No published changes in this period.</p>
        ) : (
          <ol className="relative ml-2 border-l border-warm-300">
            {x.events.map((e, i) => {
              const up = e.from != null && e.to != null && e.to > e.from;
              return (
                <li key={i} className="relative pb-4 pl-5 last:pb-0">
                  <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${up ? "bg-warm-700" : "bg-terra"}`} aria-hidden />
                  <p className="text-xs text-warm-600 [font-variant-numeric:tabular-nums]">{shortDate(e.date)}</p>
                  <p className="text-sm text-warm-900">
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-warm-300 hover:text-terra-text">
                        {e.institutionName}
                      </a>
                    ) : (
                      e.institutionName
                    )}
                    <span className="ml-2 [font-variant-numeric:tabular-nums] text-warm-700">
                      {fmtMoney(e.from)} → <strong className="font-semibold text-warm-900">{fmtMoney(e.to)}</strong>
                    </span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        {takeaway}
      </ExhibitFrame>
    );
  }
  if (x.kind === "structure_matrix") {
    return (
      <ExhibitFrame title={item.actionTitle} sources={x.sources} note={x.note} number={number}>
        <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-warm-200">
                <th className={th} scope="col">Institution</th>
                {x.columns.map((c) => (
                  <th key={c} className={`${th} text-center`} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {x.rows.map((r) => (
                <tr key={r.name} className={`border-b border-warm-100 last:border-0 ${r.own ? "bg-terra-soft/40" : ""}`}>
                  <th scope="row" className={`px-3 py-2 text-left font-normal ${r.own ? "font-medium text-terra-text" : "text-warm-900"}`}>
                    {r.name}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center text-warm-800 [font-variant-numeric:tabular-nums]">
                      {c ?? <span className="text-warm-400">Not published</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {takeaway}
      </ExhibitFrame>
    );
  }
  if (x.kind === "money_at_stake") {
    const max = Math.max(1, ...x.rows.map((r) => Math.max(Math.abs(r.low), Math.abs(r.high))));
    return (
      <ExhibitFrame title={item.actionTitle} sources={x.sources} note={x.note} number={number}>
        <ul className="flex flex-col gap-3">
          {x.rows.map((r) => {
            const left = 50 + (Math.min(r.low, r.high) / max) * 50;
            const right = 50 + (Math.max(r.low, r.high) / max) * 50;
            return (
              <li key={r.label} className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)_10rem] sm:items-center">
                <span className="text-sm text-warm-900">{r.label}</span>
                <span className="relative h-3 rounded-full bg-warm-100" aria-hidden>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-warm-400" />
                  <span className="absolute inset-y-0 rounded-full bg-terra/70" style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} />
                </span>
                <span className="text-sm text-warm-900 [font-variant-numeric:tabular-nums] sm:text-right">
                  {r.low === r.high ? fmtSignedMoney(r.low) : `${fmtSignedMoney(r.low)} to ${fmtSignedMoney(r.high)}`}
                  <span className="block text-[11px] text-warm-600">{EVIDENCE_LABELS[r.evidenceLevel]}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {takeaway}
      </ExhibitFrame>
    );
  }
  // archetype_map
  const total = x.archetypes.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <ExhibitFrame title={item.actionTitle} sources={x.sources} note={x.note} number={number}>
      <div className="flex h-9 overflow-hidden rounded-md border border-warm-300" aria-hidden>
        {x.archetypes.map((a, i) => (
          <span
            key={a.key}
            className={`flex items-center justify-center text-[11px] font-medium ${a.key === x.ownKey ? "bg-terra text-white" : ["bg-warm-200", "bg-warm-300", "bg-warm-200", "bg-warm-300"][i % 4] + " text-warm-800"}`}
            style={{ width: `${(a.count / total) * 100}%` }}
          >
            {a.count / total > 0.08 ? `${Math.round((a.count / total) * 100)}%` : ""}
          </span>
        ))}
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {x.archetypes.map((a) => (
          <li key={a.key} className={`rounded-md border p-3 text-sm ${a.key === x.ownKey ? "border-terra bg-terra-soft/40" : "border-warm-200 bg-white"}`}>
            <p className="font-medium text-warm-900">
              {a.label}
              <span className="ml-2 text-warm-600 [font-variant-numeric:tabular-nums]">{a.count.toLocaleString("en-US")}</span>
              {a.key === x.ownKey ? <span className="ml-2 text-xs font-semibold uppercase tracking-[0.08em] text-terra-text">You</span> : null}
            </p>
            <p className="mt-0.5 text-xs text-warm-600">{a.rule}</p>
            {a.names.length > 0 ? <p className="mt-1.5 text-xs text-warm-700">{a.names.slice(0, 4).join(", ")}{a.names.length > 4 ? ` and ${a.names.length - 4} more` : ""}</p> : null}
          </li>
        ))}
      </ul>
      {takeaway}
    </ExhibitFrame>
  );
}
