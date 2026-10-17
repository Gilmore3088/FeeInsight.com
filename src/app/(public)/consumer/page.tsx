export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { loadConsumerGuides } from "@/lib/guides/source";
import type { Guide } from "@/lib/guides/types";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import { formatFeeAmount } from "@/lib/format";
import { getPublicSnapshot } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { PAGE_HEADER } from "@/components/public/page-header";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";
import { InstitutionSearchBar } from "../institutions/search-bar";
import { SourceNote } from "../research/district/[id]/district-hub";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { StatePicker, type StateOption } from "./state-picker";

const TITLE = "Bank Fees Explained: Check and Avoid Them";
const DESCRIPTION =
  "Plain-language guides to bank and credit union fees, a fee check for any bank, and named local alternatives with lower monthly and overdraft fees.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/consumer` },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/consumer`, siteName: "Fee Insight" },
};

const ROWS_SHOWN = 5;

/** The demo cast: well-covered institutions a first-time visitor can open in one tap. */
const EXAMPLES = [
  { id: 323, name: "Capital City Bank" },
  { id: 5, name: "U.S. Bank" },
  { id: 4956, name: "Navy Federal Credit Union" },
] as const;

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;
const count = (n: number) => n.toLocaleString("en-US");

const BAND = "flex min-w-0 flex-col border-t border-border pt-5";
const BAND_H2 = "text-center text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-left sm:text-[22px]";
const BAND_LINE = "mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const MORE = `mt-auto inline-flex min-h-11 items-center pt-3 text-[14px] font-semibold ${LINK}`;

/** "/guides/atm-fees#find-cash" when that guide and section exist; the guide alone without the section. */
function guideHref(guides: Guide[], slug: string, section: string): string | null {
  const guide = guides.find((g) => g.slug === slug);
  if (!guide) return null;
  return `/guides/${slug}${guide.sections.some((s) => s.id === section) ? `#${section}` : ""}`;
}

interface Route {
  key: string;
  title: string;
  /** What to do, from the guide's own advice; no number. */
  line: string;
  /** One live figure from the index, with its population. */
  figure: ReactNode | null;
  href: string;
  action: string;
}

export default async function ConsumerPage() {
  const [{ summary, categories }, guides, states] = await Promise.all([
    getPublicSnapshot(),
    loadConsumerGuides().catch((error: unknown) => {
      console.error("Consumer page guides failed:", error);
      return [] as Guide[];
    }),
    getStatesWithFeeDataCached().catch((error: unknown) => {
      console.error("Consumer page states failed:", error);
      return [];
    }),
  ]);
  const summaryFor = new Map<string, FeeCategorySummary>(categories.map((c) => [c.fee_category, c]));
  const median = (category: string) => {
    const s = summaryFor.get(category);
    return s && s.median_amount != null ? { ...s, median_amount: s.median_amount } : null;
  };
  const asOf = summary.refreshedOn ? `, data as of ${summary.refreshedOn}` : "";

  const guideRows = [...guides].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, ROWS_SHOWN);

  const monthly = summaryFor.get("monthly_maintenance");
  const overdraft = median("overdraft");
  const transfer = median("od_protection_transfer");
  const atm = median("atm_non_network");
  const candidates: Array<Route | null> = [
    (() => {
      const href = guideHref(guides, "monthly-maintenance-fees", "how-to-avoid");
      if (!href) return null;
      return {
        key: "monthly",
        title: "Avoid a monthly maintenance fee",
        line: "A waiver can turn on direct deposit, a minimum balance or electronic statements. Student, senior and military accounts may carry fewer fees.",
        figure:
          monthly && monthly.zero_count > 0 ? (
            <>
              {count(monthly.zero_count)} of the {count(monthly.institution_count)} banks and credit unions that list this fee list it
              only at $0.
            </>
          ) : null,
        href,
        action: "Read the waiver steps",
      };
    })(),
    (() => {
      const href = guideHref(guides, "overdraft-fees", "consent");
      if (!href) return null;
      return {
        key: "overdraft",
        title: "Understand overdraft choices",
        line: "Opting out of debit card overdraft coverage stops overdraft fees on card purchases and ATM withdrawals; the payment is declined instead.",
        figure:
          overdraft && transfer ? (
            <>
              A linked savings transfer has a U.S. median of {money(transfer.median_amount)}
              <UnstatedAudienceMark show={medianHasUnstatedAudience(transfer)} /> ({count(transfer.institution_count)} institutions),
              against {money(overdraft.median_amount)}
              <UnstatedAudienceMark show={medianHasUnstatedAudience(overdraft)} /> for an overdraft ({count(overdraft.institution_count)}).
            </>
          ) : null,
        href,
        action: "Read the overdraft choices",
      };
    })(),
    (() => {
      const href = guideHref(guides, "atm-fees", "find-cash");
      if (!href) return null;
      return {
        key: "atm",
        title: "Reduce ATM charges",
        line: "An institution's own ATMs and its surcharge-free network cost nothing. Cash back at a store checkout is another route.",
        figure: atm ? (
          <>
            An out-of-network withdrawal has a U.S. median fee of {money(atm.median_amount)}
            <UnstatedAudienceMark show={medianHasUnstatedAudience(atm)} />, across {count(atm.institution_count)} banks and credit
            unions, before the ATM owner&apos;s own surcharge.
          </>
        ) : null,
        href,
        action: "Find cheaper cash access",
      };
    })(),
  ];
  const routes = candidates.filter((r): r is Route => r !== null);

  const stateOptions: StateOption[] = states
    .filter((s) => STATE_NAMES[s.state_code])
    .map((s) => ({ code: s.state_code, name: STATE_NAMES[s.state_code], institutions: s.institution_count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const unstatedShown =
    guideRows.some((guide) => medianHasUnstatedAudience(summaryFor.get(guide.primaryCategory))) ||
    [overdraft, transfer, atm].some((s) => medianHasUnstatedAudience(s));

  return (
    <div className="min-h-screen bg-paper text-ink">
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "For consumers", href: "/consumer" }]} />
      <div className="mx-auto max-w-page px-4 py-7 sm:px-6 sm:py-10">
        <section className={`max-w-3xl ${PAGE_HEADER}`}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brick">For consumers</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[44px]">
            Understand a bank fee, and avoid the next one
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">
            Plain-language guides, a fee check for {summary.institutionsLabel} banks and credit unions, and named local
            alternatives. Fees link to each institution&apos;s own published schedule.
          </p>
          <div className="mt-4 flex justify-center sm:justify-start">
            <Link href="#check" className="fi-btn fi-btn-primary inline-flex min-h-11 items-center justify-center px-5">
              Check a bank&apos;s fees
            </Link>
          </div>
        </section>

        <div className="mt-8 grid gap-10 sm:mt-10 lg:grid-cols-3 lg:gap-8">
          <section aria-labelledby="understand-heading" className={BAND}>
            <h2 id="understand-heading" className={BAND_H2}>
              Understand a charge
            </h2>
            <p className={BAND_LINE}>
              {guides.length > 0
                ? `${guides.length} guides explain what a charge is, what it usually costs and how to avoid the next one.`
                : "The guides are not available right now."}
            </p>
            {guideRows.length > 0 && (
              <ul className="mt-3 divide-y divide-border">
                {guideRows.map((guide) => {
                  const m = median(guide.primaryCategory);
                  return (
                    <li key={guide.slug}>
                      <Link
                        href={`/guides/${guide.slug}`}
                        className="flex min-h-11 items-baseline justify-between gap-3 py-2.5 text-[15px] text-ink hover:text-brick"
                      >
                        <span className="min-w-0">{guide.title}</span>
                        {m && (
                          <span className="shrink-0 text-right text-[12px] text-ink-muted">
                            U.S. median <span className="font-mono tabular-nums text-ink">{money(m.median_amount)}</span>
                            <UnstatedAudienceMark show={medianHasUnstatedAudience(m)} />
                            <span className="block">{count(m.institution_count)} institutions</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {guideRows.some((g) => median(g.primaryCategory)) && (
              <div className="mt-3">
                <SourceNote>
                  Medians from the published fee schedules of the U.S. banks and credit unions counted on each row, {PRODUCT_NAME}
                  {asOf}.
                </SourceNote>
              </div>
            )}
            <Link href="/guides" className={MORE}>
              {guides.length > 0 ? `All ${guides.length} guides` : "Fee guides"}
            </Link>
          </section>

          {/* `relative z-20` keeps the search suggestions above the next band. */}
          <section id="check" aria-labelledby="check-heading" className={`relative z-20 scroll-mt-24 ${BAND}`}>
            <h2 id="check-heading" className={BAND_H2}>
              Check your bank
            </h2>
            <p className={BAND_LINE}>
              The fee check sets a bank&apos;s or credit union&apos;s main fees beside its state and U.S. medians, with the account
              terms behind each one.
            </p>
            <div className="mt-4 text-left">
              <InstitutionSearchBar resultPath="/check" ariaLabel="Your bank or credit union" placeholder="Your bank or credit union" />
            </div>
            <ul className="mt-3 divide-y divide-border">
              {EXAMPLES.map((example) => (
                <li key={example.id}>
                  <Link
                    href={`/check?id=${example.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 py-2 text-[15px] text-ink hover:text-brick"
                  >
                    <span className="min-w-0">{example.name}</span>
                    <span aria-hidden="true" className="text-ink-muted">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/check" className={MORE}>
              Open the fee check
            </Link>
          </section>

          <section aria-labelledby="compare-heading" className={BAND}>
            <h2 id="compare-heading" className={BAND_H2}>
              Compare alternatives
            </h2>
            <p className={BAND_LINE}>
              City fee pages name each bank and credit union with a branch in a city, with its published price and the account it
              applies to.
            </p>
            {stateOptions.length > 0 ? (
              <div className="mt-4">
                <StatePicker states={stateOptions} />
              </div>
            ) : (
              <p className={BAND_LINE}>The state list is not available right now.</p>
            )}
            {stateOptions.length > 0 && (
              <div className="mt-3">
                <SourceNote>
                  Banks and credit unions headquartered in each state with published fees, {PRODUCT_NAME}
                  {asOf}.
                </SourceNote>
              </div>
            )}
            <Link href="/institutions" className={MORE}>
              Browse the directory
            </Link>
          </section>
        </div>

        {routes.length > 0 && (
          <section aria-labelledby="routes-heading" className="mt-12 border-t border-border pt-6">
            <h2 id="routes-heading" className={BAND_H2}>
              Ways around three common charges
            </h2>
            <p className={BAND_LINE}>The first step for each, from its guide, with the national figure behind it.</p>
            <ul className="mt-4 grid gap-4 md:grid-cols-3">
              {routes.map((route) => (
                <li key={route.key} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5">
                  <h3 className="text-[16px] font-semibold text-ink">{route.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">{route.line}</p>
                  {route.figure && (
                    <p className="mt-2 text-[13px] leading-snug text-ink sm:mx-0 sm:text-left">{route.figure}</p>
                  )}
                  <Link href={route.href} className={`mt-auto inline-flex min-h-11 items-center pt-2 text-[14px] ${LINK}`}>
                    {route.action}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <SourceNote>
                Published fee schedules of U.S. banks and credit unions, {PRODUCT_NAME}
                {asOf}; counts are institutions that list each fee.
              </SourceNote>
            </div>
          </section>
        )}

        <div className="mt-10">
          <Link
            href="/methodology"
            className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            How the medians are counted
          </Link>
          <UnstatedAudienceFootnote show={unstatedShown} className="mt-3" />
        </div>
      </div>
    </div>
  );
}
