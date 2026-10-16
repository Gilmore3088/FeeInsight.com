import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { PRODUCT_NAME } from "@/lib/constants";
import type { ActionLink, CoverageBar as CoverageBarData, DataSource, MapFigure, SourceMap as SourceMapData } from "./data-sources-view";

const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
const MONO = { fontFamily: "var(--fi-font-mono)" } as const;

/** Dark band: what the page is and how fresh the data is. */
export function DataSourcesHero({ freshnessLabel }: { freshnessLabel: string | null }) {
  return (
    <section className="fi-on-navy bg-ink text-paper">
      <div className="mx-auto max-w-page px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0716a]">
          <span aria-hidden="true" className="h-px w-8 bg-[#e0716a]/60" />
          Data sources
        </p>
        <h1 className="mt-3 max-w-3xl text-[2rem] font-extrabold leading-[1.08] tracking-[-0.015em] text-white sm:text-[3rem]" style={SANS}>
          Where every number comes from
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-paper/80 sm:text-base">
          Fees in the {PRODUCT_NAME} come from each institution&apos;s own schedule. Public agency data sets the list
          we track and adds context.
        </p>
        {freshnessLabel && (
          <p className="mt-5 inline-flex items-center gap-2 text-[12px] text-paper/75">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
            {freshnessLabel}
          </p>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">{eyebrow}</p>
      <h2 id={id} className="mt-1.5 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]" style={SANS}>
        {title}
      </h2>
    </div>
  );
}

/** A stored document, drawn. Decoration only, carries no data. */
function DocumentGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 48" className="h-12 w-10 shrink-0 text-ink">
      <path d="M4 2h22l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M26 2v10h10" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      {[18, 24, 30, 36].map((y) => (
        <g key={y}>
          <rect x="7" y={y} width="16" height="2.5" rx="1" fill="currentColor" opacity="0.25" />
          <rect x="27" y={y} width="6" height="2.5" rx="1" fill="#b23a32" opacity="0.55" />
        </g>
      ))}
    </svg>
  );
}

function Figure({ figure, large = false }: { figure: MapFigure; large?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={`font-semibold leading-none tabular-nums text-ink ${large ? "text-[1.5rem] sm:text-[1.75rem]" : "text-[15px]"}`}
        style={MONO}
      >
        {figure.value}
      </span>
      <span className="text-[12px] text-ink-muted">{figure.label}</span>
    </span>
  );
}

/**
 * Banks and credit unions on our list against institutions with published fees, drawn on one
 * scale with the real counts. Rendered only when all three reads worked.
 */
export function CoverageBar({ bar }: { bar: CoverageBarData }) {
  return (
    <div className="rounded-2xl border border-border bg-white px-4 py-4 sm:px-5" data-exhibit="coverage">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Coverage</p>
      <p className="mt-1 text-[14px] font-semibold text-ink">{bar.summary}</p>
      <div className="mt-3 space-y-3">
        <div>
          <div
            role="img"
            aria-label={`On our list: ${bar.banks.value} banks and ${bar.creditUnions.value} credit unions`}
            className="flex h-4 w-full overflow-hidden rounded-full bg-paper"
          >
            <span className="block h-full bg-ink" style={{ width: `${bar.banks.pct}%` }} />
            <span className="block h-full bg-ink/45" style={{ width: `${bar.creditUnions.pct}%` }} />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-ink" />
              <span className="font-semibold tabular-nums text-ink" style={MONO}>{bar.banks.value}</span> banks on our list
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-ink/45" />
              <span className="font-semibold tabular-nums text-ink" style={MONO}>{bar.creditUnions.value}</span> credit unions on our list
            </span>
          </p>
        </div>
        <div>
          <div
            role="img"
            aria-label={`${bar.withFees.value} institutions with published fees, ${bar.withFees.pct}% of the list`}
            className="h-4 w-full overflow-hidden rounded-full bg-paper"
          >
            <span className="block h-full rounded-full bg-brick" style={{ width: `${bar.withFees.pct}%` }} />
          </div>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-ink-muted" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-sm bg-brick" />
            <span className="font-semibold tabular-nums text-ink" style={MONO}>{bar.withFees.value}</span> institutions with published fees
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The exhibit: the fee schedules as the primary source, with the four groups of public data
 * that support them. Each node jumps to its row in the table. Only live counts are drawn.
 */
export function SourceMap({ map, coverage }: { map: SourceMapData; coverage: CoverageBarData | null }) {
  return (
    <section aria-labelledby="map-heading" id="map" className="scroll-mt-24">
      <SectionTitle id="map-heading" eyebrow="Source map" title="One primary source, and the data around it" />

      <figure className="mt-5">
        <a
          href={`#${map.primary.id}`}
          className="flex min-h-11 items-center gap-4 rounded-2xl border border-brick/40 bg-white px-4 py-4 shadow-fi-1 hover:border-brick sm:px-5"
          data-node={map.primary.id}
        >
          <DocumentGlyph />
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">Primary source</span>
            <span className="mt-0.5 block text-[17px] font-bold text-ink" style={SANS}>{map.primary.name}</span>
            <span className="block text-[13px] text-ink-muted">{map.primary.publisher}</span>
            {map.primary.figures.length > 0 && (
              <span className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {map.primary.figures.map((f) => (
                  <Figure key={f.label} figure={f} large />
                ))}
              </span>
            )}
          </span>
        </a>

        {coverage && (
          <div className="mt-3">
            <CoverageBar bar={coverage} />
          </div>
        )}

        {/* The trunk joins the primary source to the groups beneath it. */}
        <span aria-hidden="true" className="mx-auto block h-5 w-px bg-brick/40" />

        <ul className="grid grid-cols-2 gap-3 border-t border-brick/30 pt-4 lg:grid-cols-5" aria-label="Supporting sources">
          {map.groups.map((group) => (
            <li
              key={group.key}
              className={`rounded-2xl border border-border bg-white px-3 py-3 sm:px-4 ${group.wide ? "col-span-2 lg:col-span-1" : ""}`}
              data-group={group.key}
            >
              <h3 className="text-[15px] font-bold text-ink" style={SANS}>{group.title}</h3>
              <p className="text-[12px] text-ink-muted">{group.role}</p>
              <ul className={`mt-2 grid gap-1 ${group.wide && group.nodes.length > 1 ? "grid-cols-2 lg:grid-cols-1" : ""}`}>
                {group.nodes.map((node) => (
                  <li key={node.id}>
                    <a
                      href={`#${node.id}`}
                      className="flex min-h-11 flex-col justify-center rounded-lg px-2 py-1.5 -mx-2 hover:bg-paper"
                      data-node={node.id}
                    >
                      <span className="text-[13px] font-semibold leading-snug text-ink">{node.name}</span>
                      {node.figure && <Figure figure={node.figure} />}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <figcaption className="mt-3 text-[12px] text-ink-muted">
          Counts update with each publish.
        </figcaption>
      </figure>
    </section>
  );
}

/** Source by source: what we take, how often our copy refreshes, and the source's own site. */
export function SourceTable({ sources }: { sources: readonly DataSource[] }) {
  return (
    <section aria-labelledby="table-heading" id="sources" className="scroll-mt-24">
      <SectionTitle id="table-heading" eyebrow="Source by source" title="What we take from each" />
      <table className="mt-5 block w-full text-left sm:table">
        <caption className="sr-only">Data sources, what we take from each, how often it refreshes, and its site</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            <th scope="col" className="py-2 pr-4">Source</th>
            <th scope="col" className="py-2 pr-4">What we take</th>
            <th scope="col" className="py-2 pr-4">Refreshed</th>
            <th scope="col" className="py-2">Site</th>
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {sources.map((s) => (
            <tr key={s.id} id={s.id} className="block scroll-mt-24 border-b border-border py-3 sm:table-row sm:py-0">
              <th scope="row" className="block font-normal sm:table-cell sm:py-3 sm:pr-4 sm:align-top">
                <span className="block text-[15px] font-semibold text-ink">{s.name}</span>
                <span className="block text-[12px] text-ink-muted">{s.publisher}</span>
              </th>
              <td className="mt-1 block text-[14px] leading-relaxed text-ink-soft sm:mt-0 sm:table-cell sm:py-3 sm:pr-4 sm:align-top">
                {s.takes}
              </td>
              <td className="mr-4 inline-block text-[13px] font-medium text-ink sm:table-cell sm:py-3 sm:pr-4 sm:align-top" data-cell="refresh">
                {s.refresh && (
                  <>
                    <span className="sm:hidden">Refreshed: </span>
                    {s.refresh}
                  </>
                )}
              </td>
              <td className="inline-block text-[13px] sm:table-cell sm:py-1 sm:align-top">
                {s.href ? (
                  <a
                    href={s.href}
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    Visit<span className="sr-only"> {s.name}</span>
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center text-ink-muted">Each institution&apos;s site</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** One line to the methodology. */
export function MethodologyLine() {
  return (
    <p className="text-[14px] text-ink-soft">
      How each fee is read, checked and published:{" "}
      <Link
        href="/methodology"
        className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
      >
        read the methodology
      </Link>
    </p>
  );
}

/** The one next action: the sample report when it is live, else the report request; a demo second. */
export function NextAction({ action }: { action: ActionLink }) {
  return (
    <section aria-labelledby="next-heading" id="next" className="fi-on-navy scroll-mt-24 rounded-2xl bg-ink px-5 py-6 text-paper sm:px-8 sm:py-8">
      <h2 id="next-heading" className="text-[1.4rem] font-bold leading-tight text-white sm:text-[1.75rem]" style={SANS}>
        See these sources at work on one institution
      </h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-paper/80">
        Its fees set against its market, each line traced to the schedule.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <TrackLink
          event={action.event}
          eventProps={{ placement: "data_sources" }}
          href={action.href}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brick px-6 text-[14px] font-semibold text-white hover:bg-brick-ink"
        >
          {action.label}
        </TrackLink>
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "data_sources_demo" }}
          href={DEMO_REQUEST_NAV.href}
          className="inline-flex min-h-11 items-center justify-center text-[14px] font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          {DEMO_REQUEST_NAV.label}
        </TrackLink>
      </div>
    </section>
  );
}
