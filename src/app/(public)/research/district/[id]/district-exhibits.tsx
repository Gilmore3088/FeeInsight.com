import Link from "next/link";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { PrintButton } from "../../print-button";

/**
 * The country with the district's states lit. Each lit state links to its own report; the map
 * is a picture to screen readers, and the states section below lists the same links as text.
 */
function DistrictMap({ district, tone }: { district: number; tone: "dark" | "light" }) {
  const lit = tone === "dark" ? "fill-[#e0716a] hover:fill-[#ea8f88]" : "fill-brick hover:fill-brick-ink";
  const rest = tone === "dark" ? "fill-white/[0.12]" : "fill-[#ece4d8]";
  const stroke = tone === "dark" ? "stroke-ink" : "stroke-[#fbf7f1]";
  return (
    <svg viewBox="0 0 960 600" className="h-auto w-full" aria-hidden="true">
      {US_STATES.map((s) => {
        const inDistrict = STATE_TO_DISTRICT[s.id] === district && STATE_NAMES[s.id];
        const path = <path d={s.d} className={`${inDistrict ? lit : rest} ${stroke} transition-colors`} strokeWidth={1.2} />;
        return inDistrict ? (
          <Link key={s.id} href={`/research/state/${s.id}`} tabIndex={-1} prefetch={false}>
            <title>{STATE_NAMES[s.id]}</title>
            {path}
          </Link>
        ) : (
          <g key={s.id}>{path}</g>
        );
      })}
    </svg>
  );
}

interface DistrictHeroProps {
  district: number;
  name: string;
  figures: { value: string; label: string }[];
  freshnessLabel: string;
}

export function DistrictHero({ district, name, figures, freshnessLabel }: DistrictHeroProps) {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto grid max-w-page gap-6 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-paper/60 print:hidden">
            <Link href="/research" className="hover:text-white">Research</Link>
            <span aria-hidden="true">/</span>
            <span className="text-paper/85">District {district}</span>
          </nav>
          <h1 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[44px]">
            {name} Fed district bank &amp; credit union fees
          </h1>
          <p className="mt-2 text-[15px] text-paper/75">Federal Reserve District {district}, against the U.S.</p>

          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10">
            {figures.map((f) => (
              <div key={f.label} className="bg-ink px-4 py-3">
                <dt className="text-[12px] text-paper/65">{f.label}</dt>
                <dd className="font-mono text-[26px] font-semibold leading-tight tabular-nums text-white">{f.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-paper/70">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
              {freshnessLabel}
            </span>
            <PrintButton className="font-semibold text-paper/80 underline decoration-white/30 underline-offset-4 hover:text-white print:hidden" />
          </p>
        </div>
        <div className="-mx-1 lg:mx-0">
          <DistrictMap district={district} tone="dark" />
        </div>
      </div>
    </section>
  );
}

/** The district's states: the map again, each state a tap away, with the same links as text. */
export function DistrictStates({ district, states }: { district: number; states: string[] }) {
  return (
    <div className="grid gap-4 rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
      <DistrictMap district={district} tone="light" />
      <ul className="grid grid-cols-2 gap-2">
        {states.map((code) => (
          <li key={code}>
            <Link
              href={`/research/state/${code}`}
              className="flex min-h-11 items-center justify-between rounded-lg border border-border px-3 text-[14px] font-medium text-ink transition-colors hover:border-ink/30"
            >
              {STATE_NAMES[code]}
              <span aria-hidden="true" className="text-ink-muted">&rarr;</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
