"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DashboardCard,
  FilterChips,
  KpiCard,
  PriceHistogram,
  SegmentedControl,
  SortableTable,
  StateTileMap,
  formatFigure,
  signedMoney,
  POSITION_LABEL,
  type SortableColumn,
  type SortableRow,
} from "@/components/hamilton/dashboard";
import type { MarketExplorerData } from "@/lib/hamilton/dashboard/market-explorer";

export interface ExplorerOption {
  value: string;
  label: string;
  href: string;
}

const PAGE = 12;
const money = (v: number | null) => formatFigure(v, "money");
const CHARTER_WORD: Record<string, string> = { bank: "Bank", credit_union: "Credit union" };

/**
 * The Research market explorer (Hamilton redesign, Nov 2026): pick a fee and a market, then read its
 * median and middle half, how prices spread, each state's median and every institution's price, with
 * the subject institution marked throughout. Every value arrives as a prop, read on the server; the
 * fee and scope controls are links in the page's own URL, so a view can be shared and reloaded.
 */
export function MarketExplorer({
  data,
  scopeNote,
  fees,
  regions,
  regionValue,
  states,
  stateValue,
  types,
  typeValue,
  sizes,
  sizeValue,
  stateNames,
  stateHrefs,
  source,
}: {
  data: MarketExplorerData;
  /** "Banks and credit unions, all sizes, in Florida". */
  scopeNote: string;
  fees: ExplorerOption[];
  regions: ExplorerOption[];
  regionValue: string;
  states: ExplorerOption[];
  stateValue: string;
  types: ExplorerOption[];
  typeValue: string;
  sizes: ExplorerOption[];
  sizeValue: string;
  stateNames: Record<string, string>;
  stateHrefs: Record<string, string>;
  source: string;
}) {
  const router = useRouter();
  const go = (options: ExplorerOption[]) => (value: string) => {
    const href = options.find((o) => o.value === value)?.href;
    if (href) router.push(href);
  };
  const { stats, subject, histogram } = data;
  const thin = stats.median === null;

  const subjectName = subject?.name ?? null;

  const heads = [
    {
      label: "Median",
      value: thin ? (stats.n ? "Too few" : "—") : money(stats.median),
      sub: thin ? `Needs ${data.minForMedian}; ${stats.n.toLocaleString("en-US")} here` : "Half charge less than this",
    },
    {
      label: "Middle half",
      value: thin ? "—" : `${money(stats.p25)}–${money(stats.p75)}`,
      sub: thin ? (stats.n ? `Range ${money(stats.min)} to ${money(stats.max)}` : "No prices in this scope") : "Where the middle 50% sit",
    },
    { label: "Institutions counted", value: stats.n.toLocaleString("en-US"), sub: scopeNote },
  ];

  const subjectCard = subject ? (() => {
    if (subject.price === null) return { value: "—", sub: `${subject.name} publishes no ${data.feeName.toLowerCase()} fee on file`, pill: null };
    const pill = subject.position ? { text: subject.position === "too_few" ? "Too few" : POSITION_LABEL[subject.position], position: subject.position } : null;
    const sub = !subject.inScope ? "Outside this filter; shown to compare"
      : thin || subject.others === 0 ? "Too few prices here to rank it"
      : `Higher than ${Math.round((subject.below / subject.others) * 100)}% of the others here, level with ${Math.round((subject.level / subject.others) * 100)}%`;
    return { value: money(subject.price), sub, pill };
  })() : null;

  const histLabel = `${data.feeName} prices, ${stats.n.toLocaleString("en-US")} institutions in ${histogram.bins.length} price bands from $0`
    + `${thin ? "; too few for a median" : `; median ${money(stats.median)}, middle half ${money(stats.p25)} to ${money(stats.p75)}`}`
    + `${subject?.price !== null && subject?.price !== undefined ? `. ${subject.name} charges ${money(subject.price)}.` : "."}`;

  const tiles = useMemo(() => data.states.map((s) => ({ code: s.code, name: stateNames[s.code] ?? s.code, n: s.n, median: s.median })), [data.states, stateNames]);

  const table = useMemo(() => {
    if (data.rows) {
      const columns: SortableColumn[] = [
        { key: "assets", label: "Assets", format: "dollars" },
        { key: "price", label: data.feeName, format: "money" },
      ];
      const rows: SortableRow[] = data.rows.map((r) => ({
        id: String(r.id),
        label: r.name,
        sublabel: [r.stateCode, r.charter ? CHARTER_WORD[r.charter] : null].filter(Boolean).join(" · ") || null,
        values: { assets: r.assets === null ? null : r.assets * 1000, price: r.amount },
        positions: { price: r.position },
        ...(r.several ? { display: { price: `${money(r.amount)} mid` } } : {}),
        highlight: r.subject,
        href: `/pro/intelligence?view=institution&instId=${r.id}`,
        links: r.documentUrl ? [{ label: "Fee schedule ↗", href: r.documentUrl }] : [],
      }));
      return { columns, rows, rowHeader: "Institution", sort: { key: "price", direction: "descending" as const }, links: "Source" };
    }
    const price = subject?.price ?? null;
    const columns: SortableColumn[] = [
      { key: "n", label: "Institutions", format: "count" },
      { key: "median", label: "Median", format: "money" },
      ...(price !== null && subjectName ? [{ key: "gap", label: `${subjectName} vs median`, format: "money" as const }] : []),
    ];
    const rows: SortableRow[] = data.states.filter((s) => s.n > 0).map((s) => {
      const gap = price !== null && s.median !== null ? price - s.median : null;
      return {
        id: s.code,
        label: stateNames[s.code] ?? s.code,
        values: { n: s.n, median: s.median, gap },
        display: {
          ...(s.median === null ? { median: "Too few" } : {}),
          ...(gap !== null ? { gap: Math.abs(gap) < 0.005 ? "● level" : signedMoney(gap) } : {}),
        },
        positions: gap === null || Math.abs(gap) < 0.005 ? undefined : { gap: gap > 0 ? "above" as const : "below" as const },
        highlight: s.code === subject?.stateCode,
        href: stateHrefs[s.code],
      };
    });
    return { columns, rows, rowHeader: "State", sort: { key: "median", direction: "descending" as const }, links: undefined };
  }, [data.rows, data.states, data.feeName, subject, subjectName, stateNames, stateHrefs]);

  const listed = table.rows.length;
  const tableNote = [
    data.rows && !thin ? "▲ above, ● in, ▼ below the middle half." : null,
    data.rows ? `${listed.toLocaleString("en-US")} listed.` : `${listed === 1 ? "1 state" : `${listed.toLocaleString("en-US")} states`} with a published price.`,
    source,
  ].filter(Boolean).join(" ");
  const tableDetails = [
    data.rows && subject && !subject.inScope && subject.price !== null ? `${subject.name} is outside this filter; its row is shown to compare.` : null,
    data.rows && data.unnamed ? `${data.unnamed} counted but not named.` : null,
    "One price per institution: the middle of its listed prices when it lists several (marked “mid”). Sister charters on one schedule count once in the figures above.",
    "Assets are the latest filed total. States are by headquarters; branches elsewhere are not counted.",
  ].filter(Boolean).join(" ");

  return (
    <>
      <section className="hd-card hd-controls" aria-label="Fee and scope">
        <div className="hd-control">
          <span className="hd-label">Fee</span>
          <FilterChips label="Fee" options={fees.map(({ value, label }) => ({ value, label }))} value={data.category} onChange={go(fees)} />
        </div>
        <div className="hd-control-row">
          <div className="hd-control">
            <span className="hd-label">Region</span>
            <SegmentedControl label="Region" options={regions} value={regionValue} onChange={go(regions)} />
          </div>
          <label className="hd-control">
            <span className="hd-label">Any state</span>
            <select value={stateValue} onChange={(e) => go(states)(e.target.value)} aria-label="Any state">
              <option value="">Choose a state</option>
              {states.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <div className="hd-control">
            <span className="hd-label">Type</span>
            <SegmentedControl label="Type" options={types} value={typeValue} onChange={go(types)} />
          </div>
          <div className="hd-control">
            <span className="hd-label">Asset size</span>
            <SegmentedControl label="Asset size" options={sizes} value={sizeValue} onChange={go(sizes)} />
          </div>
        </div>
      </section>

      <section className="hd-grid" aria-label="Headline figures">
        {heads.map((k) => <div key={k.label} className="hd-span-3"><KpiCard label={k.label} value={k.value} sub={k.sub} /></div>)}
        {subject && subjectCard ? (
          <div className="hd-span-3">
            <KpiCard label={subject.name} value={subjectCard.value} sub={subjectCard.sub} pill={subjectCard.pill} highlight />
          </div>
        ) : null}
      </section>

      <div className="hd-grid">
        <div className="hd-span-7" style={{ display: "flex", minWidth: 0 }}>
          <DashboardCard
            title="How prices spread"
            titleId="rx-spread"
            className="hd-grow"
            actions={<span className="hd-card-note">Tap or hover a bar for its count.</span>}
            footnote={source}
            footnoteDetails={`One price per institution. Bands are even widths from $0; the last band holds everything above it. A median and middle half need ${data.minForMedian} institutions.`}
          >
            <PriceHistogram
              bins={histogram.bins}
              total={stats.n}
              p25={stats.p25}
              median={stats.median}
              p75={stats.p75}
              subjectBin={subject?.price !== null && subject?.price !== undefined ? histogram.subjectBin : null}
              subjectName={subjectName}
              label={histLabel}
            />
          </DashboardCard>
        </div>
        <div className="hd-span-5" style={{ display: "flex", minWidth: 0 }}>
          <DashboardCard
            title="Median by state"
            titleId="rx-map"
            className="hd-grow"
            actions={<span className="hd-card-note">Tap or hover a state.</span>}
            footnote={source}
            footnoteDetails={`Every state, same type and size, whatever the region. Darker is a higher median. A median needs ${data.minForMedian} institutions; dashed states have fewer. States are by headquarters.`}
          >
            <StateTileMap
              key={data.region.kind === "state" ? data.region.stateCode : data.region.kind}
              tiles={tiles}
              feeName={data.feeName}
              selected={data.region.kind === "state" ? data.region.stateCode : subject?.stateCode ?? null}
              subjectState={subject?.stateCode ?? null}
              subject={subject ? { name: subject.name, price: subject.price } : null}
              hrefs={stateHrefs}
              openLabel="Show"
            />
          </DashboardCard>
        </div>
      </div>

      <DashboardCard
        title={data.rows ? "Every institution" : "By state"}
        titleId="rx-table"
        actions={<span className="hd-card-note">{data.rows ? `Sort by a column.${subject ? ` ${subject.name} is shaded.` : ""}` : "The national view lists states. Choose a state or district to list each institution."}</span>}
        footnote={tableNote}
        footnoteDetails={tableDetails}
      >
        {table.rows.length ? (
          <SortableTable
            key={`${data.category}-${data.region.label}-${table.rowHeader}`}
            caption={data.rows ? `${data.feeName} at every institution in ${data.region.label}` : `${data.feeName} median by state`}
            rowHeader={table.rowHeader}
            columns={table.columns}
            rows={table.rows}
            defaultSort={table.sort}
            pageSize={PAGE}
            findLabel={subject && table.rows.some((r) => r.highlight) ? `Find ${data.rows ? subject.name : stateNames[subject.stateCode ?? ""] ?? "your state"}` : undefined}
            labelSortable
            linksHeader={table.links}
          />
        ) : (
          <p className="hd-card-note">No institution in this scope publishes this fee.</p>
        )}
      </DashboardCard>
    </>
  );
}
