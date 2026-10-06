/**
 * One "Turn this into" deliverable, laid out as a memo the reader can print: each section's
 * paragraphs, sourced lines, table or checklist, then how each decision's figures were built.
 */
import type { Deliverable } from "@/lib/hamilton/workspace/deliverables";
import { EVIDENCE_LABELS, FactList } from "@/components/hamilton/memo/exhibit-view";
import { MemoSection } from "@/components/hamilton/memo/memo";

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function DeliverableView({ deliverable }: { deliverable: Deliverable }) {
  return (
    <div className="flex flex-col gap-10">
      {deliverable.sections.map((section, i) => (
        <MemoSection key={`${section.heading}-${i}`} title={section.heading}>
          <div className="flex flex-col gap-4">
            {section.paragraphs.map((p, j) => (
              <p key={j} className="text-[15px] leading-relaxed text-warm-900">
                {p}
              </p>
            ))}
            {section.facts && section.facts.length > 0 ? <FactList facts={section.facts} /> : null}
            {section.table && section.table.rows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-warm-200">
                      {section.table.columns.map((c) => (
                        <th key={c} scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-warm-600">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row, r) => (
                      <tr key={r} className="border-b border-warm-100 last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-2 align-top text-warm-900 [font-variant-numeric:tabular-nums]">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {section.checklist && section.checklist.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {section.checklist.map((item, k) => (
                  <li key={k} className="flex gap-3 text-[15px] leading-relaxed text-warm-900">
                    <span aria-hidden className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-sm border border-warm-400" />
                    <span>
                      {item.text}
                      {item.rule ? <span className="block text-xs text-warm-600">{item.rule}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </MemoSection>
      ))}

      {deliverable.appendix.length > 0 ? (
        <MemoSection title="How these figures were built" note="Every figure above traces to one of these sources.">
          <div className="flex flex-col gap-5">
            {deliverable.appendix.map(({ decisionTitle, provenance }) => (
              <div key={decisionTitle} className="rounded-lg border border-warm-300 bg-warm-50 p-5 text-sm text-warm-800">
                <p className="font-medium text-warm-900">{decisionTitle}</p>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {provenance.evidenceLevel ? (
                    <div>
                      <dt className="inline text-warm-600">Evidence: </dt>
                      <dd className="inline">{EVIDENCE_LABELS[provenance.evidenceLevel]}</dd>
                    </div>
                  ) : null}
                  {provenance.peerGroup ? (
                    <div>
                      <dt className="inline text-warm-600">Peer group: </dt>
                      <dd className="inline">
                        {provenance.peerGroup.label}, n={provenance.peerGroup.n.toLocaleString("en-US")}
                      </dd>
                    </div>
                  ) : null}
                  {provenance.dataAsOf.fees ? (
                    <div>
                      <dt className="inline text-warm-600">Fees as of: </dt>
                      <dd className="inline">{longDate(provenance.dataAsOf.fees)}</dd>
                    </div>
                  ) : null}
                  {provenance.dataAsOf.financials ? (
                    <div>
                      <dt className="inline text-warm-600">Filings as of: </dt>
                      <dd className="inline">{longDate(provenance.dataAsOf.financials)}</dd>
                    </div>
                  ) : null}
                </dl>
                {provenance.sources.length > 0 ? (
                  <p className="mt-2">
                    <span className="text-warm-600">Sources: </span>
                    {provenance.sources.map((s) => s.label).join("; ")}
                  </p>
                ) : null}
                {provenance.assumptions.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5">
                    {provenance.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </MemoSection>
      ) : null}
    </div>
  );
}
