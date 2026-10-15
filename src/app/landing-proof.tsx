import { StatCard } from "@/brand/components";
import { COVERAGE_LABELS, UNAVAILABLE_LABEL, type PublicStatsSummary } from "@/lib/public-stats";

type ProofSummary = Pick<
  PublicStatsSummary,
  "institutionsLabel" | "observationsLabel" | "statesLabel" | "refreshedOn"
>;

/** Brief 04 Direction A §2: four live counts from getPublicSnapshot().summary, no deltas, no brick. */
export function LandingProof({ summary }: { summary: ProofSummary }) {
  const cards = [
    { label: COVERAGE_LABELS.institutions, value: summary.institutionsLabel },
    { label: COVERAGE_LABELS.observations, value: summary.observationsLabel },
    { label: "States covered", value: summary.statesLabel },
    { label: "Data refreshed", value: summary.refreshedOn ?? UNAVAILABLE_LABEL },
  ];
  return (
    <section aria-label="Bank Fee Index coverage" className="border-b border-border bg-surface-200/50">
      <div className="mx-auto grid max-w-6xl gap-3 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            className="min-w-0 [&_.fi-stat-value]:text-[28px] [&_.fi-stat-value]:leading-9"
          />
        ))}
      </div>
    </section>
  );
}
