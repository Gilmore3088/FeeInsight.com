import Link from "next/link";
import type { CityMarketInstitution } from "@/lib/data-store";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { lowerLabel, money } from "./format";
import type { LocalFee } from "./market-view";

/**
 * A fee too few local institutions publish for a median: the published amounts themselves, each
 * with its institution and source, and the state and U.S. medians only as references. Pure markup,
 * so the server opening and the client table share it.
 */

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Four published overdraft fees: $30–$36." */
export function evidenceHeadline(fee: LocalFee): string {
  const n = WORDS[fee.n] ?? String(fee.n);
  const what = `${n} published ${lowerLabel(fee.label)} ${fee.n === 1 ? "fee" : "fees"}`;
  if (fee.min == null || fee.max == null) return `${what}.`;
  return fee.max > fee.min ? `${what}: ${money(fee.min)}–${money(fee.max)}.` : `${what}: ${money(fee.min)}.`;
}

/** The median-floor note, said once per page. */
export const NO_LOCAL_MEDIAN = `Local median not shown; ${WORDS[MIN_INSTITUTIONS_FOR_MEDIAN].toLowerCase()} institutions required.`;

export function FeeEvidence({
  fee,
  institutions,
  stateName,
  showNote,
}: {
  fee: LocalFee;
  institutions: CityMarketInstitution[];
  stateName: string;
  showNote: boolean;
}) {
  const rows = institutions
    .filter((i) => i.fees[fee.key])
    .sort((a, b) => a.fees[fee.key]!.amount - b.fees[fee.key]!.amount || a.name.localeCompare(b.name));
  const refs = [
    ...(fee.state_median != null ? [`${stateName} ${money(fee.state_median)}`] : []),
    ...(fee.us_median != null ? [`U.S. ${money(fee.us_median)}`] : []),
  ];
  return (
    <div>
      {rows.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {rows.map((i) => {
            const v = i.fees[fee.key]!;
            return (
              <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5">
                <Link href={`/institution/${i.id}`} className="min-w-0 text-[14px] font-medium leading-tight text-ink hover:text-brick">
                  {i.name}
                </Link>
                {v.source_url ? (
                  <a
                    href={v.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="-my-3 inline-block py-3 font-mono text-[15px] font-semibold tabular-nums text-ink underline decoration-border underline-offset-2 hover:decoration-brick"
                  >
                    {money(v.amount)}
                  </a>
                ) : (
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{money(v.amount)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {refs.length > 0 && <p className="mt-3 text-[13px] text-ink-soft">Medians for reference: {refs.join(" · ")}</p>}
      {showNote && <p className="mt-1 text-[12px] text-ink-muted">{NO_LOCAL_MEDIAN}</p>}
    </div>
  );
}
