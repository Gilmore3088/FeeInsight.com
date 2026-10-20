/**
 * Shared page-header classes for public page templates. On phones the header block (breadcrumbs,
 * title, selector, introduction) is centered; from the sm breakpoint up it aligns left with the
 * page. Tables and details below the header stay left-aligned for scanning.
 */
export const PAGE_HEADER = "text-center sm:text-left";
export const PAGE_CRUMBS = "flex flex-wrap items-center justify-center gap-2 text-[12px] text-ink-muted sm:justify-start";
export const PAGE_H1 = "text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]";
export const PAGE_LEDE = "mx-auto max-w-[34rem] text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:max-w-3xl";
