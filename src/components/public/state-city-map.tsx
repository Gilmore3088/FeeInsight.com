import Link from "next/link";
import type { StateMarketMap } from "@/lib/geo/state-market-map";

/**
 * One state outline with a marker per city, from US Census outlines (us-atlas) and the middle of
 * each city's branch coordinates (FDIC Summary of Deposits, NCUA). Marker size shows how many
 * banks and credit unions have a branch there; the selected city shows by weight and an outline, and
 * no color stands for a price.
 * The state page's local markets and the city directory's explorer both draw this map.
 */

export interface CityMarker {
  key: string;
  name: string;
  /** Banks and credit unions with a branch in the city. */
  institutions: number;
  /** Of those, the ones with published fees. */
  withFees: number;
  /** A link that selects the city without scripts (for example `?city=orlando`). */
  selectHref?: string;
}

const COUNT = new Intl.NumberFormat("en-US");

export function markerTitle(m: CityMarker): string {
  return `${m.name}: ${COUNT.format(m.withFees)} of ${COUNT.format(m.institutions)} institutions have published fees`;
}

export function StateCityMap({
  map,
  markers,
  selected,
  onSelect,
  dimmed,
  label,
  focusable = true,
}: {
  map: StateMarketMap;
  markers: CityMarker[];
  selected: string | null;
  onSelect?: (key: string) => void;
  /** Markers drawn faint, such as those a search does not match. */
  dimmed?: ReadonlySet<string>;
  label: string;
  /**
   * False when another control (a city menu, a list of links) offers the same choices: the
   * markers then stay out of the tab order, so a keyboard does not walk hundreds of dots.
   */
  focusable?: boolean;
}) {
  const box = map.viewBox.split(" ").map(Number);
  const unit = Math.max(box[2], box[3]) / 100;
  const byKey = new Map(markers.map((m) => [m.key, m]));
  const biggest = Math.max(1, ...markers.map((m) => m.institutions));
  // Area grows with the count; a state with hundreds of towns gets smaller dots so they stay apart.
  const scale = markers.length > 40 ? 1.9 : 2.4;
  const radius = (n: number) => unit * (0.45 + scale * Math.sqrt(n / biggest));
  // Largest first so small towns stay visible on top; the selected city is drawn last.
  const order = map.points
    .filter((p) => byKey.has(p.key))
    .sort((a, b) => {
      if (a.key === selected) return 1;
      if (b.key === selected) return -1;
      return byKey.get(b.key)!.institutions - byKey.get(a.key)!.institutions;
    });

  // Few markers (a state page's largest markets) get generous hit areas; hundreds stay tight.
  const hit = (r: number) => Math.max(r, unit * (markers.length > 40 ? 1.4 : 3.2));

  // Neutral surfaces only: the outline carries no price meaning, and selection shows by weight and outline.
  return (
    <svg viewBox={map.viewBox} className="h-auto w-full" role="group" aria-label={label}>
      {map.neighbors.map((d, i) => (
        <path key={i} d={d} className="fill-surface-200 stroke-paper" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={map.state} className="fill-surface-0 stroke-border" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {order.map((pt) => {
        const m = byKey.get(pt.key)!;
        const on = pt.key === selected;
        const faint = !on && dimmed?.has(pt.key);
        const r = radius(m.institutions);
        // Only the selected city is named; the label sits on the side away from the nearer edge.
        const leftSide = pt.x > box[0] + box[2] * 0.6;
        const title = markerTitle(m);
        const labelGap = on ? unit * 1.6 : unit * 0.8;
        const dot = (
          <>
            {/* A wider invisible ring so a small town is still easy to hit with a pointer. */}
            <circle cx={pt.x} cy={pt.y} r={hit(r)} className="fill-transparent" />
            <circle
              cx={pt.x}
              cy={pt.y}
              r={r}
              className={on ? "fill-ink stroke-paper" : faint ? "fill-surface-200 stroke-paper" : "fill-ink-muted stroke-paper group-hover:fill-ink-soft"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {on && (
              <circle cx={pt.x} cy={pt.y} r={r + unit * 0.7} className="fill-none stroke-ink" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            )}
            {/* Keyboard focus: a 3px ring outside the dot and any selection ring, in every state. */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={r + unit * 1.5}
              className="pointer-events-none fill-none stroke-ink opacity-0 group-focus-visible:opacity-100"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <title>{title}</title>
            {on && (
              <text
                x={leftSide ? pt.x - r - labelGap : pt.x + r + labelGap}
                textAnchor={leftSide ? "end" : "start"}
                y={pt.y + unit * 1.1}
                fontSize={unit * 4}
                fontWeight={700}
                className="pointer-events-none fill-ink stroke-paper"
                strokeWidth={unit * 0.6}
                paintOrder="stroke"
              >
                {m.name}
              </text>
            )}
          </>
        );
        const common = "group cursor-pointer focus:outline-none";
        // Markers another control duplicates stay out of the tab order and the accessibility tree.
        const hidden = focusable ? {} : { "aria-hidden": true as const, tabIndex: -1 };
        if (m.selectHref) {
          return (
            // A plain anchor: a next/link here would prefetch a URL per marker.
            <a
              key={pt.key}
              href={m.selectHref}
              rel="nofollow"
              aria-label={title}
              aria-current={on ? "true" : undefined}
              {...hidden}
              onClick={(e) => {
                if (!onSelect) return;
                e.preventDefault();
                onSelect(pt.key);
              }}
              className={common}
            >
              {dot}
            </a>
          );
        }
        return (
          <g
            key={pt.key}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={title}
            {...hidden}
            onClick={() => onSelect?.(pt.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(pt.key);
              }
            }}
            className={common}
          >
            {dot}
          </g>
        );
      })}
    </svg>
  );
}

/** The selected city: its name, how many of its institutions publish fees, and the way into its page. */
export function CityCoverage({
  marker,
  href,
  headingLevel = 2,
  onMap = true,
}: {
  marker: CityMarker;
  href: string;
  headingLevel?: 2 | 3;
  /** False when the city has no branch coordinates and so no marker. */
  onMap?: boolean;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const share = marker.institutions > 0 ? marker.withFees / marker.institutions : 0;
  return (
    <div className="rounded-2xl border border-border bg-surface-0 p-5 sm:p-6">
      <Heading className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">{marker.name}</Heading>
      <p className="mt-1 text-[15px] text-ink-soft sm:mx-0">
        <span className="font-semibold tabular-nums text-ink">{COUNT.format(marker.withFees)}</span> of{" "}
        <span className="tabular-nums">{COUNT.format(marker.institutions)}</span> institutions have published fees
      </p>
      <div className="mt-3 h-2.5 rounded-sm bg-surface-200" aria-hidden="true">
        <div className="h-2.5 rounded-sm bg-ink/60" style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      {!onMap && <p className="mt-2 text-[12px] text-ink-muted sm:mx-0">Its branch records carry no map coordinates, so it has no marker.</p>}
      <Link
        href={href}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-on-ink hover:bg-ink/90"
      >
        Compare {marker.name} fees
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}
