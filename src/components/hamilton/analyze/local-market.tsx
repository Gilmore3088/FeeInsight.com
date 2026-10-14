/**
 * The local-market answer in the shared report look (src/lib/report-design): headline figures,
 * the footprint map, who holds the market as a ranked table, where the bank's branches are, and
 * what the institutions around it publish for the main fees beside its own. Descriptive only:
 * higher, lower or the same, never ranked by what to do.
 */
import type { LocalMarketAnswer, MarketCompetitor } from "@/lib/hamilton/local-market-answer";
import { fmtMoney } from "@/components/hamilton/memo/memo";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { REPORT_DESIGN_CSS } from "@/lib/report-design/css";
import { RD } from "@/lib/report-design/tokens";
import { Exhibit, HeroFigures } from "@/components/report-design";
import { shortBankName } from "@/lib/hamilton/studies-exhibits/market";
import { hamiltonIdentityLines } from "@/lib/hamilton/identity-display";

/** "$1.2B", "$850M", "$40K". */
export function fmtDeposits(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

const shortFee = (c: string) => getDisplayName(c).replace(/\s*\([^)]*\)/g, "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Row = MarketCompetitor & { own?: boolean };

function holders(data: LocalMarketAnswer): Row[] {
  const own: Row = {
    institutionId: data.institutionId,
    name: data.institutionName,
    charterType: data.charterType,
    branches: data.you.branchesInMarket,
    deposits: data.you.depositsInMarket,
    fees: data.you.fees,
    own: true,
  };
  return ([own, ...data.competitors] as Row[])
    .filter((r) => (r.branches ?? 0) > 0 || r.own)
    .sort((a, b) => (b.branches ?? 0) - (a.branches ?? 0) || (b.deposits ?? -1) - (a.deposits ?? -1));
}

function Swatch({ color, ring }: { color: string; ring?: boolean }) {
  return (
    <svg width="10" height="10" aria-hidden className="mr-2 inline-block align-baseline">
      {ring ? <circle cx="5" cy="5" r="3.8" fill={RD.paper} stroke={color} strokeWidth="1.6" /> : <circle cx="5" cy="5" r="4.5" fill={color} />}
    </svg>
  );
}

/** Who holds the market: ranked by branches there, deposits beside for banks. */
function HoldersTable({ data }: { data: LocalMarketAnswer }) {
  const rows = holders(data);
  const total = data.marketDeposits ?? 0;
  return (
    <div className="rd-table-wrap overflow-x-auto">
      <table className="rd-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Institution</th>
            <th className="num">Branches here</th>
            <th className="num">Deposits here</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const share = r.deposits != null && total > 0 ? `${(Math.round((r.deposits / total) * 1000) / 10).toFixed(1)}%` : null;
            const colour = r.own ? RD.terra : (data.colours?.[r.institutionId] ?? RD.context);
            return (
              <tr key={r.institutionId} className={r.own ? "rd-subject" : undefined}>
                <td className="num">{i + 1}</td>
                <td>
                  <Swatch color={colour} ring={r.charterType === "credit_union" && !r.own} />
                  {shortBankName(r.name)}
                  {r.own ? " (research subject)" : r.charterType === "credit_union" ? " · CU" : ""}
                </td>
                <td className="num">{r.branches ?? "n/a"}</td>
                <td className="num">{r.deposits != null ? fmtDeposits(r.deposits) : r.charterType === "credit_union" ? "not reported" : "n/a"}</td>
                <td className="num">{share ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Where the bank's branches are: one row per city, most first, with a bar to scale. */
function CitiesTable({ data }: { data: LocalMarketAnswer }) {
  const cities = data.you.cities.slice(0, 12);
  const max = Math.max(1, ...cities.map((c) => c.branches));
  const rest = data.you.cities.length - cities.length;
  // One state needs no state on every row.
  const oneState = new Set(data.you.cities.map((c) => c.state)).size === 1;
  return (
    <div className="rd-table-wrap overflow-x-auto">
      <table className="rd-table">
        <thead>
          <tr>
            <th>City</th>
            <th className="num">Branches</th>
            <th className="w-2/5" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {cities.map((c) => (
            <tr key={`${c.city}-${c.state}`}>
              <td>{oneState ? c.city : `${c.city}, ${c.state}`}</td>
              <td className="num">{c.branches}</td>
              <td aria-hidden>
                <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block h-2 w-full">
                  <rect x="0" y="0" width="100" height="8" fill={RD.rule} />
                  <rect x="0" y="0" width={(c.branches / max) * 100} height="8" fill={RD.terra} />
                </svg>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rest > 0 ? <p className="rd-source not-italic">And {plural(rest, "more city", "more cities")}.</p> : null}
    </div>
  );
}

function feeMark(theirs: number | undefined, yours: number | undefined) {
  if (theirs == null || yours == null) return null;
  if (Math.abs(theirs - yours) < 0.005) return { sign: "=", color: RD.muted, label: "same as the research subject" };
  return theirs > yours ? { sign: "▲", color: RD.ink, label: "higher than the research subject" } : { sign: "▼", color: RD.terraText, label: "lower than the research subject" };
}

/** What the market publishes for the main fees, the bank's row first; each cell marked against the bank's own price. */
function FeeTable({ data, cats }: { data: LocalMarketAnswer; cats: string[] }) {
  const rows = data.competitors.filter((r) => Object.keys(r.fees).length > 0);
  return (
    <div className="rd-table-wrap overflow-x-auto">
      <table className="rd-table min-w-[32rem]">
        <thead>
          <tr>
            <th>Institution</th>
            {cats.map((c) => (
              <th key={c} className="num">
                {shortFee(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="rd-subject">
            <td>{shortBankName(data.institutionName)} (research subject)</td>
            {cats.map((c) => (
              <td key={c} className="num">
                {data.you.fees[c] != null ? fmtMoney(data.you.fees[c]) : <span style={{ color: RD.muted }}>·</span>}
              </td>
            ))}
          </tr>
          {rows.map((r) => (
            <tr key={r.institutionId}>
              <td>{shortBankName(r.name)}</td>
              {cats.map((c) => {
                const m = feeMark(r.fees[c], data.you.fees[c]);
                return (
                  <td key={c} className="num">
                    {r.fees[c] != null ? (
                      <>
                        {fmtMoney(r.fees[c])}
                        {m ? (
                          <span className="ml-1.5 text-[10px]" style={{ color: m.color }} title={m.label} aria-label={m.label}>
                            {m.sign}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ color: RD.muted }}>·</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A headline for the fee table computed from the data: how the market's overdraft sits against the bank's. */
const article = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");

function feeHeadline(data: LocalMarketAnswer, cats: string[]): string {
  const cat = cats.find((c) => data.you.fees[c] != null && data.competitors.some((r) => r.fees[c] != null));
  if (!cat) return "What competitors publish for the main fees";
  const yours = data.you.fees[cat];
  const theirs = data.competitors.map((r) => r.fees[cat]).filter((v): v is number => v != null);
  const higher = theirs.filter((v) => v - yours >= 0.005).length;
  const lower = theirs.filter((v) => yours - v >= 0.005).length;
  return `Of ${plural(theirs.length, "competitor", "competitors")} with ${article(shortFee(cat))} ${shortFee(cat).toLowerCase()} fee on file, ${higher} ${higher === 1 ? "is" : "are"} higher than ${data.institutionName}’s ${fmtMoney(yours)} and ${lower} lower`;
}

export function LocalMarketView({ data }: { data: LocalMarketAnswer }) {
  const competitorCount = data.competitors.length;
  const ownShare =
    data.you.depositsInMarket != null && data.marketDeposits ? Math.round((data.you.depositsInMarket / data.marketDeposits) * 1000) / 10 : null;
  const basis =
    data.market.basis === "branch_counties"
      ? `The market is the ${data.market.countyCount === 1 ? "county" : `${data.market.countyCount} counties`} where ${data.institutionName} holds the most deposits.`
      : `The market is the ${data.market.countyCount === 1 ? "county" : "counties"} around ${data.institutionName}’s headquarters city.`;
  const sod = `FDIC Summary of Deposits, June 30, ${data.market.sodYear}`;
  const ranked = holders(data);
  const leader = ranked.find((r) => !r.own);
  const cats = data.categories.filter((c) => data.you.fees[c] != null || data.competitors.some((r) => r.fees[c] != null));
  const feeRows = data.competitors.some((r) => Object.keys(r.fees).length > 0);
  let n = 0;
  const next = () => ++n;
  const topCity = data.you.cities[0];
  return (
    <div className="rd">
      <style href="report-design" precedence="medium">
        {REPORT_DESIGN_CSS}
      </style>
      <header className="rd-cover">
        <div className="rd-eyebrow">Local market research</div>
        <h1 className="rd-title">
          {competitorCount} {competitorCount === 1 ? "institution competes" : "institutions compete"} with {data.institutionName} in the {data.market.label}
        </h1>
        <p className="rd-deck">{basis}</p>
        {hamiltonIdentityLines(data.identityContext).map((line) => (
          <p key={line} className="rd-source not-italic">{line}</p>
        ))}
        <HeroFigures
          heroes={[
            { figure: String(data.you.branches), label: "Research subject branches, everywhere" },
            {
              figure: data.you.branchesInMarket != null ? String(data.you.branchesInMarket) : "n/a",
              label: data.marketBranches != null ? `Research subject branches here, of ${data.marketBranches} bank branches` : "Research subject branches in this market",
            },
            { figure: ownShare != null ? `${ownShare}%` : "n/a", label: ownShare != null ? "Research subject share of local bank deposits" : "Credit unions report no deposits by branch" },
            { figure: String(competitorCount), label: "Competitors shown" },
          ]}
        />
      </header>

      {data.map ? (
        <Exhibit
          exhibit={{
            key: "market-map",
            label: `Exhibit ${next()} · Footprint`,
            title:
              data.marketBranches != null && data.marketDeposits != null
                ? `${plural(data.marketBranches, "bank branch holds", "bank branches hold")} ${fmtDeposits(data.marketDeposits)} in the market's main county`
                : "Bank branches in the market's main county",
            panels: [{ html: data.map.html }],
            source:
              data.charterType === "credit_union"
                ? `Source: ${sod} (bank branches); NCUA credit union branch file (research subject branches, drawn as rings since credit unions report no deposits by branch).`
                : `Source: ${sod}.`,
          }}
        >
          {/* Legend HTML built from escaped names by studies-exhibits/market.ts. */}
          <div dangerouslySetInnerHTML={{ __html: data.map.legend }} />
        </Exhibit>
      ) : null}

      <Exhibit
        exhibit={{
          key: "market-holders",
          label: `Exhibit ${next()} · Who holds the market`,
          title: !leader
            ? "Who holds the market"
            : ranked[0]?.own
              ? `${data.institutionName} has the most branches here (${ranked[0].branches ?? 0}); ${shortBankName(leader.name)} is next with ${leader.branches ?? 0}`
              : `${shortBankName(leader.name)} has the most branches here (${leader.branches ?? 0}); ${data.institutionName} has ${data.you.branchesInMarket ?? "none on file"}`,
          sub: "Ranked by branches in the market. Deposits are reported for banks only.",
          source: `Source: ${sod} (bank branches and deposits); NCUA branch file (credit union branches, counted by city).`,
        }}
      >
        <HoldersTable data={data} />
      </Exhibit>

      {data.you.cities.length > 0 ? (
        <Exhibit
          exhibit={{
            key: "market-cities",
            label: `Exhibit ${next()} · Research subject branches`,
            title: `${data.institutionName}: ${plural(data.you.branches, "branch is", "branches are")} in ${plural(data.you.cities.length, "city", "cities")}${topCity ? `, the most in ${topCity.city} (${topCity.branches})` : ""}`,
            sub: data.network ? "Each circle is a city, sized by research subject branches there. The shaded counties are the market above." : undefined,
            panels: data.network ? [{ html: data.network }] : undefined,
            source: `${data.charterType === "credit_union" ? "Source: NCUA credit union branch file." : `Source: ${sod}.`}${
              data.network && data.unmapped > 0 ? ` ${plural(data.unmapped, "branch has", "branches have")} no location on file and ${data.unmapped === 1 ? "is" : "are"} left off the map.` : ""
            }`,
          }}
        >
          <CitiesTable data={data} />
        </Exhibit>
      ) : null}

      <Exhibit
        exhibit={{
          key: "market-fees",
          label: `Exhibit ${next()} · Fees`,
          title: feeHeadline(data, cats),
          legend: [
            { label: "▲ higher than the research subject" },
            { label: "▼ lower than the research subject" },
            { label: "· no published amount on file" },
          ],
          notice: cats.length === 0 || !feeRows ? "No institution in this market publishes these fees yet." : undefined,
          source: "Source: Bank Fee Index, published fee schedules (median where a schedule lists more than one amount).",
        }}
      >
        {cats.length > 0 && feeRows ? <FeeTable data={data} cats={cats} /> : null}
      </Exhibit>
    </div>
  );
}
