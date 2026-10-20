import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { SHARE_BANDS, shareBand, type StateRow } from "./directory-view";

const COUNT = new Intl.NumberFormat("en-US");

function stateLabel(name: string, row: StateRow | undefined): string {
  if (!row) return `${name}: no institutions in the index`;
  return `${name}: ${COUNT.format(row.published)} of ${COUNT.format(row.monitored)} with published fees`;
}

/**
 * Every state shaded by the share of its institutions with published fees. Each state links
 * straight to its institutions. Server-rendered with no client script; phones get the state
 * dropdown and the ranked list instead.
 */
export function StateDirectoryMap({
  rows,
  bands,
  hrefFor,
}: {
  rows: StateRow[];
  /** The band indexes some state falls in, for the key. */
  bands: number[];
  hrefFor: (code: string) => string;
}) {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return (
    <figure className="min-w-0">
      <svg viewBox="0 0 960 600" className="h-auto w-full" role="group" aria-label="Map of U.S. states, shaded by the share of institutions with published fees">
        {US_STATES.map((state) => {
          const row = byCode.get(state.id);
          const label = stateLabel(state.name, row);
          const fill = SHARE_BANDS[row ? shareBand(row.share) : 0].fill;
          if (!row) {
            return (
              <path key={state.id} d={state.d} style={{ fill, stroke: "var(--fi-surface-0)" }} strokeWidth={1.2}>
                <title>{label}</title>
              </path>
            );
          }
          return (
            // Out of the tab order: keyboard users reach every state through the list below the map.
            <Link key={state.id} href={hrefFor(state.id)} prefetch={false} tabIndex={-1} aria-label={label} className="group outline-none">
              <path
                d={state.d}
                style={{ fill }}
                strokeWidth={1.2}
                className="cursor-pointer [stroke:var(--fi-surface-0)] transition-[stroke,stroke-width] duration-150 group-hover:[stroke:var(--fi-ink)] group-hover:[stroke-width:2.4]"
              >
                <title>{label}</title>
              </path>
            </Link>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-muted">
        <span>Share with published fees:</span>
        {bands.map((i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-border" style={{ background: SHARE_BANDS[i].fill }} aria-hidden="true" />
            {SHARE_BANDS[i].label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
