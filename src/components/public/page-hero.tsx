import type { ReactNode } from "react";
import { homeSerif } from "@/app/landing-serif";
import "./page-hero.css";

/** The page width the homepage uses, so a page's hero lines up with the header above it. */
export const PAGE_HERO_WRAP = "mx-auto w-full max-w-[1312px] px-4 sm:px-6 lg:px-8";

/**
 * The template hero for public pages (James, Oct 19: "that curve instead of a straight line"):
 * the homepage's textured navy band with the same shallow curve on its bottom edge
 * (`.fi-page-hero::before` in page-hero.css), the page's eyebrow, serif title and one short lede on
 * the left, then whatever the page leads with (a search box, actions, a selector) under them.
 * `aside` takes the right column on desktop (a figure or a card) and follows the copy on a phone;
 * with no aside the copy keeps a readable width. The navy is fixed in both themes, like the
 * homepage, so text inside the band is always light.
 */
export function PageHero({
  id = "page-title",
  eyebrow,
  title,
  lede,
  children,
  aside,
  crumbs,
}: {
  /** The h1's id; the section is labelled by it. */
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** Under the lede: the page's search, actions or selector. */
  children?: ReactNode;
  /** The right column on desktop. */
  aside?: ReactNode;
  /** Breadcrumbs above the eyebrow. */
  crumbs?: ReactNode;
}) {
  return (
    <section className={`fi-page-hero ${homeSerif.variable} relative isolate text-white`} aria-labelledby={id}>
      <div
        className={`${PAGE_HERO_WRAP} grid gap-8 pb-16 pt-9 sm:pb-20 lg:pt-14 ${aside ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12" : ""}`}
      >
        <div className={`min-w-0 ${aside ? "" : "max-w-[46rem]"}`}>
          {crumbs ? <div className="mb-4 text-[13px] text-[#c9d6de] [&_a]:text-white [&_a:hover]:underline">{crumbs}</div> : null}
          {eyebrow ? <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#c9d6de]">{eyebrow}</p> : null}
          <h1
            id={id}
            className="mt-3 text-[36px] !font-medium leading-[1.06] tracking-[-0.025em] text-white sm:text-[48px] lg:text-[56px]"
            style={{ fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" }}
          >
            {title}
          </h1>
          {lede ? <div className="mt-5 max-w-[40rem] text-[17px] leading-[1.5] text-[#e0e9ee] sm:text-[19px]">{lede}</div> : null}
          {children ? <div className="mt-7">{children}</div> : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </section>
  );
}
