import { COVERAGE_LABELS, UNAVAILABLE_LABEL, type PublicStatsSummary } from "@/lib/public-stats";
import { CONTAINER } from "./look";

/**
 * Pages in public/reports/sample-competitive-fee-position.pdf. sample-report-pages.test.ts
 * reads the PDF and fails when this number stops matching it.
 */
export const SAMPLE_REPORT_PAGE_COUNT = 10;

interface HomeStatsProps {
  summary: PublicStatsSummary;
}

/**
 * Four numbers from the shared public snapshot, each in Geist Mono. A count whose read
 * failed shows the unavailable mark, never a zero; the refresh date shows the same mark
 * when no date is known.
 */
export function HomeStats({ summary }: HomeStatsProps) {
  const stats = [
    { value: summary.institutionsLabel, label: COVERAGE_LABELS.institutions },
    { value: summary.categoriesLabel, label: COVERAGE_LABELS.categories },
    { value: String(SAMPLE_REPORT_PAGE_COUNT), label: "Pages in the sample report" },
    { value: summary.refreshedOn ?? UNAVAILABLE_LABEL, label: "Last data refresh" },
  ];
  return (
    <section aria-label="Coverage" className="border-y border-index-line bg-index-cloud">
      <dl className={`${CONTAINER} grid grid-cols-2 gap-x-6 gap-y-8 py-10 sm:py-12 lg:grid-cols-4`}>
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dd className="font-mono text-[1.75rem] font-medium leading-none tracking-[-0.02em] text-index-navy tabular-nums sm:text-[2.25rem]">
              {stat.value}
            </dd>
            <dt className="mt-2 text-[14px] text-index-muted">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
