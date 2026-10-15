import Link from "next/link";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import {
  Eyebrow,
  InstitutionSearchForm,
  NationalRange,
  SAMPLE_REPORT_HREF,
  SANS,
  TEXT_LINK,
  type RangeEntry,
} from "./landing-shared";

interface LandingHeroProps {
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel">;
  /** The national overdraft row; null hides the chart rather than drawing a guess. */
  overdraft: RangeEntry | null;
  /** The live sample report exists today. */
  sampleLive: boolean;
}

/** Site v3 brief 08 §B.3, laid out as brief 04 Direction A: the promise, then the search. */
export function LandingHero({ summary, overdraft, sampleLive }: LandingHeroProps) {
  const hasCount = /\d/.test(summary.institutionsLabel);
  const chips = [
    { href: "/fees/overdraft", label: "Overdraft fees nationwide" },
    { href: "/research/national-fee-index", label: "National fee report" },
    ...(sampleLive ? [{ href: SAMPLE_REPORT_HREF, label: "Sample competitive report" }] : []),
  ];

  return (
    <section className="border-b border-border bg-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-14">
        <div className="min-w-0">
          <Eyebrow>The {PRODUCT_NAME}</Eyebrow>
          <h1
            className="mt-3 text-[clamp(2.1rem,7vw,3.25rem)] font-extrabold leading-[1.05] tracking-[-0.025em] text-ink"
            style={SANS}
          >
            <span className="block">Know where your fees stand,</span>
            <span className="block text-brick">with a source for every figure.</span>
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-ink-soft sm:text-[18px]">
            The {PRODUCT_NAME} reads the published fee schedules of U.S. banks and credit unions. See each
            of your fees against your market, your state, your Fed district, your peer group and the
            nation, then let Hamilton, the {SITE_NAME} Pro workspace, write it up.
          </p>

          <InstitutionSearchForm className="mt-7" />
          <p className="mt-2 text-[13px] leading-5 text-ink-muted">
            {hasCount ? `${summary.institutionsLabel} institutions with published fees · ` : ""}
            {summary.freshnessLabel}. Free to search.
          </p>

          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Try one of these">
            {chips.map((chip) => (
              <li key={chip.href}>
                <Link
                  href={chip.href}
                  className="inline-flex rounded-full border border-border bg-surface-0 px-3 py-1.5 text-[13px] font-medium text-ink hover:border-ink"
                >
                  {chip.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-6 space-y-2 text-[14px] leading-6 text-ink-soft">
            <p>
              Questions for Hamilton come with Pro.{" "}
              <TrackLink event="upgrade_click" eventProps={{ placement: "home_hero" }} href={PRO_PLANS_NAV.href} className={TEXT_LINK}>
                {PRO_PLANS_NAV.label}
              </TrackLink>
            </p>
            <p>Checking your own bank&apos;s fees? Search the same index, free.</p>
          </div>
        </div>

        {overdraft ? (
          <div className="min-w-0 rounded-lg border border-border bg-surface-0 p-5 sm:p-6">
            <NationalRange row={overdraft} freshnessLabel={summary.freshnessLabel} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
