import type { ReactNode } from "react";

/**
 * The /subscribe look (James, 9 Oct 2026) as shared pieces for the public pages: glass
 * surfaces over warm light, one corner radius (rounded-2xl) for every box, Plus Jakarta Sans
 * headings (the site's font-sans), checklists with a drawn check, and the same pointer,
 * transition and focus treatment. Fee Insight colours only: parchment, charcoal, terracotta
 * and the warm neutrals already used on /subscribe. No new colour tokens.
 */

/** Primary glass surface: cards, forms, side panels. Same recipe as the /subscribe plan card. */
export const GLASS =
  "rounded-2xl bg-white/75 ring-1 ring-[#E8E1D6]/80 shadow-[0_12px_40px_-12px_rgba(26,24,21,0.25),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl";

/** Quieter glass for repeated boxes in a grid (the /subscribe closing panel). */
export const GLASS_SOFT =
  "rounded-2xl bg-white/70 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl";

/** Full-width frosted band between sections (the /subscribe capabilities band). */
export const BAND = "border-y border-white/60 bg-[#F3EEE6]/70 backdrop-blur-md";

/**
 * The skill's interaction checklist, applied once per page wrapper: pointer cursor on
 * buttons and summaries, 200ms colour transitions, a visible terracotta focus outline.
 * It also sets h1 and h2 in the page font, as /subscribe computes them: the global
 * `.consumer-brand h1, h2` serif rule would otherwise win inside consumer-brand wrappers.
 */
export const INTERACTION =
  "[&_:is(h1,h2)]:font-sans! [&_:is(button,summary):not(:disabled)]:cursor-pointer [&_:is(a,button,summary)]:transition-colors [&_:is(a,button,summary)]:duration-200 [&_:is(a,button,summary,input,select,textarea,[tabindex]):focus-visible]:outline-2 [&_:is(a,button,summary,input,select,textarea,[tabindex]):focus-visible]:outline-offset-2 [&_:is(a,button,summary,input,select,textarea,[tabindex]):focus-visible]:outline-[#A93D25]";

/** One primary action per section: terracotta, 44px tall, same radius as /subscribe. */
export const CTA_PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#C44B2E] px-5 py-3 text-center text-[15px] font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#A93D25]";

/** Secondary action beside a primary one: glass, charcoal text. */
export const CTA_SECONDARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white/70 px-5 py-3 text-center text-[15px] font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:bg-white hover:ring-[#C44B2E]/40";

/** Text link in body copy: terracotta text style (5.8:1 on parchment), underlined. */
export const TEXT_LINK = "font-semibold text-[#A93D25] underline underline-offset-2 hover:text-[#8E2A17]";

/**
 * Tabular figures in the page font. The global `.tabular-nums` class also swaps in Geist
 * Mono; /subscribe sets its prices in Plus Jakarta Sans, so the redesigned boxes use this.
 */
export const NUM = "[font-variant-numeric:tabular-nums] [font-feature-settings:'tnum']";

export const EYEBROW = "text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]";
export const H1 = "text-4xl font-bold leading-[1.08] tracking-tight text-[#1A1815] sm:text-5xl";
export const H2 = "text-2xl font-semibold tracking-tight text-[#1A1815] sm:text-3xl";
export const H3 = "text-lg font-semibold tracking-tight text-[#1A1815]";
export const LEAD = "text-lg leading-relaxed text-[#3D3830]";
export const BODY = "text-[15px] leading-relaxed text-[#3D3830]";
export const SMALL = "text-sm leading-relaxed text-[#5A5347]";

/**
 * The two soft light sources behind the glass. Place inside a `relative isolate` wrapper;
 * it is decorative, still (no motion) and ignores the pointer. The wrapper clips it sideways
 * (overflow-x-clip) so the soft edges never widen the page.
 */
export function AmbientGlow({ height = 1100 }: { height?: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10" style={{ height }}>
      <div className="absolute -left-40 -top-32 h-[560px] w-[560px] rounded-full bg-[#E3C9A8]/45 blur-3xl" />
      <div className="absolute -right-32 top-24 h-[480px] w-[480px] rounded-full bg-[#C44B2E]/10 blur-3xl" />
      <div className="absolute left-1/3 top-[620px] h-[420px] w-[520px] rounded-full bg-[#E3C9A8]/35 blur-3xl" />
    </div>
  );
}

/** A drawn check in a terracotta-tinted disc; decorative beside its visible text. */
export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C44B2E]/10 text-[#A93D25] ${className}`}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
      </svg>
    </span>
  );
}

/** A checklist: each line a drawn check and its text. */
export function CheckList({ items, className = "" }: { items: readonly ReactNode[]; className?: string }) {
  return (
    <ul className={`space-y-2.5 ${className}`}>
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-[15px] leading-snug text-[#3D3830]">
          <CheckIcon />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A section header that spans its grid: eyebrow, heading, one short intro line and an
 * optional action on the right at wide widths.
 */
export function SectionHeader({
  id,
  eyebrow,
  title,
  intro,
  action,
  as: Heading = "h2",
  className = "",
}: {
  id: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-4 ${className}`}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
        <Heading id={id} className={`${eyebrow ? "mt-3" : ""} ${Heading === "h1" ? H1 : H2}`}>
          {title}
        </Heading>
        {intro && <p className={`mt-3 ${Heading === "h1" ? LEAD : BODY}`}>{intro}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
