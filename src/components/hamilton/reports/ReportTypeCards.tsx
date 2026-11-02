"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import "./reports-dashboard.css";

type Thumb = "donut" | "bars" | "range" | "line";

/** A cover thumbnail: a small page with the report's chart drawn on it. Decorative; the card carries the words. */
export function ReportThumb({ kind }: { kind: Thumb }) {
  return (
    <svg width="58" height="74" viewBox="0 0 58 74" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="57" height="73" rx="3" fill="var(--fi-surface-0)" stroke="var(--fi-border)" />
      <rect x="6" y="7" width="30" height="4" rx="1" fill="var(--fi-ink)" />
      <rect x="6" y="14" width="20" height="2" rx="1" fill="var(--fi-control-border)" />
      {kind === "donut" ? (
        <>
          <circle cx="18" cy="34" r="8" fill="none" stroke="var(--fi-surface-200)" strokeWidth="5" />
          <circle cx="18" cy="34" r="8" fill="none" stroke="var(--fi-above-market)" strokeWidth="5" strokeDasharray="17.7 32.6" transform="rotate(-90 18 34)" />
          <rect x="31" y="29" width="20" height="2" rx="1" fill="var(--fi-control-border)" />
          <rect x="31" y="34" width="16" height="2" rx="1" fill="var(--fi-control-border)" />
          <rect x="31" y="39" width="18" height="2" rx="1" fill="var(--fi-control-border)" />
        </>
      ) : null}
      {kind === "bars" ? (
        <>
          <rect x="8" y="34" width="6" height="12" fill="var(--fi-in-range)" />
          <rect x="17" y="28" width="6" height="18" fill="var(--fi-in-range)" />
          <rect x="26" y="24" width="6" height="22" fill="var(--fi-above-market)" />
          <rect x="35" y="31" width="6" height="15" fill="var(--fi-in-range)" />
          <rect x="44" y="36" width="6" height="10" fill="var(--fi-below-market)" />
        </>
      ) : null}
      {kind === "range" ? (
        <>
          <line x1="6" y1="28" x2="52" y2="28" stroke="var(--fi-border)" strokeWidth="1.5" /><rect x="18" y="25" width="16" height="6" rx="1" fill="var(--fi-brick-tint)" /><circle cx="44" cy="28" r="2.6" fill="var(--fi-above-market)" />
          <line x1="6" y1="37" x2="52" y2="37" stroke="var(--fi-border)" strokeWidth="1.5" /><rect x="14" y="34" width="18" height="6" rx="1" fill="var(--fi-brick-tint)" /><circle cx="24" cy="37" r="2.6" fill="var(--fi-in-range)" />
          <line x1="6" y1="46" x2="52" y2="46" stroke="var(--fi-border)" strokeWidth="1.5" /><rect x="22" y="43" width="14" height="6" rx="1" fill="var(--fi-brick-tint)" /><circle cx="12" cy="46" r="2.6" fill="var(--fi-below-market)" />
        </>
      ) : null}
      {kind === "line" ? (
        <>
          <polyline points="6,44 14,40 22,42 30,34 38,36 46,28 52,30" fill="none" stroke="var(--fi-above-market)" strokeWidth="1.8" strokeLinejoin="round" />
          <line x1="6" y1="48" x2="52" y2="48" stroke="var(--fi-border)" strokeWidth="1" />
        </>
      ) : null}
      <rect x="6" y="56" width="46" height="2" rx="1" fill="var(--fi-border)" />
      <rect x="6" y="61" width="38" height="2" rx="1" fill="var(--fi-border)" />
      <rect x="6" y="66" width="42" height="2" rx="1" fill="var(--fi-border)" />
    </svg>
  );
}

export interface ReportTypeCard {
  key: string;
  name: string;
  blurb: string;
  meta: string;
  thumb: Thumb;
  /** A card that opens another page. */
  href?: string;
  /** A card that sets up the builder below; pressed while it is the builder's report. */
  onPick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
}

function Body({ card }: { card: ReportTypeCard }): ReactNode {
  return (
    <>
      <ReportThumb kind={card.thumb} />
      <span className="rt-text">
        <span className="rt-name">{card.name}</span>
        <span className="rt-blurb">{card.blurb}</span>
        <span className="rt-meta">{card.meta}</span>
      </span>
    </>
  );
}

/** "Start a report": each report type as a card with its cover. */
export function ReportTypeCards({ cards }: { cards: ReportTypeCard[] }) {
  return (
    <div className="rt-grid">
      {cards.map((card) =>
        card.href && !card.disabled ? (
          <Link key={card.key} href={card.href} className="rt-card">
            <Body card={card} />
          </Link>
        ) : (
          <button key={card.key} type="button" className="rt-card" aria-pressed={card.onPick ? Boolean(card.pressed) : undefined} onClick={card.onPick} disabled={card.disabled}>
            <Body card={card} />
          </button>
        ),
      )}
    </div>
  );
}
