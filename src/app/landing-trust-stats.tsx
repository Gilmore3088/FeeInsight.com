import Link from "next/link";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { COVERAGE_LABELS, type PublicStatsSummary } from "@/lib/public-stats";
import { US_STATES } from "@/lib/us-map-paths";
import { GLASS, H2 } from "@/components/public/site-look";

interface LandingTrustStatsProps {
  summary: PublicStatsSummary;
  /** Per-state counts for the coverage map; an empty list hides the map. */
  states: InstitutionStateDirectorySummary[];
}

const STATE_NAME = new Map(US_STATES.map((state) => [state.id, state.name]));

const SOURCES = ["FDIC", "NCUA", "Federal Reserve", "Published fee schedules"];


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
 * Coverage band: a US map shaded by institutions with published fees per state, two headline
 * numbers, and provenance as small tags. The map does the talking.
 */
export function LandingTrustStats({ summary, states }: LandingTrustStatsProps) {
  const byState = new Map(states.map((s) => [s.state_code, s]));
  const maxVerified = Math.max(...states.map((s) => s.verified_institution_count), 1);
  const topStates = [...states]
    .filter((s) => s.verified_institution_count > 0)
    .sort((a, b) => b.verified_institution_count - a.verified_institution_count)
    .slice(0, 5);

  return (
    <section aria-labelledby="where-we-track">
      <div className="mx-auto max-w-page px-4 py-12 sm:px-6 sm:py-16">
        <h2 id="where-we-track" className={H2}>
          Where we track fees
        </h2>
        {/* Desktop: the map, and beside it one glass panel with the counts, the busiest states,
            the state picker and the sources. */}
        <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-center xl:gap-14">
          <div className="min-w-0">
            {states.length > 0 && (
              <p className="text-sm text-warm-700">
                Darker states have more institutions with published fees.{" "}
                <span className="font-semibold text-warm-900">
                  Tap a state to see its banks and credit unions.
                </span>
              </p>
            )}
            {states.length > 0 && (
              <>
                <svg
                  viewBox="0 0 960 600"
                  className="mx-auto mt-4 h-auto w-full max-w-[920px]"
                  role="group"
                  aria-label={`Map of U.S. states shaded by institutions with published fees; ${summary.statesLabel} states covered`}
                >
                  {US_STATES.map((state) => {
                    const verified = byState.get(state.id)?.verified_institution_count ?? 0;
                    const label = `${state.name}: ${verified.toLocaleString("en-US")} ${verified === 1 ? "institution" : "institutions"} with published fees`;
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
                  <span>More published</span>
                </div>
              </>
            )}
          </div>

          <div className={`min-w-0 p-5 sm:p-7 ${GLASS}`}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <dd className="text-3xl font-bold [font-variant-numeric:tabular-nums] tracking-tight text-warm-900 sm:text-4xl">
                {summary.institutionsLabel}
              </dd>
              <dt className="mt-1 text-[12px] text-warm-600">{COVERAGE_LABELS.institutions}</dt>
            </div>
            <div>
              <dd className="text-3xl font-bold [font-variant-numeric:tabular-nums] tracking-tight text-warm-900 sm:text-4xl">
                {summary.categoriesLabel}
              </dd>
              <dt className="mt-1 text-[12px] text-warm-600">{COVERAGE_LABELS.categories}</dt>
            </div>
            {topStates.length > 0 && (
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-warm-600">Most coverage</dt>
                <dd className="mt-1.5">
                  <ul className="space-y-1">
                    {topStates.map((s) => (
                      <li key={s.state_code}>
                        <Link
                          href={`/institutions?state=${s.state_code}`}
                          prefetch={false}
                          className="flex min-h-9 items-center justify-between gap-3 text-sm text-warm-900 hover:text-terra-dark"
                        >
                          <span>{STATE_NAME.get(s.state_code) ?? s.state_code}</span>
                          <span className="[font-variant-numeric:tabular-nums] text-warm-600">
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
          {/* Every state the map links to, as a list control: the same route for keyboard
              and screen-reader users, and for anyone who can't pick a small state by tap. */}
          <form action="/institutions" method="get" className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#E8E1D6] pt-5">
            <label htmlFor="landing-state-pick" className="w-full text-sm font-semibold text-warm-900">
              Pick a state
            </label>
            <select
              id="landing-state-pick"
              name="state"
              defaultValue=""
              required
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-warm-300 bg-white px-3 text-sm text-warm-900"
            >
              <option value="" disabled>
                Choose…
              </option>
              {[...US_STATES]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              className="min-h-11 cursor-pointer rounded-lg bg-terra px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-terra-dark"
            >
              View
            </button>
          </form>
          </div>
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
