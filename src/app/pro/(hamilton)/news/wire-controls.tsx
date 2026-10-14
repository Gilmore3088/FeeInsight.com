import type { ReactNode } from "react";
import Link from "next/link";
import {
  WIRE_RANGES,
  formatWireDate,
  wireHref,
  type PageWindow,
  type WireParams,
} from "@/lib/regulatory/wire";
import { FEE_TYPES } from "@/lib/regulatory/wire-fee-types";

/**
 * The Regulatory Wire's shared controls. Both views render the same bar (search and time
 * range), the same "Showing X–Y of Z" line and the same pager, all plain GET links and
 * forms driven by the URL, so a view works without client JavaScript.
 */

/** Section labels: small uppercase sans. The shell sets h2 in the serif, so h2s say sans. */
export const LABEL = "text-[10px] font-bold uppercase tracking-[0.1em] text-warm-600";
export const SANS = { fontFamily: "var(--hamilton-font-sans)" } as const;

function Hidden({ name, value }: { name: string; value: string | undefined }) {
  return value ? <input type="hidden" name={name} value={value} /> : null;
}

export function WireControls({
  params,
  lead,
  actions,
}: {
  params: WireParams;
  /** Fields shown before the search box inside the same GET form (the States view's jurisdiction). */
  lead?: ReactNode;
  /** Controls after the range (the Federal view's Refresh, for operators). */
  actions?: ReactNode;
}) {
  const states = params.view === "states";
  return (
    // With a lead field (the States view's jurisdiction) the range sits on its own row.
    <div className={`flex flex-col gap-2.5 rounded-xl border border-warm-200 bg-white/70 p-2.5 ${lead ? "" : "lg:flex-row lg:items-center"}`}>
      <form method="get" action="/pro/news" role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
        <Hidden name="view" value={states ? "states" : undefined} />
        <Hidden name="kind" value={states ? params.kind : undefined} />
        <Hidden name="source" value={states ? undefined : params.source} />
        <Hidden name="topic" value={states ? undefined : params.topic} />
        <Hidden name="range" value={params.range} />
        <Hidden name="fee" value={params.fee} />
        {lead}
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
          <label htmlFor="wire-q" className="sr-only">
            Search headlines
          </label>
          <input
            id="wire-q"
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder={states ? "Headline or bill number" : "Search headlines"}
            className="min-w-0 flex-1 rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-[13px] text-warm-900 placeholder:text-warm-600"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-warm-900 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-warm-700"
          >
            Search
          </button>
        </div>
      </form>
      <div className="flex items-center gap-2">
        <nav
          aria-label="Time range"
          className={`grid flex-1 grid-cols-5 overflow-hidden rounded-lg border border-warm-200 bg-white/70 text-[11px] ${lead ? "sm:flex sm:flex-none" : "lg:flex lg:flex-none"}`}
        >
          {WIRE_RANGES.map((r) => {
            const active = params.range === r.key;
            return (
              <Link
                key={r.key}
                href={wireHref(params, { range: r.key, page: 1 })}
                title={r.title}
                aria-current={active ? "true" : undefined}
                className={`whitespace-nowrap px-1.5 py-1.5 text-center font-medium no-underline transition-colors sm:px-3 ${
                  active ? "bg-warm-900 text-white" : "text-warm-600 hover:bg-warm-100 hover:text-warm-900"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>
        {actions}
      </div>
    </div>
  );
}

/** "Showing 1–25 of 312 releases in the last 12 months matching “fraud”", with a way back. */
export function WireSummary({
  params,
  win,
  noun,
  phrase,
  note,
}: {
  params: WireParams;
  win: PageWindow;
  noun: string;
  phrase: string;
  note?: ReactNode;
}) {
  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] text-warm-600 [font-variant-numeric:tabular-nums]">
      <span>
        {win.total === 0 ? (
          <>No {noun} {phrase}</>
        ) : (
          <>
            Showing <strong className="font-semibold text-warm-900">{win.from.toLocaleString()}–{win.to.toLocaleString()}</strong> of{" "}
            <strong className="font-semibold text-warm-900">{win.total.toLocaleString()}</strong> {noun} {phrase}
          </>
        )}
        {params.q ? <> matching &ldquo;{params.q}&rdquo;</> : null}
      </span>
      {params.q ? (
        <Link href={wireHref(params, { q: "", page: 1 })} className="text-[#A93D25] underline-offset-2 hover:underline">
          Clear search
        </Link>
      ) : null}
      {note}
    </p>
  );
}

export function WirePager({ params, win }: { params: WireParams; win: PageWindow }) {
  if (win.pageCount <= 1) return null;
  const base = "rounded-lg border border-warm-200 px-3 py-1.5 text-[12px] font-medium no-underline";
  const prev = win.page > 1 ? wireHref(params, { page: win.page - 1 }) : null;
  const next = win.page < win.pageCount ? wireHref(params, { page: win.page + 1 }) : null;
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-[12px] text-warm-600 [font-variant-numeric:tabular-nums]">
      {prev ? (
        <Link href={prev} rel="prev" className={`${base} bg-white/70 text-warm-900 hover:bg-warm-100`}>
          ← Newer
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} text-warm-600 opacity-50`}>
          ← Newer
        </span>
      )}
      <span>
        Page {win.page} of {win.pageCount}
      </span>
      {next ? (
        <Link href={next} rel="next" className={`${base} bg-white/70 text-warm-900 hover:bg-warm-100`}>
          Older →
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} text-warm-600 opacity-50`}>
          Older →
        </span>
      )}
    </nav>
  );
}

/**
 * Fee-type chips, shared by both views: tags come from keywords in the headline
 * (wire-fee-types), the same pattern the Federal view filters with in SQL. Wraps on a phone.
 */
export function FeeChips({ params }: { params: WireParams }) {
  const chip = "rounded-full border px-2.5 py-1 text-[11px] font-medium no-underline transition-colors";
  return (
    <nav aria-label="Fee type" className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-warm-600">Fee type</span>
      {[{ key: undefined, label: "All" }, ...FEE_TYPES].map((t) => {
        const active = params.fee === t.key;
        return (
          <Link
            key={t.label}
            href={wireHref(params, { fee: t.key, page: 1 })}
            aria-current={active ? "true" : undefined}
            className={`${chip} ${
              active ? "border-[#C44B2E] bg-[#C44B2E] text-white" : "border-warm-200 bg-white/70 text-warm-700 hover:border-warm-400 hover:text-warm-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Oct 7, 2026 · yesterday": the absolute UTC day always, the relative words within a week. */
export function WireDate({ value, now, prefix }: { value: string | null | undefined; now: Date; prefix?: string }) {
  const d = formatWireDate(value, now);
  if (!d) return <span>Date not given</span>;
  return (
    <span className="[font-variant-numeric:tabular-nums]">
      {prefix ? `${prefix} ` : null}
      <time dateTime={d.iso} className="font-medium text-warm-700">
        {d.absolute}
      </time>
      {d.relative ? <span> · {d.relative}</span> : null}
    </span>
  );
}

export function WireHeader({ params }: { params: WireParams }) {
  const states = params.view === "states";
  return (
    <header>
      <h1
        className="text-[1.75rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815] sm:text-[2.25rem]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Regulatory Wire
      </h1>
      <p className="mt-1 text-[13px] text-[#6B6255]">
        {states
          ? "State fee bills, state banking regulators' own posts, and the press coverage of them, in one feed."
          : "Federal rulemaking with its comment deadlines and effective dates, and the agencies' own releases."}
      </p>
      <nav aria-label="Wire view" className="mt-4 inline-flex overflow-hidden rounded-lg border border-warm-200 bg-white/70 text-[12px]">
        {([
          ["federal", "Federal agencies"],
          ["states", "States"],
        ] as const).map(([key, label]) => (
          <Link
            key={key}
            // Switching views keeps the time range, the search and the chosen state.
            href={wireHref(params, { view: key, page: 1, source: undefined, topic: undefined, kind: undefined })}
            aria-current={params.view === key ? "page" : undefined}
            className={`px-3 py-1.5 font-medium no-underline transition-colors ${
              params.view === key ? "bg-warm-900 text-white" : "text-warm-600 hover:bg-warm-100 hover:text-warm-900"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
