/**
 * The decisions this institution has open, and the ledger summed over them: what was chosen,
 * where each stands, and the fee income effect where it rests on the bank's own figures.
 * Hamilton never chooses; it records the price management named and what it is watching.
 */
import Link from "next/link";
import type { DecisionRecord, DecisionStatus } from "@/lib/hamilton/workspace/types";
import type { Ledger } from "@/lib/hamilton/workspace/decisions";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { EVIDENCE_LABELS } from "@/components/hamilton/memo/exhibit-view";
import { Figure, fmtMoney, fmtSignedMoney } from "@/components/hamilton/memo/memo";

export const STATUS_LABELS: Record<DecisionStatus, string> = {
  researching: "Researching",
  modeling: "Comparing prices",
  decided: "Decided",
  implementing: "Putting in place",
  monitoring: "Watching",
  closed: "Closed",
};

function effectText(effect: { low: number; high: number } | null): string {
  if (!effect) return "Needs your figures";
  return effect.low === effect.high ? fmtSignedMoney(effect.low) : `${fmtSignedMoney(effect.low)} to ${fmtSignedMoney(effect.high)}`;
}

export function DecisionLedger({
  ledger,
  decisions,
  institutionId,
}: {
  ledger: Ledger;
  decisions: DecisionRecord[];
  institutionId: string | null;
}) {
  const settingsHref = `${hrefWithInstitutionContext("/pro/settings", institutionId)}#your-figures`;
  if (ledger.decisions === 0) {
    return (
      <p className="text-sm text-warm-700">
        No decisions yet. When you ask Hamilton about a fee price, the question is kept here with what was chosen and what
        Hamilton is watching.
      </p>
    );
  }
  const watchesFor = new Map(decisions.map((d) => [d.id, d.watchConditions]));
  const open = ledger.decisions - (ledger.byStatus.closed ?? 0);
  const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-warm-600";
  const td = "px-3 py-2 align-top text-warm-900";
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="Open decisions" value={open} note={`${ledger.decisions} in all`} />
        <Figure label="Price chosen" value={ledger.chosen} note="Named by your team, not by Hamilton" />
        <Figure
          label="Fee income a year"
          value={ledger.dollars.decisions > 0 ? effectText(ledger.dollars) : "Not yet known"}
          note={
            ledger.dollars.decisions > 0 ? (
              `From your own figures, over ${ledger.dollars.decisions} ${ledger.dollars.decisions === 1 ? "decision" : "decisions"}`
            ) : (
              <>
                Counted only from your own figures.{" "}
                <Link href={settingsHref} className="text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra">
                  Add them
                </Link>
              </>
            )
          }
        />
      </div>
      <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-warm-200">
              <th className={th} scope="col">Decision</th>
              <th className={th} scope="col">Where it stands</th>
              <th className={`${th} text-right`} scope="col">Price chosen</th>
              <th className={`${th} text-right`} scope="col">Fee income a year</th>
              <th className={th} scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {ledger.lines.map((line) => {
              const watches = watchesFor.get(line.decisionId) ?? [];
              return (
                <tr key={line.decisionId} className="border-b border-warm-100 last:border-0">
                  <th scope="row" className={`${td} text-left font-normal`}>
                    {line.title}
                    {watches.length > 0 ? (
                      <span className="mt-1 block text-xs text-warm-600">Watching: {watches.map((w) => w.label).join("; ")}</span>
                    ) : null}
                  </th>
                  <td className={td}>{STATUS_LABELS[line.status]}</td>
                  <td className={`${td} text-right [font-variant-numeric:tabular-nums]`}>
                    {line.chosenAmount == null ? "Not chosen" : fmtMoney(line.chosenAmount)}
                  </td>
                  <td className={`${td} text-right [font-variant-numeric:tabular-nums]`}>
                    {line.chosenAmount == null ? "—" : effectText(line.annualEffect)}
                  </td>
                  <td className={`${td} text-warm-700`}>{line.evidenceLevel ? EVIDENCE_LABELS[line.evidenceLevel] : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
