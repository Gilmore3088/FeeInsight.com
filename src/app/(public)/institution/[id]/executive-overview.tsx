import { PRODUCT_NAME } from "@/lib/constants";
import { CountUp, type CountUnit } from "./count-up";
import type { CohortDistribution } from "./fee-share-cohort";
import { ordinal } from "./fee-share-cohort";
import type { FeeIncomeTerms } from "./financial-units";
import { formatReportQuarter } from "./financial-units";
import { entityLabel, ledgerProvenance, metricDefs, quarterEndLabel, shareName, type MetricDef } from "./overview-metrics";
import { pct, type Observation } from "./overview-observations";
import type { CompareCounts } from "./profile-view";
import { Provenance, type ProvenanceRow } from "./provenance";
import { QuarterChart } from "./quarter-chart";
import { SOURCE_NAMES } from "./ledger-fields";
import { latestOf, type Ledger, type LedgerMetric } from "./quarterly-ledger";
import { SERIF } from "./profile-serif";

const H2 = "text-[36px] font-medium leading-[1.04] tracking-[-0.02em] text-ink sm:text-[54px]";
const OVERVIEW_QUARTERS = 10;

interface Card {
  key: string;
  label: string;
  value: { n: number; unit: CountUnit } | null;
  /** Shown in place of a value: "Not reported", "Insufficient sample". */
  empty?: string;
  context?: string | null;
  asOf: string | null;
  entity: string;
  details: ProvenanceRow[];
  href?: string;
}

function MetricCard({ card }: { card: Card }) {
  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-border bg-surface-0 p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{card.label}</p>
      <p className="mt-2 text-[30px] font-medium leading-none tracking-[-0.01em] text-ink sm:text-[34px]" style={SERIF}>
        {card.value ? <CountUp value={card.value.n} unit={card.value.unit} /> : <span className="text-[20px] text-ink-muted">{card.empty ?? "Not reported"}</span>}
      </p>
      {card.context && <p className="mt-2 text-[13px] leading-snug text-ink-soft [font-variant-numeric:tabular-nums]">{card.context}</p>}
      <p className="mt-auto pt-3 text-[12px] leading-snug text-ink-muted">
        {[card.asOf, card.entity].filter(Boolean).join(" · ")}
      </p>
      <Provenance rows={card.details} />
      {card.href && (
        <a href={card.href} className="-mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          See the fees
        </a>
      )}
    </li>
  );
}

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
}) {
  const defs = metricDefs(terms, ledger.filer);
  const level = ledger.filer === "credit_union" ? "Credit union" : "Bank level";
  const entity = entityLabel(institutionName, ledger.filer);

  const ledgerCard = (metric: LedgerMetric, label: string, def: MetricDef = defs[metric]): Card => {
    const latest = latestOf(ledger, metric);
    return {
      key: metric,
      label,
      value: latest ? { n: latest.value.value, unit: def.unit === "percent" ? "percent" : "dollars" } : null,
      context: latest && def.flow ? `${latest.quarter.quarter}, one quarter` : null,
      asOf: latest ? quarterEndLabel(latest.quarter.reportDate) : null,
      entity: level,
      details: latest ? ledgerProvenance({ ledger, def, quarters: [latest.quarter], institutionName }) : [],
    };
  };

  const cohortQuarter = cohort ? formatReportQuarter(cohort.reportDate) : null;
  const shareCard: Card = {
    key: "share",
    label: `${shareName(terms)} of revenue`,
    value: cohort?.subject ? { n: cohort.subject.sharePct, unit: "percent" } : null,
    empty: cohort ? "Not reported" : "Insufficient sample",
    context:
      cohort && cohortName
        ? `Median ${pct(cohort.median)} for ${cohort.peers.length.toLocaleString("en-US")} ${cohortName}${
            cohort.percentileRank !== null ? `; ${ordinal(cohort.percentileRank)} percentile` : ""
          }`
        : null,
    asOf: cohort ? `${cohortQuarter}${cohort.source === "ncua" ? ", year to date" : ""}` : null,
    entity: level,
    details: cohort
      ? [
          { label: "Source", value: SOURCE_NAMES[cohort.source] },
          { label: "Entity", value: entity },
          { label: "Period", value: `${cohortQuarter} (quarter ended ${quarterEndLabel(cohort.reportDate)})` },
          { label: "Measure", value: defs.sharePct.measure },
          {
            label: "Calculation",
            value:
              cohort.source === "ncua"
                ? "Year to date through the quarter. Cohort median and percentile computed from every peer's own share."
                : "One quarter, as reported. Cohort median and percentile computed from every peer's own share.",
          },
          { label: "Fields", value: cohort.source === "ncua" ? "Account 131 / (Account 115 + Account 117)" : "ISERCHGQ / (NIMQ + NONIIQ)" },
          { label: "Cohort", value: cohortName ? `${cohort.peers.length.toLocaleString("en-US")} ${cohortName} reporting a share above 0%, itself left out` : null },
        ]
      : [],
  };

  const place = counts?.level === "state" && stateName ? stateName : "U.S.";
  const feeCard: Card = {
    key: "fees",
    label: `Fees above the ${place} median`,
    value: counts ? { n: counts.above, unit: "count" } : null,
    empty: "Insufficient sample",
    context: counts ? `of ${counts.compared} comparable published fees; ${counts.below} below, ${counts.same} about the same` : null,
    asOf: feesReadOn ? `Schedule read ${feesReadOn}` : null,
    entity: "Published fee schedule",
    details: counts
      ? [
          { label: "Source", value: `${institutionName}'s published fee schedule; ${PRODUCT_NAME} medians` },
          { label: "Entity", value: institutionName },
          { label: "Period", value: feesReadOn ? `Schedule read ${feesReadOn}` : null },
          { label: "Measure", value: `Published fees above the ${place} median for the same fee` },
          { label: "Calculation", value: "Within 1% of the median counts as about the same. Business-only fees are left out." },
        ]
      : [],
    href: counts ? "#compare-heading" : undefined,
  };

  const cards: Card[] = [
    ledgerCard("assets", "Total assets"),
    ledgerCard("revenue", "Revenue"),
    ledgerCard("serviceCharges", terms.amount),
    shareCard,
    feeCard,
  ];

  const trend = ledger.quarters.filter((q) => q.values.serviceCharges).slice(-OVERVIEW_QUARTERS);
  const trendPoints = trend.map((q) => ({ reportDate: q.reportDate, quarter: q.quarter, value: q.values.serviceCharges?.value ?? null }));
  const span = trend.length > 0 ? `${trend[0].quarter} to ${trend[trend.length - 1].quarter}` : null;

  return (
    <section aria-labelledby="overview-heading" className="scroll-mt-20">
      <h2 id="overview-heading" className={H2} style={SERIF}>
        Overview
      </h2>
      <p className="mt-3 text-[13px] text-ink-muted">
        {ledger.filer === "credit_union"
          ? "Revenue is interest income plus noninterest income, from NCUA 5300 call reports."
          : "Revenue is net interest income plus noninterest income. Call-report figures are for the bank, not its holding company."}
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <MetricCard key={card.key} card={card} />
        ))}
      </ul>

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
