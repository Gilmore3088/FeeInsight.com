"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import "./ask-dashboard.css";

/** One numbered source behind an answer, as the answer itself names it. */
export interface EvidenceSource {
  /** The note number the answer's figures carry. */
  n: number;
  label: string;
  /** The amount the source states, when it is one fee row ("$35"). */
  amount?: string | null;
  /** Lines shown when the source is opened: its date, sample size, what was looked up. */
  details?: string[];
  /**
   * Where the fee is printed, in the citation's own words ("page 2, line 4 of our stored copy of
   * the bank's fee schedule"). Shown whole, and only when the row carries it.
   */
  location?: string | null;
  url?: string | null;
}

/** The id a numbered note links to, so the note opens its source here. */
export function evidenceAnchor(n: number): string {
  return `story-source-${n}`;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    const text = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
    return text.length > 46 ? `${text.slice(0, 44)}…` : text;
  } catch {
    return url;
  }
}

/**
 * The answer's evidence as numbered sources, each a button that opens its detail (aria-expanded).
 * A numbered note in the answer links to `#story-source-N`; following it opens that source.
 */
export function EvidencePanel({
  sources,
  title = "Evidence",
  headingId,
  headingLevel = 2,
  intro,
  children,
  defaultOpen = 1,
}: {
  sources: EvidenceSource[];
  title?: string;
  headingId?: string;
  headingLevel?: 2 | 3;
  /** One short line under the heading. */
  intro?: string;
  /** More beneath the sources: the peer group, method, limits. */
  children?: ReactNode;
  /** How many sources start open (the first ones). */
  defaultOpen?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState<Set<number>>(() => new Set(sources.slice(0, defaultOpen).map((s) => s.n)));
  useEffect(() => {
    const fromHash = () => {
      const match = /^#story-source-(\d+)$/.exec(window.location.hash);
      if (match) setOpen((current) => new Set(current).add(Number(match[1])));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <aside className="ha-evidence" aria-labelledby={headingId ?? `${id}-h`}>
      <div className="ha-evidence-head">
        <Heading id={headingId ?? `${id}-h`}>{title}</Heading>
        <span className="hd-card-note">{sources.length} {sources.length === 1 ? "source" : "sources"}</span>
      </div>
      {intro ? <p className="hd-card-note">{intro}</p> : null}
      {sources.length > 0 ? (
        <ol>
          {sources.map((s) => {
            const isOpen = open.has(s.n);
            const bodyId = `${id}-src-${s.n}`;
            return (
              <li key={s.n} id={evidenceAnchor(s.n)} className="ha-src" data-open={isOpen}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => setOpen((current) => {
                    const next = new Set(current);
                    if (isOpen) next.delete(s.n);
                    else next.add(s.n);
                    return next;
                  })}
                >
                  <span className="ha-src-n" aria-hidden="true">{s.n}</span>
                  <span className="ha-src-label">
                    <span className="hd-sr">Source {s.n}: </span>
                    {s.label}
                    {s.amount ? <span className="hd-mono"> · {s.amount}</span> : null}
                  </span>
                </button>
                {isOpen ? (
                  <div id={bodyId} className="ha-src-body">
                    {(s.details ?? []).map((line) => <span key={line}>{line}</span>)}
                    {s.location ? <span className="ha-src-cite">Cited at {s.location}.</span> : null}
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{hostOf(s.url)}</a> : null}
                    {!s.details?.length && !s.location && !s.url ? <span className="hd-muted">No date or link is recorded for this source.</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="hd-card-note">No source is recorded with this answer.</p>
      )}
      {children}
    </aside>
  );
}
