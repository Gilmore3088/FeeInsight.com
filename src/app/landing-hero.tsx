import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { IndexCard } from "./landing-index-card";
import type { IndexCardData } from "./landing-index-view";
import { HOME_WRAP, InstitutionSearchForm, SANS, hasFigure } from "./landing-shared";

/**
 * The hero (James's example, Oct 17): a textured navy band whose bottom edge is a shallow curve
 * (`.fi-home-hero::before` in landing-motion.css), the promise and two actions on the left, and
 * a working Bank Fee Index card on the right that hangs over the curve into the light section
 * below. The institution search sits in the card, the free way in to an institution's page.
 * On a phone the card follows the copy and still overlaps the curve.
 */
export function LandingHero({ index, freshness }: { index: IndexCardData; freshness: string }) {
  return (
    <section className="fi-home-hero relative isolate overflow-visible bg-surface-0 pt-9 lg:pt-14" aria-labelledby="hero-title">
      <div className={`${HOME_WRAP} grid items-center gap-8 lg:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] lg:gap-[34px]`}>
        <div className="fi-home-hero-copy min-w-0 pb-1 lg:pb-12 lg:pt-2">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d9e2e9]">
            <span aria-hidden="true" className="h-0.5 w-9 bg-[#e0716a]" />
            Bank fee intelligence
          </p>
          <h1 id="hero-title" className="fi-home-h1 mt-6 !font-semibold text-white lg:mt-7" style={SANS}>
            <span className="block whitespace-nowrap">Know your market.</span>
            <span className="block whitespace-nowrap">Price with confidence.</span>
          </h1>
          <p className="mt-6 text-[17px] leading-[1.45] text-[#e0e9ee] sm:text-[19px] lg:mt-7 lg:text-[clamp(18px,1.6vw,23px)]">
            Benchmark with the {PRODUCT_NAME}.
            <br />
            Put Hamilton to work for your institution.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4 lg:mt-9">
            <a href="#hamilton" className="fi-btn fi-btn-brick min-h-12 px-6 text-[15px]">
              See Hamilton in action
            </a>
            <Link href="/fees" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-white underline decoration-white/40 underline-offset-[6px] hover:decoration-white">
              Explore the Index
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
        <div className="min-w-0 lg:self-start">
          <IndexCard data={index} freshness={freshness}>
            <InstitutionSearchForm
              id="hero-institution-search"
              secondary
              className="mt-4 border-t border-border pt-4 [&_.fi-field]:max-w-none [&_.fi-input]:py-1.5 [&_label]:text-[12px]"
            />
          </IndexCard>
        </div>
      </div>
    </section>
  );
}

/** The proof strip: two live counts and the promise behind every figure. A failed count is left out. */
export function LandingProof({ summary, feeTypes }: { summary: Pick<PublicStatsSummary, "institutionsLabel">; feeTypes: number }) {
  const items = [
    hasFigure(summary.institutionsLabel) ? { figure: summary.institutionsLabel, label: "institutions" } : null,
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
