"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { NetworkMentions } from "@/lib/guides/atm-networks";

/** A state filter appears once a network's list is longer than this. */
const FILTER_FROM = 12;
/** Rows shown before "Show all". */
const FIRST_ROWS = 15;

/** "$2.00": schedules print cents. */
function cents(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function institutionsLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "institution's fee schedule" : "institutions' fee schedules"}`;
}

/**
 * "Networks named in fee schedules": one tab per network, the institutions whose own ATM lines
 * name it beneath, each line verbatim with its amount and source. Data arrives as props from the
 * server; this file imports no database code.
 */
export function AtmNetworkExhibit({
  title,
  caption,
  networks,
}: {
  title: string;
  caption: string;
  networks: NetworkMentions[];
}) {
  const [active, setActive] = useState(networks[0]?.id);
  const [state, setState] = useState("");
  const [showAll, setShowAll] = useState(false);
  const baseId = useId();
  const network = networks.find((n) => n.id === active) ?? networks[0];

  const states = useMemo(
    () => [...new Set(network.institutions.map((i) => i.state).filter((s): s is string => Boolean(s)))].sort(),
    [network],
  );
  const filtered = state ? network.institutions.filter((i) => i.state === state) : network.institutions;
  const rows = showAll || state ? filtered : filtered.slice(0, FIRST_ROWS);

  function choose(id: string) {
    setActive(id as typeof active);
    setState("");
    setShowAll(false);
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = networks[(i + (e.key === "ArrowRight" ? 1 : networks.length - 1)) % networks.length];
    choose(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  }

  return (
    <figure className="mt-6 w-full min-w-0 rounded-xl border border-border bg-surface-0 shadow-fi-1" data-testid="atm-network-exhibit">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        <div role="tablist" aria-label="ATM networks" className="mt-3 flex flex-wrap gap-2">
          {networks.map((n, i) => {
            const selected = n.id === network.id;
            return (
              <button
                key={n.id}
                id={`${baseId}-tab-${n.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(n.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  selected ? "border-ink bg-ink text-paper" : "border-border bg-surface-0 text-ink hover:border-ink"
                }`}
              >
                {n.name}
                <span className={`tabular-nums ${selected ? "text-paper/80" : "text-ink-muted"}`}>{n.institutions.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${network.id}`} className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="min-w-0 text-[14px] font-semibold text-ink">
            {network.name}: named by {institutionsLabel(network.institutions.length)}
          </p>
          {network.institutions.length > FILTER_FROM && states.length > 1 && (
            <label className="flex min-w-0 items-center gap-2 text-[13px] text-ink-soft">
              State
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="min-h-11 rounded-lg border border-border bg-surface-0 px-3 text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <ul className="mt-3 divide-y divide-border">
          {rows.map((inst) => (
            <li key={inst.institutionId} className="min-w-0 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                <Link
                  href={`/institution/${inst.institutionId}`}
                  className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                >
                  {inst.name}
                </Link>
                {inst.state && <span className="text-[13px] text-ink-muted">{inst.state}</span>}
              </p>
              <ul className="space-y-2">
                {inst.lines.map((line, i) => (
                  <li key={i} className="min-w-0 text-[13.5px] leading-relaxed text-ink-soft">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words">&ldquo;{line.feeName}&rdquo;</span>
                      <span className="shrink-0 font-mono tabular-nums text-ink">{cents(line.amount)}</span>
                    </span>
                    {line.namedIn && (
                      <span className="mt-0.5 block break-words text-[12.5px] text-ink-muted">
                        Schedule text: &ldquo;{line.namedIn}&rdquo;
                      </span>
                    )}
                    {line.documentUrl && (
                      <a
                        href={line.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-medium text-ink-muted underline decoration-border underline-offset-4 hover:text-ink hover:decoration-ink"
                      >
                        Source
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        <span className="sr-only">: {inst.name}&apos;s fee schedule (opens in a new tab)</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {!showAll && !state && filtered.length > FIRST_ROWS && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full border border-ink bg-surface-0 px-5 text-[14px] font-semibold text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Show all {filtered.length.toLocaleString()}
          </button>
        )}
      </div>

      <figcaption className="border-t border-border px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted sm:px-5">{caption}</figcaption>
    </figure>
  );
}
