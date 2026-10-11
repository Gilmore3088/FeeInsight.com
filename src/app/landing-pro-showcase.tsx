import { getNationalIndexCached } from "@/lib/data-store/fee-index";
import { getFeeChangeEvents } from "@/lib/data-store/fee-changes";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { categoryLabel } from "@/lib/regulatory/wire-fee-links";
import { BenchmarkPreview, type BenchmarkRow } from "@/app/subscribe/benchmark-preview";
import { AnalyzeDemo, type AnalyzeScenario } from "@/app/subscribe/analyze-demo";
import { MonitorPreview, ReportPreview, type MonitorChange } from "@/app/subscribe/example-panels";
import { ShowcaseProvider, ShowcaseStage } from "@/app/subscribe/showcase";

const BENCHMARK_FEES: { category: string; label: string }[] = [
  { category: "overdraft", label: "Overdraft" },
  { category: "nsf", label: "NSF / returned item" },
  { category: "monthly_maintenance", label: "Monthly maintenance" },
  { category: "stop_payment", label: "Stop payment" },
  { category: "wire_domestic_outgoing", label: "Domestic wire, outgoing" },
];

function benchmarkRows(
  national: Awaited<ReturnType<typeof getNationalIndexCached>>,
): BenchmarkRow[] {
  return BENCHMARK_FEES.flatMap(({ category, label }) => {
    const entry = national.find(
      (e) =>
        e.fee_category === category &&
        e.median_amount !== null &&
        e.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN,
    );
    if (!entry || entry.median_amount === null) return [];
    return [{
      category,
      label,
      median: Number(entry.median_amount),
      p25: entry.p25_amount === null ? null : Number(entry.p25_amount),
      p75: entry.p75_amount === null ? null : Number(entry.p75_amount),
      institutions: entry.institution_count,
      value: null,
      position: null,
    }];
  }).slice(0, 5);
}

function analyzeScenario(
  national: Awaited<ReturnType<typeof getNationalIndexCached>>,
): AnalyzeScenario | null {
  const entry = national.find((e) => e.fee_category === "overdraft");
  if (
    !entry ||
    entry.median_amount === null ||
    entry.institution_count < MIN_INSTITUTIONS_FOR_MEDIAN
  ) return null;

  const median = Number(entry.median_amount);
  if (!(median > 0)) return null;

  return {
    feeLabel: "Overdraft",
    price: median >= 10 ? Math.round(median) - 5 : Math.round(median * 80) / 100,
    median,
    p25: entry.p25_amount === null ? null : Number(entry.p25_amount),
    p75: entry.p75_amount === null ? null : Number(entry.p75_amount),
    institutions: entry.institution_count,
  };
}

async function monitorChanges(): Promise<MonitorChange[]> {
  const events = await getFeeChangeEvents({ limit: 3 }).catch(() => []);
  return events.map((event) => ({
    id: event.id,
    institution: event.institution_name,
    feeLabel: categoryLabel(event.fee_category),
    oldAmount: event.old_amount,
    newAmount: event.new_amount,
    changedAt: event.changed_at,
  }));
}

/**
 * The established four-value example carousel from the Pro/pricing experience,
 * reused in the public homepage hero so the product demonstrates itself.
 */
export async function LandingProShowcase({
  totalInstitutions,
}: {
  totalInstitutions: number;
}) {
  const [national, changes] = await Promise.all([
    getNationalIndexCached().catch(() => []),
    monitorChanges(),
  ]);

  const rows = benchmarkRows(national);
  const scenario = analyzeScenario(national);

  if (rows.length === 0 || !scenario) return <ReportPreview />;

  return (
    <ShowcaseProvider autoCycle entry="homepage">
      <ShowcaseStage
        panels={[
          <BenchmarkPreview
            key="benchmark"
            institution={null}
            rows={rows}
            totalInstitutions={totalInstitutions}
          />,
          <AnalyzeDemo key="analyze" scenario={scenario} />,
          <MonitorPreview key="monitor" changes={changes} wire={null} />,
          <ReportPreview key="report" />,
        ]}
      />
    </ShowcaseProvider>
  );
}
