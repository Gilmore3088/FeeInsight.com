import Link from "next/link";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { PAGE_HEADER } from "@/components/public/page-header";

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
  /** The free district report's request form. */
  reportHref: string;
}

export function DistrictHero({ district, name, figures, freshnessLabel, reportHref }: DistrictHeroProps) {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto grid max-w-page gap-6 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10">
        <div className={PAGE_HEADER}>
          <nav aria-label="Breadcrumb" className="flex items-center justify-center gap-2 text-[12px] text-paper/60 sm:justify-start print:hidden">
            <Link href="/research" className="hover:text-white">Research</Link>
            <span aria-hidden="true">/</span>
            <span className="text-paper/85">District {district}</span>
          </nav>
          <h1 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[44px]">
            {name} Fed district bank &amp; credit union fees
          </h1>
          <p className="mx-auto mt-2 max-w-[34rem] text-[15px] text-paper/75 sm:mx-0 sm:max-w-none">Federal Reserve District {district}, against the U.S.</p>

          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 text-left">
            {figures.map((f) => (
              <div key={f.label} className="bg-ink px-4 py-3">
                <dt className="text-[12px] text-paper/65">{f.label}</dt>
                <dd className="font-mono text-[26px] font-semibold leading-tight tabular-nums text-white">{f.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-paper/70 sm:justify-start">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
              {freshnessLabel}
            </span>
            <Link href={reportHref} className="font-semibold text-[#e0716a] hover:text-white print:hidden">
              Get the free district report
            </Link>
          </p>
        </div>
        <div className="-mx-1 hidden sm:block lg:mx-0">
          <DistrictMap district={district} tone="dark" />
        </div>
      </div>
    </section>
  );
}

/**
 * The map the state picker sits on: the district's states drawn as pickable shapes (data-state),
 * the rest of the country muted. The picker reads the tap; the state chips are the same choice
 * for keyboard and screen reader users.
 */
export function PickMap({ district }: { district: number }) {
  return (
    <svg viewBox="0 0 960 600" className="h-auto w-full">
      {US_STATES.map((s) => {
        const inDistrict = STATE_TO_DISTRICT[s.id] === district && STATE_NAMES[s.id];
        return inDistrict ? (
          <g key={s.id} data-state={s.id}>
            <title>{STATE_NAMES[s.id]}</title>
            <path d={s.d} className="fill-[#e8b4ae] stroke-[#fbf7f1] transition-colors hover:fill-[#d98b83]" strokeWidth={1.2} />
          </g>
        ) : (
          <path key={s.id} d={s.d} className="fill-[#ece4d8] stroke-[#fbf7f1]" strokeWidth={1.2} />
        );
      })}
    </svg>
  );
}
