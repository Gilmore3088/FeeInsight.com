import Link from "next/link";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import type { HomeData } from "./home-data";
import { FeeSizzle } from "./sizzle/fee-sizzle";

const CHIP_CLASS =
  "rounded-full border border-border bg-surface-0 px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-surface-200";

/**
 * The hero: the promise, one search, and the 35-second sizzle under it (BetterAnalyst's
 * page shape, James 2026-10-14). The search is the door fee owners and consumers share.
 */
export function HomeHero({ data, sampleLive }: { data: HomeData; sampleLive: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-border bg-paper">
      <div aria-hidden="true" className="home-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-page flex-col items-center px-4 pb-14 pt-14 text-center sm:px-6 sm:pt-20">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">The Bank Fee Index</p>
        <h1 className="mt-5 max-w-[16ch] text-[clamp(2.5rem,7vw,4.75rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-ink sm:max-w-none">
          Know where your fees stand,
          <br className="hidden sm:block" /> <span className="text-brick">with a source for every figure.</span>
        </h1>
        <p className="mt-6 max-w-[62ch] text-[17px] leading-relaxed text-ink-soft sm:text-[19px]">
          The Bank Fee Index reads the published fee schedules of U.S. banks and credit unions. See each of your fees
          against your market, your state, your Fed district, your peer group and the nation, then let Hamilton write it
          up.
        </p>

        <div className="mt-9 w-full max-w-xl text-left">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">Try it on a real institution</span>
            <span className="text-[12px] text-ink-muted">Free. Search any institution in the index.</span>
          </div>
          <InstitutionSearchBar ariaLabel="Search your bank or credit union" placeholder="Your bank or credit union" />
          <p className="mt-2 text-center text-[13px] text-ink-muted">
            <span className="font-mono tabular-nums text-ink">{data.institutionsLabel}</span> institutions with published
            fees · {data.freshnessLabel}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/fees/overdraft" className={CHIP_CLASS}>
            Overdraft fees nationwide
          </Link>
          <Link href="/research/national-fee-index" className={CHIP_CLASS}>
            National fee report
          </Link>
          {sampleLive ? (
            <Link href="/reports/sample-competitive-fee-position" className={CHIP_CLASS}>
              Sample competitive report
            </Link>
          ) : null}
        </div>

        <p className="mt-6 text-[14px] text-ink-soft">
          Questions for Hamilton come with Pro.{" "}
          <Link href="/subscribe" className="font-semibold text-ink underline decoration-2 underline-offset-4">
            See Hamilton plans
          </Link>
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Prefer one document? A Competitive Fee Position Report for your institution,{" "}
          <Link href="/reports" className="text-ink underline underline-offset-2">
            {REPORT_PRICE_INLINE}
          </Link>
          .
        </p>

        <div className="mt-14 w-full">
          <FeeSizzle data={data} />
        </div>
      </div>
    </section>
  );
}
