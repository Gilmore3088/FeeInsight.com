import Link from "next/link";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { US_STATES } from "@/lib/us-map-paths";

interface LandingTrustStatsProps {
  summary: PublicStatsSummary;
  /** Per-state counts for the coverage map; an empty list hides the map. */
  states: InstitutionStateDirectorySummary[];
}

const STATE_NAME = new Map(US_STATES.map((state) => [state.id, state.name]));

const SOURCES = ["FDIC", "NCUA", "Federal Reserve", "Published fee schedules"];

const SERIF_STYLE = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

/** Same ramp as the institutions directory map, so coverage reads the same everywhere. */
function coverageFill(verified: number, max: number): string {
  if (verified <= 0) return "#EDE5D8";
  const intensity = verified / max;
  if (intensity > 0.72) return "#C44B2E";
  if (intensity > 0.5) return "#D46F54";
  if (intensity > 0.28) return "#E8A08E";
  if (intensity > 0.12) return "#F4C9BF";
  return "#F8DDD6";
}

/**
 * Coverage band: a US map shaded by verified institutions per state, two headline
 * numbers, and provenance as small tags. The map does the talking.
 */
export function LandingTrustStats({ summary, states }: LandingTrustStatsProps) {
  const byState = new Map(states.map((s) => [s.state_code, s]));
  const maxVerified = Math.max(...states.map((s) => s.verified_institution_count), 1);
  const topStates = [...states]
    .filter((s) => s.verified_institution_count > 0)
    .sort((a, b) => b.verified_institution_count - a.verified_institution_count)
    .slice(0, 3);

  return (
    <section className="border-t border-warm-300 bg-warm-150/60">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center lg:gap-10">
          <div className="min-w-0">
            <h2 className="text-balance text-2xl font-normal text-warm-900 sm:text-3xl" style={SERIF_STYLE}>
              Where we track fees
            </h2>
            {states.length > 0 && (
              <p className="mt-1.5 text-[13px] text-warm-700">
                Darker states have more institutions with verified fees.{" "}
                <span className="font-semibold text-warm-900">
                  Tap a state to see its banks and credit unions.
                </span>
              </p>
            )}
            {states.length > 0 && (
              <>
                <svg
                  viewBox="0 0 960 600"
                  className="mt-4 h-auto w-full"
                  role="img"
                  aria-label={`Map of U.S. states shaded by institutions with verified fees; ${summary.statesLabel} states covered`}
                >
                  {US_STATES.map((state) => {
                    const verified = byState.get(state.id)?.verified_institution_count ?? 0;
                    const label = `${state.name}: ${verified.toLocaleString("en-US")} ${verified === 1 ? "institution" : "institutions"} with verified fees`;
                    return (
                      <Link
                        key={state.id}
                        href={`/institutions?state=${state.id}`}
                        aria-label={label}
                        prefetch={false}
                      >
                        <path
                          d={state.d}
                          fill={coverageFill(verified, maxVerified)}
                          stroke="#FAF7F2"
                          strokeWidth={1.2}
                          className="cursor-pointer transition-[filter] duration-150 hover:brightness-90"
                        >
                          <title>{label}</title>
                        </path>
                      </Link>
                    );
                  })}
                </svg>
                <div
                  aria-hidden="true"
                  className="mt-2 flex items-center justify-center gap-2 text-[11px] text-warm-600"
                >
                  <span>Fewer</span>
                  <span className="flex">
                    {["#F8DDD6", "#F4C9BF", "#E8A08E", "#D46F54", "#C44B2E"].map((c) => (
                      <span key={c} className="h-2 w-5" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span>More verified</span>
                </div>
              </>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-1 lg:gap-6">
            <div>
              <dd className="text-3xl font-bold tabular-nums text-warm-900 sm:text-4xl">
                {summary.institutionsLabel}
              </dd>
              <dt className="mt-1 text-[12px] text-warm-600">Institutions verified</dt>
            </div>
            <div>
              <dd className="text-3xl font-bold tabular-nums text-warm-900 sm:text-4xl">
                {summary.categoriesLabel}
              </dd>
              <dt className="mt-1 text-[12px] text-warm-600">Fee types tracked</dt>
            </div>
            {topStates.length > 0 && (
              <div className="col-span-2 lg:col-span-1">
                <dt className="text-[12px] text-warm-600">Most coverage</dt>
                <dd className="mt-1.5">
                  <ul className="space-y-1">
                    {topStates.map((s) => (
                      <li key={s.state_code}>
                        <Link
                          href={`/institutions?state=${s.state_code}`}
                          prefetch={false}
                          className="flex items-baseline justify-between gap-3 text-[13px] text-warm-900 hover:text-terra-dark"
                        >
                          <span>{STATE_NAME.get(s.state_code) ?? s.state_code}</span>
                          <span className="tabular-nums text-warm-600">
                            {s.verified_institution_count.toLocaleString("en-US")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Provenance: sources as tags, freshness with a live dot, one methodology link. */}
        <div className="mt-6 flex flex-col gap-3 border-t border-warm-300 pt-5 text-[12px] text-warm-600 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap gap-1.5" aria-label="Data sources">
            {SOURCES.map((source) => (
              <li
                key={source}
                className="rounded-full border border-warm-300 bg-white/60 px-2.5 py-0.5 text-[11px] text-warm-700"
              >
                {source}
              </li>
            ))}
          </ul>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-warm-700">
            {/* Pulse dot acknowledges live data without shouting; hidden under
                prefers-reduced-motion via the live-pulse utility. */}
            <span aria-hidden="true" className="relative inline-flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inset-0 rounded-full bg-terra/40 live-pulse" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-terra" />
            </span>
            <span className="font-medium text-warm-900">{summary.freshnessLabel}</span>
            {" · "}
            <Link href="/methodology" className="text-terra-dark underline-offset-2 hover:underline">
              Methodology
            </Link>
          </span>
        </div>
      </div>
    </section>
  );
}
