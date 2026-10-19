import { PRODUCT_NAME } from "@/lib/constants";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { CountUp, type CountUnit } from "./count-up";
import type { CohortDistribution } from "./fee-share-cohort";
import { MIN_COHORT_PEERS, ordinal } from "./fee-share-cohort";
import type { FeeIncomeTerms } from "./financial-units";
import { formatReportQuarter } from "./financial-units";
import { ledgerProvenance, metricDefs, quarterEndLabel, shareName } from "./overview-metrics";
import { pct, type Observation } from "./overview-observations";
import type { CompareCounts } from "./profile-view";
import { Provenance, type ProvenanceRow } from "./provenance";
import { QuarterChart } from "./quarter-chart";
import { SOURCE_NAMES } from "./ledger-fields";
import { latestOf, type Ledger, type LedgerMetric, type LedgerSource } from "./quarterly-ledger";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";
import { SERIF } from "./profile-serif";

const H2 = "text-[36px] font-medium leading-[1.04] tracking-[-0.02em] text-ink sm:text-[54px]";
const OVERVIEW_QUARTERS = 10;

/** The card's source line: the filing, short, then the date it covers. */
const SOURCE_SHORT: Record<LedgerSource, string> = {
  ffiec: "FFIEC call report",
  fdic: "FDIC call report data",
  ncua: "NCUA 5300 call report",
};

interface Card {
  key: string;
  label: string;
  value: { n: number; unit: CountUnit } | null;
  /** Short words in place of a value: "Not reported", "Not enough peers". */
  empty?: string;
  /** One short line under the value: the period, the comparison, or why there is no value. */
  qualifier: string | null;
  /** One quiet line pinned to the card bottom: where the figure comes from and its date. */
  source: string | null;
  action?: { href: string; label: string };
}

/** One row of the shared "How these figures are measured" drawer. */
interface MeasureRow {
  key: string;
  metric: string;
  measure: string | null;
  calculation: string | null;
  source: string | null;
  fields: string | null;
  period: string | null;
  periodNote: string | null;
  retrieved: string | null;
}

/**
 * Every card has the same four parts on a shared subgrid (label, value, qualifier, source), so
 * values and source lines line up across a row whatever the label length.
 */
function MetricCard({ card }: { card: Card }) {
  return (
    <li
      data-card={card.key}
      className="row-span-4 grid min-w-0 grid-rows-subgrid gap-y-0 rounded-xl border border-border bg-surface-0 p-4"
    >
      <p className="text-[12px] font-semibold uppercase leading-snug tracking-[0.1em] text-ink-muted">{card.label}</p>
      <div className="mt-2 flex items-end">
        {card.value ? (
          <p className="text-[30px] font-medium leading-none tracking-[-0.01em] text-ink [font-variant-numeric:tabular-nums] sm:text-[34px]" style={SERIF}>
            <CountUp value={card.value.n} unit={card.value.unit} />
          </p>
        ) : (
          <p className="text-[15px] font-semibold leading-snug text-ink-soft">{card.empty ?? "Not reported"}</p>
        )}
      </div>
      <div className="mt-2 flex flex-col items-start">
        {card.qualifier && <p className="text-[13px] leading-snug text-ink-soft [font-variant-numeric:tabular-nums]">{card.qualifier}</p>}
        {card.action && (
          <a
            href={card.action.href}
            className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            {card.action.label}
          </a>
        )}
      </div>
      <p className="mt-3 self-end border-t border-border pt-3 text-[12px] leading-snug text-ink-muted [font-variant-numeric:tabular-nums]">
        {card.source ?? "Not on file"}
      </p>
    </li>
  );
}

/** The cards' sources and caveats, once, in one collapsed drawer under the row. */
function MeasuresDrawer({ note, rows }: { note: string; rows: MeasureRow[] }) {
  return (
    <details className="group/measures mt-3 rounded-xl border border-border bg-surface-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-[9px] transition-transform group-open/measures:rotate-90">
          &#9654;
        </span>
        How these figures are measured
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3">
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-ink-soft">{note}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-left text-[13px] leading-snug">
            <thead>
              <tr className="border-b border-border text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                <th scope="col" className="w-[15%] py-2 pr-4 font-semibold">Metric</th>
                <th scope="col" className="w-[36%] py-2 pr-4 font-semibold">Measure and calculation</th>
                <th scope="col" className="w-[21%] py-2 pr-4 font-semibold">Source and fields</th>
                <th scope="col" className="w-[16%] py-2 pr-4 font-semibold">Period</th>
                <th scope="col" className="w-[12%] py-2 font-semibold">Retrieved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="py-3 pr-4 font-medium text-ink">{row.metric}</th>
                  <td className="py-3 pr-4">
                    <p className="text-ink-soft">{row.measure ?? "Not on file"}</p>
                    {row.calculation && <p className="mt-1 text-ink-muted">{row.calculation}</p>}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="text-ink-soft">{row.source ?? "Not on file"}</p>
                    {row.fields && <p className="mt-1 text-[12px] text-ink-muted [font-family:var(--fi-font-mono)]">{row.fields}</p>}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="whitespace-nowrap text-ink-soft [font-variant-numeric:tabular-nums]">{row.period ?? "Not on file"}</p>
                    {row.periodNote && <p className="mt-1 whitespace-nowrap text-ink-muted [font-variant-numeric:tabular-nums]">{row.periodNote}</p>}
                  </td>
                  <td className="whitespace-nowrap py-3 text-ink-soft [font-variant-numeric:tabular-nums]">{row.retrieved ?? "Not recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

const pick = (rows: ProvenanceRow[], label: string): string | null => rows.find((r) => r.label === label)?.value ?? null;

export function cohortLabel(kind: "bank" | "credit_union", sizeRange: string | null): string {
  const noun = kind === "credit_union" ? "credit unions" : "banks";
  return sizeRange ? `${noun} with ${sizeRange} in assets` : `${noun} of its asset size`;
}

export function ExecutiveOverview({
  institutionName,
  ledger,
  cohort,
  cohortName,
  counts,
  stateName,
  feesReadOn,
  terms,
  observations,
  cohortRead = false,
  feesSparse = false,
}: {
  institutionName: string;
  ledger: Ledger;
  cohort: CohortDistribution | null;
  /** "banks with $1B to $10B in assets". */
  cohortName: string | null;
  counts: CompareCounts | null;
  stateName: string | null;
  feesReadOn: string | null;
  terms: FeeIncomeTerms;
  observations: Observation[];
  /** The size cohort was read for the quarter, so a missing distribution means too few peers. */
  cohortRead?: boolean;
  /** Fewer verified fees than the page compares, so the fee card has no count. */
  feesSparse?: boolean;
}) {
  const defs = metricDefs(terms, ledger.filer);
  const peerNoun = ledger.filer === "credit_union" ? "credit unions" : "banks";
  const retrieved = ledger.retrievedAt ? formatAbsoluteDate(ledger.retrievedAt) : null;

  const cards: Card[] = [];
  const rows: MeasureRow[] = [];

  const addLedger = (metric: LedgerMetric, label: string) => {
    const def = defs[metric];
    const latest = latestOf(ledger, metric);
    const quarterEnd = latest ? quarterEndLabel(latest.quarter.reportDate) : null;
    cards.push({
      key: metric,
      label,
      value: latest ? { n: latest.value.value, unit: def.unit === "percent" ? "percent" : "dollars" } : null,
      qualifier: latest ? `${latest.quarter.quarter}, ${def.flow ? "one quarter" : "quarter end"}` : null,
      source: latest ? `${SOURCE_SHORT[latest.value.source]} · ${quarterEnd}` : null,
    });
    const prov = latest ? ledgerProvenance({ ledger, def, quarters: [latest.quarter], institutionName }) : [];
    rows.push({
      key: metric,
      metric: label,
      measure: def.measure,
      calculation: pick(prov, "Calculation"),
      source: pick(prov, "Source"),
      fields: pick(prov, "Fields"),
      period: latest?.quarter.quarter ?? null,
      periodNote: quarterEnd ? `Quarter ended ${quarterEnd}` : null,
      retrieved: latest ? retrieved : null,
    });
  };

  addLedger("assets", "Total assets");
  addLedger("revenue", "Revenue");
  addLedger("serviceCharges", terms.amount);

  // The share card. No distribution means either too few peers reported a share (the cohort was
  // read) or the cohort could not be read for this quarter; the card says which.
  const cohortQuarter = cohort ? formatReportQuarter(cohort.reportDate) : null;
  const shareLabel = `${shareName(terms)} of revenue`;
  cards.push({
    key: "share",
    label: shareLabel,
    value: cohort?.subject ? { n: cohort.subject.sharePct, unit: "percent" } : null,
    empty: cohort ? "Not reported" : cohortRead ? "Not enough peers" : "Not available",
    qualifier: cohort
      ? cohort.percentileRank !== null
        ? `${ordinal(cohort.percentileRank)} percentile; peer median ${pct(cohort.median)}`
        : `Peer median ${pct(cohort.median)}`
      : cohortRead
        ? `Fewer than ${MIN_COHORT_PEERS} ${peerNoun} its size reported a share`
        : "Peer figures could not be read",
    source: cohort
      ? `${SOURCE_SHORT[cohort.source]} · ${quarterEndLabel(cohort.reportDate)}`
      : null,
  });
  rows.push({
    key: "share",
    metric: shareLabel,
    measure: defs.sharePct.measure,
    calculation: cohort
      ? `${cohort.source === "ncua" ? "Year to date through the quarter." : "One quarter, as reported."} Median and percentile from each of ${cohort.peers.length.toLocaleString("en-US")} ${cohortName ?? "peers"} reporting a share above 0%, this one left out.`
      : `Shown when at least ${MIN_COHORT_PEERS} ${peerNoun} of its size report a share above 0%.`,
    source: cohort ? SOURCE_NAMES[cohort.source] : null,
    fields: cohort ? (cohort.source === "ncua" ? "Account 131 / (Account 115 + Account 117)" : "ISERCHGQ / (NIMQ + NONIIQ)") : null,
    period: cohortQuarter,
    periodNote: cohort ? (cohort.source === "ncua" ? "Year to date" : `Quarter ended ${quarterEndLabel(cohort.reportDate)}`) : null,
    retrieved: null,
  });

  const place = counts?.level === "state" && stateName ? stateName : "U.S.";
  const feeLabel = `Fees above the ${place} median`;
  cards.push({
    key: "fees",
    label: feeLabel,
    value: counts ? { n: counts.above, unit: "count" } : null,
    empty: feesSparse ? "Too few fees" : "None compared",
    qualifier: counts
      ? `of ${counts.compared} compared; ${counts.below} below, ${counts.same} about the same`
      : feesSparse
        ? `Fewer than ${MIN_VERIFIED_FEES_FOR_OFFER} verified fees on file`
        : "No fee has a median to compare",
    source: feesReadOn ? `Fee schedule read ${feesReadOn}` : null,
    action: counts ? { href: "#compare-heading", label: "See the fees" } : undefined,
  });
  rows.push({
    key: "fees",
    metric: feeLabel,
    measure: `Published fees above the ${place} median for the same fee`,
    calculation: "Within 1% of the median counts as about the same. Business-only fees are left out.",
    source: `${institutionName}'s published fee schedule; ${PRODUCT_NAME} medians`,
    fields: null,
    period: "Current schedule",
    periodNote: null,
    retrieved: feesReadOn,
  });

  const note =
    ledger.filer === "credit_union"
      ? `Call-report figures are for ${institutionName}, from NCUA 5300 call reports. Revenue is interest income plus noninterest income.`
      : `Call-report figures are for ${institutionName} at the bank level, not its holding company. Revenue is net interest income plus noninterest income.`;

  const trend = ledger.quarters.filter((q) => q.values.serviceCharges).slice(-OVERVIEW_QUARTERS);
  const trendPoints = trend.map((q) => ({ reportDate: q.reportDate, quarter: q.quarter, value: q.values.serviceCharges?.value ?? null }));
  const span = trend.length > 0 ? `${trend[0].quarter} to ${trend[trend.length - 1].quarter}` : null;

  return (
    <section aria-labelledby="overview-heading" className="scroll-mt-20">
      <h2 id="overview-heading" className={H2} style={SERIF}>
        Overview
      </h2>
      <ul className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <MetricCard key={card.key} card={card} />
        ))}
      </ul>
      <MeasuresDrawer note={note} rows={rows} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <figure className="min-w-0 rounded-xl border border-border bg-surface-0 p-4 sm:p-5">
          <figcaption>
            <p className="text-[15px] font-semibold text-ink">{terms.amount} by quarter</p>
            <p className="text-[13px] text-ink-muted">
              {span ? `${span}, standalone quarters` : "Not reported"}
            </p>
          </figcaption>
          {trendPoints.length > 1 ? (
            <div className="mt-3">
              <QuarterChart points={trendPoints} unit="dollars" flow label={`${terms.amount} by quarter`} height={220} />
            </div>
          ) : (
            <p className="mt-3 text-[14px] text-ink-muted">Fewer than two quarters on file.</p>
          )}
          <Provenance rows={ledgerProvenance({ ledger, def: defs.serviceCharges, quarters: trend, institutionName })} />
        </figure>

        {observations.length > 0 && (
          <div className="min-w-0">
            <h3 className="text-[22px] font-medium leading-tight text-ink sm:text-[26px]" style={SERIF}>
              What stands out
            </h3>
            <ol className="mt-4 space-y-4">
              {observations.map((o) => (
                <li key={o.key} className="border-l-2 border-[var(--fi-subject)] pl-4">
                  <p className="text-[15px] leading-relaxed text-ink">{o.fact}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                    <span className="font-medium text-ink-soft">Not established: </span>
                    {o.notEstablished}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
