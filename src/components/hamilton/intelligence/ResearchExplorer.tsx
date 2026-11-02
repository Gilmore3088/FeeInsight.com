import Link from "next/link";
import { DashboardCard } from "@/components/hamilton/dashboard";
import { RESEARCH_STATE_CODES, type LandingResearchHandoff, type ResearchStateCode } from "@/lib/hamilton/landing-research-handoff";
import { ASSET_SIZES, type AssetSize } from "@/lib/hamilton/asset-size";
import { MARKET_BRIEF_CATEGORIES } from "@/lib/hamilton/market-question";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { explorerHref, type ExplorerLinkBase, type MarketExplorerData } from "@/lib/hamilton/dashboard/market-explorer";
import type { GeographicResearchResult } from "@/lib/hamilton/landing-geographic-research";
import { DatasetNote } from "@/components/hamilton/DatasetNote";
import { EvidenceDetails } from "./EvidenceDetails";
import { MarketExplorer, type ExplorerOption } from "./MarketExplorer";

const SOURCE = "Source: published fee schedules, verified and live.";
const TYPE_WORDS: Record<LandingResearchHandoff["charter"], string> = { all: "Banks and credit unions", bank: "Banks", credit_union: "Credit unions" };
const SIZE_WORDS: Record<string, string> = { all: "", "under-1b": " under $1B", "1b-10b": " of $1B to $10B", "10b-plus": " of $10B and up" };
const dollars = (v: number | null | undefined) => v == null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

/** The title of the fees lens: "Overdraft across Florida". */
export function explorerTitle(data: MarketExplorerData): string {
  return `${data.feeName} across ${data.region.kind === "national" ? "the US" : data.region.label}`;
}

/**
 * Research's fees lens as the market explorer (Research.dc.html): the controls, headline figures,
 * price spread, state map and institution table on the dashboard kit, then the five core fees side
 * by side as before. Builds every control's link on the server from the page's own URL parameters.
 */
export function ResearchExplorer({
  data,
  landscape,
  base,
  size,
  subjectState,
  subjectDistrict,
}: {
  data: MarketExplorerData | null;
  /** The five core fees in this scope against the nation (the existing landscape read). */
  landscape: GeographicResearchResult | null;
  base: ExplorerLinkBase;
  size: AssetSize;
  subjectState: string | null;
  subjectDistrict: number | null;
}) {
  const { selection } = base;
  const scopeState = selection.scope.kind === "state" ? selection.scope.stateCode : null;
  const place = scopeState ? STATE_NAMES[scopeState] ?? scopeState : "United States";
  const stateForRegion = (scopeState ?? subjectState) as ResearchStateCode | null;
  const district = base.district ?? subjectDistrict ?? (stateForRegion ? STATE_TO_DISTRICT[stateForRegion] ?? null : null);

  const categories = [...new Set([...selection.categories, ...MARKET_BRIEF_CATEGORIES])];
  const fees: ExplorerOption[] = categories.map((c) => ({ value: c, label: getDisplayName(c), href: explorerHref(base, { category: c }) }));
  const regions: ExplorerOption[] = [
    ...(stateForRegion && (RESEARCH_STATE_CODES as readonly string[]).includes(stateForRegion)
      ? [{ value: "state", label: STATE_NAMES[stateForRegion] ?? stateForRegion, href: explorerHref(base, { region: stateForRegion }) }] : []),
    ...(district ? [{ value: "district", label: `Fed district ${district}`, href: explorerHref(base, { region: { district } }) }] : []),
    { value: "national", label: "National", href: explorerHref(base, { region: "national" }) },
  ];
  const regionValue = data?.region.kind ?? (scopeState ? "state" : base.district ? "district" : "national");
  const states: ExplorerOption[] = RESEARCH_STATE_CODES.map((code) => ({ value: code, label: STATE_NAMES[code] ?? code, href: explorerHref(base, { region: code }) }));
  const stateHrefs = Object.fromEntries(states.map((s) => [s.value, s.href]));
  const stateNames = Object.fromEntries(RESEARCH_STATE_CODES.map((code) => [code, STATE_NAMES[code] ?? code]));
  const types: ExplorerOption[] = (["bank", "credit_union", "all"] as const).map((c) => ({ value: c, label: c === "all" ? "Both" : TYPE_WORDS[c], href: explorerHref(base, { charter: c }) }));
  const sizes: ExplorerOption[] = ASSET_SIZES.map((s) => ({ value: s.id, label: s.label, href: explorerHref(base, { size: s.id }) }));
  const scopeNote = data
    ? `${TYPE_WORDS[selection.charter]}${SIZE_WORDS[size.id] ?? ""}, ${data.region.kind === "national" ? "national" : data.region.label}`
    : "";
  const comparisons = landscape?.comparisons ?? [];

  return (
    <>
      {data ? (
        <MarketExplorer
          data={data}
          scopeNote={scopeNote}
          fees={fees}
          regions={regions}
          regionValue={regionValue}
          states={states}
          stateValue={scopeState ?? ""}
          types={types}
          typeValue={selection.charter}
          sizes={sizes}
          sizeValue={size.id}
          stateNames={stateNames}
          stateHrefs={stateHrefs}
          source={SOURCE}
        />
      ) : (
        <DashboardCard title="Market explorer" titleId="rx-unavailable">
          <p role="status" className="hd-card-note">Published prices could not load. Refresh to retry; no substitute figures are shown.</p>
        </DashboardCard>
      )}

      <DashboardCard
        title={`The five core fees in ${place}`}
        titleId="rx-landscape"
        footnote={`Medians of one value per institution${scopeState ? ", against the US" : ""}. ${TYPE_WORDS[selection.charter]}${SIZE_WORDS[size.id] ?? ""}. Choose a fee to explore it.`}
      >
        {!landscape ? <p role="status" className="hd-card-note">Published comparisons could not load. Refresh to retry; no substitute figures are shown.</p> : (
          <div className="hd-table-wrap">
            <table className="hd-table" aria-label="Published fee comparisons">
              <caption className="hd-sr">Median, middle half, institutions and latest record per fee</caption>
              <thead><tr>{["Fee", "Median", "Middle half", "Institutions", ...(scopeState ? ["US median"] : []), "Latest record"].map((h, i) => <th scope="col" key={h} className={i === 0 ? "hd-left" : undefined} style={i === 0 ? undefined : { textAlign: "right" }}><span>{h}</span></th>)}</tr></thead>
              <tbody>{comparisons.map((row) => (
                <tr key={row.category} className={row.category === data?.category ? "hd-subject" : undefined}>
                  <th scope="row"><Link className="hd-row-link" href={explorerHref(base, { category: row.category })}>{getDisplayName(row.category)}</Link></th>
                  <td>{row.selected.status === "available" ? dollars(row.selected.median) : row.selected.status === "insufficient" ? "Too few" : "Not observed"}</td>
                  <td>{row.selected.p25 !== null && row.selected.p75 !== null ? `${dollars(row.selected.p25)}–${dollars(row.selected.p75)}` : "—"}</td>
                  <td>{row.selected.institutions.toLocaleString("en-US")}</td>
                  {scopeState ? <td>{dollars(row.national?.median ?? null)}</td> : null}
                  <td>{row.selected.lastUpdated?.slice(0, 10) ?? "Not recorded"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {landscape?.stamps ? <DatasetNote figures={[
          { label: place, stamp: landscape.stamps.selected },
          landscape.stamps.national ? { label: "the U.S. reference", stamp: landscape.stamps.national } : null,
        ]} /> : null}
        <EvidenceDetails
          source="Bank Fee Index · published fee catalog"
          period="Live catalog at page load; per-fee record dates in the table"
          geography={data?.region.kind === "district" ? `${data.region.label} (${DISTRICT_NAMES[data.region.district] ?? ""}), by headquarters` : `${place}, by headquarters`}
          coverage="Published consumer dollar fees; a fee stated as a rate is never pooled with dollar amounts. Institutions without a price are not counted as $0."
          method="One price per institution (the middle of its listed prices when it lists several), sister charters on one schedule counted once. Medians and middle halves need 10 institutions; with fewer only the range shows. States and districts are by headquarters; branches elsewhere are not counted."
        />
      </DashboardCard>
    </>
  );
}
