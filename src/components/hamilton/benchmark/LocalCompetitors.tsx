/**
 * The bank's largest local competitors by market deposits, beside it, for the fees most of them
 * publish. Read from their own published schedules; describes, never says what to charge.
 */
import type { BriefingLocalMarket } from "@/lib/hamilton/workspace/types";
import { proseFeeName } from "@/lib/hamilton/workspace/names";

const MAX_COLUMNS = 4;
const MIN_PUBLISHING = 2;

const money = (v: number) => (Number.isInteger(v) ? `$${v.toLocaleString("en-US")}` : `$${v.toFixed(2)}`);

function deposits(v: number): string {
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6).toLocaleString("en-US")}M`;
}

function heading(category: string): string {
  const n = proseFeeName(category);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** The bank's fees most competitors publish, leaving out those peers charge on mixed bases. */
export function competitorColumns(market: BriefingLocalMarket, notCompared: readonly string[] = []): string[] {
  const own = market.rows.find((r) => r.own);
  if (!own) return [];
  const others = market.rows.filter((r) => !r.own);
  return Object.keys(own.values)
    .filter((c) => !notCompared.includes(c))
    .map((c) => ({ c, n: others.filter((r) => r.values[c] != null).length }))
    .filter((x) => x.n >= MIN_PUBLISHING)
    .sort((a, b) => b.n - a.n || a.c.localeCompare(b.c))
    .slice(0, MAX_COLUMNS)
    .map((x) => x.c);
}

export function LocalCompetitors({
  market,
  notCompared = [],
}: {
  market: BriefingLocalMarket;
  notCompared?: readonly string[];
}) {
  const columns = competitorColumns(market, notCompared);
  if (columns.length === 0) return null;
  const showDeposits = market.rows.some((r) => !r.own && r.marketDeposits != null);
  const places = market.info.places.join("; ");
  return (
    <section aria-labelledby="local-competitors" className="flex flex-col gap-3">
      <h2 id="local-competitors" className="text-lg font-semibold text-warm-900">
        Your named competitors
      </h2>
      <p className="text-sm text-warm-700">
        {showDeposits
          ? `The largest institutions in your market (${places}) by local deposits, FDIC Summary of Deposits ${market.info.sodYear}, from their own published schedules.`
          : `Institutions in your market (${places}), from their own published schedules.`}{" "}
        A dash means the fee isn&apos;t on their schedule as we hold it.
      </p>
      <div className="overflow-x-auto rounded-lg border border-warm-300 bg-white">
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="border-b border-warm-200 text-left text-xs font-medium text-warm-600">
              <th scope="col" className="px-4 py-2">Institution</th>
              {showDeposits ? <th scope="col" className="px-4 py-2 text-right">Local deposits</th> : null}
              {columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-2 text-right">
                  {heading(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-100">
            {market.rows.map((r) => (
              <tr key={r.institutionId} className={r.own ? "bg-warm-50 font-semibold text-warm-900" : "text-warm-800"}>
                <th scope="row" className="px-4 py-2 text-left font-[inherit]">
                  {r.name}
                </th>
                {showDeposits ? (
                  <td className="px-4 py-2 text-right text-warm-700">
                    {r.marketDeposits != null ? deposits(r.marketDeposits) : "–"}
                  </td>
                ) : null}
                {columns.map((c) => (
                  <td key={c} className="px-4 py-2 text-right">
                    {r.values[c] != null ? money(r.values[c]) : <span className="text-warm-500">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
