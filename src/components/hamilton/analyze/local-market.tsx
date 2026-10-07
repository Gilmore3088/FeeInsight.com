/**
 * The local-market answer drawn: who holds the market, where the bank's branches are, and
 * what the institutions around it publish for the main fees beside its own. Descriptive only:
 * higher, lower or the same, never ranked by what to do.
 */
import type { LocalMarketAnswer, MarketCompetitor } from "@/lib/hamilton/local-market-answer";
import { SERIF, fmtMoney } from "@/components/hamilton/memo/memo";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { ExhibitFrame } from "@/components/hamilton/memo/exhibit-view";
import type { SourceRef } from "@/lib/hamilton/workspace/types";

/** "$1.2B", "$850M", "$40K". */
export function fmtDeposits(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

const shortFee = (c: string) => getDisplayName(c).replace(/\s*\([^)]*\)/g, "");

function Tile({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-warm-200 bg-white px-4 py-3">
      <span className={`text-3xl leading-none [font-variant-numeric:tabular-nums] ${accent ? "text-terra" : "text-warm-900"}`} style={SERIF}>
        {value}
      </span>
      <span className="text-[11px] leading-tight text-warm-600">{label}</span>
    </div>
  );
}

/** Who holds the market: each institution's branches there as a bar, the bank's in terra, with deposits beside. */
function MarketHolders({ data }: { data: LocalMarketAnswer }) {
  type Row = MarketCompetitor & { own?: boolean };
  const rows: Row[] = ([
    {
      institutionId: data.institutionId,
      name: data.institutionName,
      charterType: data.charterType,
      branches: data.you.branchesInMarket,
      deposits: data.you.depositsInMarket,
      fees: data.you.fees,
      own: true,
    },
    ...data.competitors,
  ] as Row[]).filter((r) => (r.branches ?? 0) > 0 || r.own);
  const max = Math.max(1, ...rows.map((r) => r.branches ?? 0));
  const total = data.marketDeposits ?? 0;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const share = r.deposits != null && total > 0 ? Math.round((r.deposits / total) * 1000) / 10 : null;
        return (
          <li key={r.institutionId} className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7.5rem] sm:items-center">
            <span className={`min-w-0 truncate text-sm ${r.own ? "font-semibold text-terra-text" : "text-warm-800"}`} title={r.name}>
              {r.name}
              {r.own ? " (you)" : r.charterType === "credit_union" ? <span className="ml-1.5 text-[11px] text-warm-600">CU</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <span className={`h-5 rounded-r-md ${r.own ? "bg-terra" : "bg-warm-400"}`} style={{ width: `${Math.max(((r.branches ?? 0) / max) * 100, 1.5)}%` }} />
              <span className="whitespace-nowrap text-xs font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">
                {r.branches != null ? `${r.branches} ${r.branches === 1 ? "branch" : "branches"}` : "branches not on file"}
              </span>
            </span>
            <span className="text-xs text-warm-700 [font-variant-numeric:tabular-nums] sm:text-right">
              {r.deposits != null ? `${fmtDeposits(r.deposits)}${share != null ? ` · ${share}%` : ""}` : r.charterType === "credit_union" ? "No branch deposits" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Where the bank's branches are: one tile per city, most first. */
function BranchCities({ data }: { data: LocalMarketAnswer }) {
  const cities = data.you.cities.slice(0, 12);
  const max = Math.max(1, ...cities.map((c) => c.branches));
  const rest = data.you.cities.length - cities.length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cities.map((c) => (
          <li key={`${c.city}-${c.state}`} className="flex flex-col gap-1.5 rounded-lg border border-warm-200 bg-warm-100/50 px-3 py-2.5">
            <span className="truncate text-xs text-warm-700" title={`${c.city}, ${c.state}`}>
              {c.city}, {c.state}
            </span>
            <span className="text-2xl leading-none text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
              {c.branches}
            </span>
            <span className="h-1.5 rounded-full bg-warm-200">
              <span className="block h-full rounded-full bg-terra" style={{ width: `${(c.branches / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 ? <p className="text-xs text-warm-600">And {rest} more {rest === 1 ? "city" : "cities"}.</p> : null}
    </div>
  );
}

/** What the market publishes for the main fees, the bank's row first; each cell marked against the bank's own price. */
function FeeGrid({ data }: { data: LocalMarketAnswer }) {
  const cats = data.categories.filter((c) => data.you.fees[c] != null || data.competitors.some((r) => r.fees[c] != null));
  const rows = data.competitors.filter((r) => Object.keys(r.fees).length > 0);
  if (cats.length === 0 || rows.length === 0) return <p className="text-sm text-warm-700">No institution in this market publishes these fees yet.</p>;
  const mark = (theirs: number | undefined, yours: number | undefined) => {
    if (theirs == null || yours == null) return null;
    if (Math.abs(theirs - yours) < 0.005) return { sign: "=", cls: "text-warm-600", label: "same as yours" };
    return theirs > yours ? { sign: "▲", cls: "text-warm-800", label: "higher than yours" } : { sign: "▼", cls: "text-terra-text", label: "lower than yours" };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm [font-variant-numeric:tabular-nums]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-warm-600" scope="col">
              Institution
            </th>
            {cats.map((c) => (
              <th key={c} className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-warm-600" scope="col">
                {shortFee(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="sticky left-0 rounded-l-md bg-terra-soft px-3 py-2.5 text-left font-semibold text-terra-text">
              {data.institutionName} (you)
            </th>
            {cats.map((c, i) => (
              <td key={c} className={`bg-terra-soft px-3 py-2.5 text-right font-semibold text-warm-900 ${i === cats.length - 1 ? "rounded-r-md" : ""}`}>
                {data.you.fees[c] != null ? fmtMoney(data.you.fees[c]) : <span className="font-normal text-warm-500">Not published</span>}
              </td>
            ))}
          </tr>
          {rows.map((r) => (
            <tr key={r.institutionId}>
              <th scope="row" className="sticky left-0 max-w-[14rem] truncate border-b border-warm-100 bg-white px-3 py-2 text-left font-normal text-warm-800" title={r.name}>
                {r.name}
              </th>
              {cats.map((c) => {
                const m = mark(r.fees[c], data.you.fees[c]);
                return (
                  <td key={c} className="border-b border-warm-100 px-3 py-2 text-right text-warm-900">
                    {r.fees[c] != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        {fmtMoney(r.fees[c])}
                        {m ? (
                          <span className={`text-[10px] ${m.cls}`} title={m.label} aria-label={m.label}>
                            {m.sign}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-warm-400">·</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-warm-600">▲ higher than yours · ▼ lower than yours · a dot means no published amount is on file.</p>
    </div>
  );
}

export function LocalMarketView({ data }: { data: LocalMarketAnswer }) {
  const competitorCount = data.competitors.length;
  const ownShare =
    data.you.depositsInMarket != null && data.marketDeposits ? Math.round((data.you.depositsInMarket / data.marketDeposits) * 1000) / 10 : null;
  const basis =
    data.market.basis === "branch_counties"
      ? `the ${data.market.countyCount === 1 ? "county" : `${data.market.countyCount} counties`} where you hold the most deposits`
      : `the ${data.market.countyCount === 1 ? "county" : "counties"} around your headquarters city`;
  // Exhibits share the report frame, so every answer and report carries the same rule, pill and source line.
  const sod: SourceRef = { label: `FDIC Summary of Deposits, June 30, ${data.market.sodYear}`, table: "institution_branch_deposits" };
  const ncua: SourceRef = { label: "NCUA credit union branch file", table: "credit_union_branches" };
  const fees: SourceRef = { label: "Bank Fee Index, published fee schedules", table: "published_fee_catalog" };
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-xl border border-warm-300 bg-warm-100/70 px-5 py-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-terra-text">Your local market</p>
        <h3 className="text-2xl leading-snug text-warm-900" style={SERIF}>
          {competitorCount} {competitorCount === 1 ? "institution competes" : "institutions compete"} with you in the {data.market.label}
        </h3>
        <p className="text-sm text-warm-700">The market is {basis}.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <Tile value={String(data.you.branches)} label="Your branches, everywhere" accent />
          <Tile
            value={data.you.branchesInMarket != null ? String(data.you.branchesInMarket) : "n/a"}
            label={data.marketBranches != null ? `Your branches here, of ${data.marketBranches} bank branches` : "Your branches in this market"}
          />
          <Tile value={ownShare != null ? `${ownShare}%` : "n/a"} label={ownShare != null ? "Your share of local bank deposits" : "Credit unions report no branch deposits"} />
          <Tile value={String(competitorCount)} label="Competitors shown" />
        </div>
      </div>
      <ExhibitFrame number={1} title="Who holds the market: branches here, and deposits for banks" note="Credit union branches are counted by city; NCUA reports no deposits by branch." sources={[sod, ncua]}>
        <MarketHolders data={data} />
      </ExhibitFrame>
      {data.you.cities.length > 0 ? (
        <ExhibitFrame number={2} title={`Where your ${data.you.branches} branches are`} sources={data.charterType === "credit_union" ? [ncua] : [sod]}>
          <BranchCities data={data} />
        </ExhibitFrame>
      ) : null}
      <ExhibitFrame number={data.you.cities.length > 0 ? 3 : 2} title="What they charge for the main fees, beside yours" sources={[fees]}>
        <FeeGrid data={data} />
      </ExhibitFrame>
    </section>
  );
}
