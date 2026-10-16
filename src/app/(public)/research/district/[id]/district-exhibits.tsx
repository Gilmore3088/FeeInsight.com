import Link from "next/link";
import { STATE_NAMES } from "@/lib/us-states";
import { allShapes, overlaps, stateShape, unionBox, type Box } from "./district-geo";

/**
 * The region each Fed district covers, in the words a reader would use. The page leads with the
 * region; the Fed's own district name sits above it.
 */
export const DISTRICT_REGIONS: Record<number, string> = {
  1: "New England",
  2: "New York",
  3: "Pennsylvania, New Jersey and Delaware",
  4: "the Ohio Valley",
  5: "the Mid-Atlantic and Carolinas",
  6: "the Southeast",
  7: "the Great Lakes",
  8: "the Mid-South",
  9: "the Upper Midwest",
  10: "the Central Plains",
  11: "Texas",
  12: "the West",
};

const INSETS = new Set(["AK", "HI"]);

/** A state's name fits on the map when its shape is wide enough for it; smaller ones get the code. */
function labelFor(code: string, box: Box, view: Box): string {
  const name = STATE_NAMES[code] ?? code;
  return box.w >= view.w * (0.016 * name.length + 0.03) ? name : code;
}

/**
 * The district drawn on its own: its states lit and named, the neighbors around it faint, so
 * the shape of the region reads at a glance. Each lit state links to its own report; the map is
 * a picture to screen readers, and the state section lists the same states as text.
 */
export function DistrictMap({ states }: { states: string[] }) {
  const view = unionBox(states, 0.05);
  if (!view) return null;
  const lit = new Set(states);
  // Alaska and Hawaii sit in insets on this projection, so they are never a district's neighbors.
  const neighbors = allShapes().filter((s) => !lit.has(s.code) && !INSETS.has(s.code) && overlaps(s.box, view));
  const size = Math.max(view.w, view.h) * 0.032;
  return (
    <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-auto max-h-[460px] w-full" aria-hidden="true">
      {neighbors.map((s) => (
        <path key={s.code} d={s.d} className="fill-[var(--fi-viz-none)] stroke-paper" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {states.map((code) => {
        const s = stateShape(code);
        if (!s) return null;
        return (
          <Link key={code} href={`/research/state/${code}`} tabIndex={-1} prefetch={false}>
            <title>{STATE_NAMES[code]}</title>
            <path
              d={s.d}
              className="fill-[var(--fi-viz-3)] stroke-paper transition-colors hover:fill-[var(--fi-viz-4)]"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </Link>
        );
      })}
      {states.map((code) => {
        const s = stateShape(code);
        if (!s) return null;
        return (
          <text
            key={code}
            x={s.label.x}
            y={s.label.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="pointer-events-none fill-ink font-semibold"
            style={{ fontSize: size }}
          >
            {labelFor(code, s.box, view)}
          </text>
        );
      })}
    </svg>
  );
}

interface DistrictHeroProps {
  district: number;
  name: string;
  states: string[];
  /** At most two figures; the page picks the two that carry the story. */
  facts: { value: string; label: string }[];
  /** One oversized line under the opening: the page's thesis. */
  statement: string | null;
  freshnessLabel: string;
  /** The free district report's request form. */
  reportHref: string;
}

export function DistrictHero({ district, name, states, facts, statement, freshnessLabel, reportHref }: DistrictHeroProps) {
  const region = DISTRICT_REGIONS[district] ?? `the ${name} district`;
  return (
    <section className="bg-paper">
      <div className="mx-auto grid max-w-page gap-8 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-12">
        <div className="text-center sm:text-left">
          <nav aria-label="Breadcrumb" className="flex items-center justify-center gap-2 text-[12px] text-ink-muted sm:justify-start print:hidden">
            <Link href="/research" className="hover:text-ink">
              Research
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink-soft">District {district}</span>
          </nav>
          <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.14em] text-brick sm:mx-0">
            {name} Fed &middot; District {district}
          </p>
          <h1 className="mt-2 text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[56px]">Bank fees in {region}</h1>

          {facts.length > 0 && (
            <dl className="mt-8 grid grid-cols-2 gap-6 text-left sm:max-w-xl">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col-reverse border-l-2 border-brick pl-4">
                  <dt className="mt-2 text-[13px] leading-snug text-ink-soft">{f.label}</dt>
                  <dd className="whitespace-nowrap font-mono text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink sm:text-[44px]">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <p className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-ink-muted sm:mx-0 sm:justify-start">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-in-range" />
              {freshnessLabel}
            </span>
            <Link href={reportHref} className="font-semibold text-brick underline-offset-4 hover:text-brick-ink hover:underline print:hidden">
              Get the free district report
            </Link>
          </p>
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <DistrictMap states={states} />
        </div>
      </div>
      {statement && (
        <div className="mx-auto max-w-page border-t border-border px-4 py-10 sm:px-6 sm:py-14">
          <p className="max-w-4xl text-[28px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink sm:text-[44px]">{statement}</p>
        </div>
      )}
    </section>
  );
}
