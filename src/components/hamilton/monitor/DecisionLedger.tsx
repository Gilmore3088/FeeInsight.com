/**
 * The decisions this institution has open, and where each stands, with the deliverables a
 * reader can build from them. Hamilton never chooses an option.
 */
import type { DecisionStatus } from "@/lib/hamilton/workspace/types";
import type { Ledger } from "@/lib/hamilton/workspace/decisions";
import { DELIVERABLE_TITLES } from "@/lib/hamilton/workspace/deliverables";
import { Figure } from "@/components/hamilton/memo/memo";

export const STATUS_LABELS: Record<DecisionStatus, string> = {
  researching: "Researching",
  modeling: "Comparing prices",
  decided: "Decided",
  implementing: "Putting in place",
  monitoring: "Watching",
  closed: "Closed",
};

export function DecisionLedger({ ledger, institutionId }: { ledger: Ledger; institutionId: string | null }) {
  if (ledger.decisions === 0) {
    return (
      <p className="text-sm text-warm-700">
        No decisions yet. When you ask Hamilton about a fee price, the question is kept here.
      </p>
    );
  }
  // A deliverable is written about a fee, so only decisions on a fee can go into one.
  const canTurn = (line: Ledger["lines"][number]) => Boolean(line.feeCategory);
  const turnable = ledger.lines.filter(canTurn).length;
  const open = ledger.decisions - (ledger.byStatus.closed ?? 0);
  const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-warm-600";
  const td = "px-3 py-2 align-top text-warm-900";
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="Open decisions" value={open} note={`${ledger.decisions} in all`} />
      </div>
      <form action="/pro/monitor/deliverable" method="get" className="flex flex-col gap-4">
        {institutionId ? <input type="hidden" name="instId" value={institutionId} /> : null}
        <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-warm-200">
                <th className={`${th} w-10`} scope="col">
                  <span className="sr-only">Include</span>
                </th>
                <th className={th} scope="col">Decision</th>
                <th className={th} scope="col">Where it stands</th>
              </tr>
            </thead>
            <tbody>
              {ledger.lines.map((line) => (
                  <tr key={line.decisionId} className="border-b border-warm-100 last:border-0">
                    <td className={td}>
                      {canTurn(line) ? (
                        <input
                          type="checkbox"
                          name="ids"
                          value={line.decisionId}
                          defaultChecked
                          aria-label={`Include ${line.title}`}
                          className="h-4 w-4 accent-[var(--color-terra)]"
                        />
                      ) : null}
                    </td>
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {line.title}
                    </th>
                    <td className={td}>{STATUS_LABELS[line.status]}</td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
        {turnable > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="deliverable-kind" className="text-sm font-medium text-warm-900">
              Turn the ticked decisions into
            </label>
            <select
              id="deliverable-kind"
              name="kind"
              defaultValue="ceo_onepager"
              className="rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra"
            >
              {Object.entries(DELIVERABLE_TITLES).map(([key, title]) => (
                <option key={key} value={key}>
                  {title}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark">
              Build it
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
