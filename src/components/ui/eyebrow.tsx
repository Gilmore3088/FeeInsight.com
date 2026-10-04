import type { ElementType, ReactNode } from "react";

/**
 * Eyebrow — section labels in the editorial style used across Fee Insight
 * marketing surfaces (11px uppercase serif, 0.12em tracking, #7A7062).
 *
 * Semantics: defaults to `<span>` (decorative). Pass `as="h2"` (or `h3`/`h4`)
 * when the eyebrow IS the section's heading — so screen readers still get
 * proper landmarks, and the visible style stays the small editorial label.
 *
 * Colors come from the warm-* design tokens defined in globals.css `@theme`.
 * Works in any route — no `.consumer-brand` wrapper required.
 */

type Tone = "default" | "subtle" | "accent" | "dark";

interface EyebrowProps {
  /** Render-as element. Defaults to `span`. Use `h2`/`h3`/`h4` when this IS the section heading. */
  as?: ElementType;
  /** Color tone. `default` for most labels, `accent` (terracotta) for branded callouts. */
  tone?: Tone;
  /** Tracking / size variant. `wide` is the 11px / 0.12em default; `tight` is 12px / 0.1em for slightly larger labels. */
  size?: "wide" | "tight";
  className?: string;
  children: ReactNode;
}

/* warm-500 (#A09788) is reserved for rules and disabled states. Eyebrows are text at
   or below 14px, so warm-600 (#6B6255, 5.6:1 on parchment) is the floor for every tone. */
const TONE: Record<Tone, string> = {
  default: "text-warm-600",
  subtle: "text-warm-600",
  accent: "text-terra",
  dark: "text-warm-700",
};

const SIZE: Record<NonNullable<EyebrowProps["size"]>, string> = {
  wide: "text-[11px] font-bold uppercase tracking-[0.12em]",
  tight: "text-[12px] font-bold uppercase tracking-[0.1em]",
};

export function Eyebrow({
  as: Component = "span",
  tone = "default",
  size = "wide",
  className = "",
  children,
}: EyebrowProps) {
  return (
    <Component
      className={`${SIZE[size]} ${TONE[tone]} ${className}`}
      style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
    >
      {children}
    </Component>
  );
}
