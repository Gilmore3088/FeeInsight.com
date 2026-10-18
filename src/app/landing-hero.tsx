import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { IndexCard } from "./landing-index-card";
import type { IndexCardData } from "./landing-index-view";
import { TrackLink } from "@/components/track-link";
import { HOME_WRAP, SAMPLE_REPORT_HREF, SANS, SERIF, hasFigure } from "./landing-shared";

/**
 * The hero (James's example, Oct 17): a textured navy band whose bottom edge is a shallow curve
 * (`.fi-home-hero::before` in landing-motion.css), the buyer, the promise and one action on the
 * left, and a working Bank Fee Index card on the right that hangs over the curve into the light
 * section below. The visitor picks their institution inside the card (landing-index-card.tsx),
 * which replaced the separate search under it. The main action jumps to the card; the quieter
 * one opens the public sample report. On a phone the card follows the copy and still overlaps
 * the curve.
 */
export function LandingHero({ index, freshness }: { index: IndexCardData; freshness: string }) {
  return (
    <section className="fi-home-hero relative isolate overflow-visible bg-surface-0 pt-9 lg:pt-14" aria-labelledby="hero-title">
      <div className={`${HOME_WRAP} grid items-center gap-8 lg:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] lg:gap-[34px]`}>
        <div className="fi-home-hero-copy min-w-0 pb-1 lg:pb-12 lg:pt-2">
          {/* James's own eyebrow and headline (Oct 18); the subhead is the line he chose from the landing critique, with a comma for its dash. */}
          <p className="text-[15px] text-[#e0e9ee] sm:text-[16px]">For banks and credit unions</p>
          <h1 id="hero-title" className="fi-home-h1 mt-5 !font-medium text-white lg:mt-6" style={SERIF}>
            <span className="block whitespace-nowrap">Your next fee review</span>
            <span className="block whitespace-nowrap">doesn’t need to take weeks.</span>
          </h1>
          <p className="mt-6 text-[17px] leading-[1.45] text-[#e0e9ee] sm:text-[19px] lg:mt-7 lg:text-[clamp(18px,1.6vw,23px)]">
            Understand your institution’s financial position, compare your fees with competitors, and identify what
            deserves a closer look, all supported by published data and verifiable sources.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 lg:mt-9">
            <a href="#bank-fee-index" className="fi-btn fi-btn-brick min-h-12 px-6 text-[15px]">
              See a live fee comparison
            </a>
            <TrackLink
              href={SAMPLE_REPORT_HREF}
              event="sample_report_click"
              eventProps={{ placement: "home_hero" }}
              className="inline-flex min-h-12 items-center text-[15px] font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white"
            >
              View sample analysis
            </TrackLink>
          </div>
        </div>
        <div className="min-w-0 lg:self-start">
          <IndexCard data={index} freshness={freshness} />
        </div>
      </div>
    </section>
  );
}

/** The proof strip: two live counts and the promise behind every figure. A failed count is left out. */
export function LandingProof({ summary, feeTypes }: { summary: Pick<PublicStatsSummary, "institutionsLabel">; feeTypes: number }) {
  const items = [
    hasFigure(summary.institutionsLabel) ? { figure: summary.institutionsLabel, label: "institutions with published fees" } : null,
    feeTypes > 0 ? { figure: feeTypes.toLocaleString("en-US"), label: "fee categories" } : null,
  ].filter((x): x is { figure: string; label: string } => x !== null);
  return (
    <section aria-label={`The ${PRODUCT_NAME} at a glance`} className="bg-surface-0 pb-9 pt-8 sm:pb-11 sm:pt-10">
      <ul className={`mx-auto grid max-w-[1030px] px-4 text-center sm:px-6 ${items.length === 2 ? "grid-cols-3" : items.length === 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {items.map((item) => (
          <li key={item.label} className="border-r border-border px-2 sm:px-6" data-proof-count="">
            <strong className="block text-[23px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[clamp(28px,3vw,40px)]">
              {item.figure}
            </strong>
            <span className="mt-1 block text-[12px] text-ink-muted sm:text-[16px]">{item.label}</span>
          </li>
        ))}
        <li className="flex items-center justify-center px-2 sm:px-6">
          <Link href="/methodology" className="text-[18px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink hover:underline sm:text-[clamp(22px,2.4vw,32px)]" style={SANS}>
            A source for
            <br />
            every figure
          </Link>
        </li>
      </ul>
    </section>
  );
}
