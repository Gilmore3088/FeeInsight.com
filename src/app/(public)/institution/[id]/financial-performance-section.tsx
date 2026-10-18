import { CohortStrip } from "./cohort-strip";
import { listablePeers, MIN_COHORT_PEERS, ordinal, type CohortDistribution } from "./fee-share-cohort";
import { FinancialPerformanceChart } from "./financial-performance";
import type { FeeIncomeTerms } from "./financial-units";
import { formatReportQuarter } from "./financial-units";
import { SOURCE_NAMES } from "./ledger-fields";
import { entityLabel, ledgerProvenance, metricDefs, quarterEndLabel } from "./overview-metrics";
import { pct } from "./overview-observations";
import { Provenance, type ProvenanceRow } from "./provenance";
import { LEDGER_METRICS, RANGES, rangeQuarters, type Ledger, type LedgerMetric, type RangeKey } from "./quarterly-ledger";
import { SERIF } from "./profile-serif";

const H2 = "text-[36px] font-medium leading-[1.04] tracking-[-0.02em] text-ink sm:text-[54px]";

/** Selector order (James's brief): balances, revenue, service charges, earnings, ratios. */
const SELECTOR: LedgerMetric[] = ["assets", "deposits", "revenue", "serviceCharges", "netIncome", "roaPct", "sharePct"];

export function FinancialPerformanceSection({
  institutionName,
  ledger,
  terms,
  cohort,
  cohortName,
  children,
}: {
  institutionName: string;
  ledger: Ledger;
  terms: FeeIncomeTerms;
  cohort: CohortDistribution | null;
  cohortName: string | null;
  /** The connected panel, set under the distribution. */
  children?: React.ReactNode;
}) {
  const defs = metricDefs(terms, ledger.filer);
  const metrics = SELECTOR.filter((m) => LEDGER_METRICS.includes(m) && ledger.quarters.filter((q) => q.values[m]).length >= 2);
  const provenance: Partial<Record<LedgerMetric, Record<RangeKey, ProvenanceRow[]>>> = {};
  for (const m of metrics) {
    provenance[m] = Object.fromEntries(
      RANGES.map((r) => [r.key, ledgerProvenance({ ledger, def: defs[m], quarters: rangeQuarters(ledger.quarters, m, r.key), institutionName })]),
    ) as Record<RangeKey, ProvenanceRow[]>;
  }

  const quarter = cohort ? (formatReportQuarter(cohort.reportDate) ?? cohort.reportDate) : null;
  // A peer the site never names (listablePeers) keeps its dot but travels without its name.
  const listedIds = new Set((cohort ? listablePeers(cohort.peers) : []).map((p) => p.id));
  const stripPeers = (cohort?.peers ?? []).map((p) => (listedIds.has(p.id) ? p : { ...p, name: "", city: null, state: null }));
  const yearToDate = cohort?.source === "ncua";
  const cohortRows: ProvenanceRow[] = cohort
    ? [
        { label: "Source", value: SOURCE_NAMES[cohort.source] },
        { label: "Entity", value: `Each ${ledger.filer === "credit_union" ? "credit union" : "bank"}, not its holding company` },
        { label: "Period", value: `${quarter} (quarter ended ${quarterEndLabel(cohort.reportDate)})${yearToDate ? ", year to date" : ""}` },
        { label: "Measure", value: defs.sharePct.measure },
        {
          label: "Calculation",
          value: "Quartiles interpolated across peers' own shares; percentile is the share of peers below, ties counted half",
        },
        { label: "Fields", value: cohort.source === "ncua" ? "Account 131 / (Account 115 + Account 117)" : "ISERCHGQ / (NIMQ + NONIIQ)" },
      ]
    : [];

  return (
    <section aria-labelledby="financial-heading" className="scroll-mt-20 space-y-8">
      <div>
        <h2 id="financial-heading" className={H2} style={SERIF}>
          Financial performance
        </h2>
        <p className="mt-3 text-[13px] text-ink-muted">Call reports for {entityLabel(institutionName, ledger.filer)}. Income lines are standalone quarters.</p>
      </div>

      {metrics.length > 0 ? (
        <FinancialPerformanceChart quarters={ledger.quarters} defs={defs} metrics={metrics} provenance={provenance} />
      ) : (
        <p className="text-[14px] text-ink-muted">Fewer than two quarters of call reports on file.</p>
      )}

      <div className="rounded-xl border border-border bg-surface-0 p-4 sm:p-5">
        <h3 className="text-[22px] font-medium leading-tight text-ink sm:text-[26px]" style={SERIF}>
          {terms.subject} share against its size cohort
        </h3>
        {cohort && cohortName && quarter ? (
          <>
            <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Financial cohort:</span> {cohort.filers.toLocaleString("en-US")} {cohortName}{" "}
              filing for {quarter}; {cohort.peers.length.toLocaleString("en-US")} reported a share above 0% and are counted, {institutionName}{" "}
              left out. Chosen by asset size alone, so it is a financial benchmark, not a list of local competitors.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 [font-variant-numeric:tabular-nums]">
              {[
                { label: institutionName, value: cohort.subject ? pct(cohort.subject.sharePct) : "Not reported" },
                { label: "Percentile", value: cohort.percentileRank !== null ? ordinal(cohort.percentileRank) : "Not reported" },
                { label: "25th percentile", value: pct(cohort.p25) },
                { label: "Median", value: pct(cohort.median) },
                { label: "75th percentile", value: pct(cohort.p75) },
              ].map((cell) => (
                <div key={cell.label} className="min-w-0">
                  <dt className="truncate text-[12px] text-ink-muted">{cell.label}</dt>
                  <dd className="text-[18px] font-semibold text-ink">{cell.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <CohortStrip
                subjectName={institutionName}
                subject={cohort.subject}
                peers={stripPeers}
                p25={cohort.p25}
                median={cohort.median}
                p75={cohort.p75}
                quarter={quarter}
                sourceName={SOURCE_NAMES[cohort.source]}
                measureName={terms.amount}
                yearToDate={yearToDate}
              />
            </div>
            <Provenance rows={cohortRows} />
          </>
        ) : (
          <p className="mt-2 text-[14px] text-ink-muted">Insufficient sample: fewer than {MIN_COHORT_PEERS} peers of its size reported a share.</p>
        )}
      </div>

      {children}
    </section>
  );
}
