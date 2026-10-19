export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, CalendarDays, MapPin, Receipt, Search, Send, Wallet, Undo2 } from "lucide-react";
import { loadConsumerGuides } from "@/lib/guides/source";
import type { Guide } from "@/lib/guides/types";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getAtmTwoFeeExampleCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import { AtmReceipt } from "@/components/public/atm-receipt";
import { formatFeeAmount } from "@/lib/format";
import { getPublicSnapshot } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";
import { InstitutionSearchBar } from "../institutions/search-bar";
import { SourceNote } from "../research/district/[id]/district-hub";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { StatePicker, type StateOption } from "./state-picker";
import { CheckExample, loadCheckExample } from "./check-example";
import { PAGE_HERO_WRAP, PageHero } from "@/components/public/page-hero";
import { HamiltonEmployeeBand } from "../check/check-result";
import { homeSerif } from "@/app/landing-serif";
import { SERIF } from "@/app/landing-shared";
import "@/app/landing-motion.css";

const TITLE = "Bank Fees Explained: Check and Avoid Them";
const DESCRIPTION =
  "Plain-language guides to bank and credit union fees, a fee check for any bank against state and U.S. medians, and city-by-city fee comparisons.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/consumer` },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/consumer`, siteName: SITE_NAME },
};

/** The five most-searched charges: an icon, the guide, and the national median it explains. */
const CHARGES = [
  { slug: "overdraft-fees", category: "overdraft", label: "Overdraft", Icon: Wallet },
  { slug: "nsf-fees", category: "nsf", label: "Returned payment (NSF)", Icon: Undo2 },
  { slug: "atm-fees", category: "atm_non_network", label: "Out-of-network ATM", note: "Your bank's fee. The ATM owner may add a surcharge.", Icon: Banknote },
  { slug: "wire-transfer-fees", category: "wire_domestic_outgoing", label: "Outgoing wire", Icon: Send },
  { slug: "monthly-maintenance-fees", category: "monthly_maintenance", label: "Monthly maintenance", Icon: CalendarDays },
] as const;

/** The three tasks, as icon entrances under the header. */
const TASKS = [
  { href: "#find-bank", title: "Check your bank", line: "Its fees beside state and U.S. medians", Icon: Search },
  { href: "#charges", title: "Understand a charge", line: "What it is, how to avoid it", Icon: Receipt },
  { href: "#compare", title: "Compare local options", line: "Banks and credit unions near you", Icon: MapPin },
] as const;

/** The rest of the demo cast, one tap each; Capital City Bank is the example shown. */
const EXAMPLES = [
  { id: 5, name: "U.S. Bank" },
  { id: 21, name: "M&T Bank" },
  { id: 4956, name: "Navy Federal Credit Union" },
  { id: 6741, name: "SchoolsFirst FCU" },
] as const;

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;
const count = (n: number) => n.toLocaleString("en-US");

const BAND = "min-w-0 scroll-mt-24 border-t border-border pt-6";
/** The fee-check example: Capital City Bank, a well-covered demo institution. */
const CHECK_EXAMPLE_ID = 323;
const BAND_H2 = "text-[28px] font-medium leading-[1.08] tracking-[-0.02em] text-ink sm:text-left sm:text-[36px]";
const BAND_LINE = "mx-0 mt-1.5 text-left text-[15px] leading-relaxed text-ink-soft";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const CHIP =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-white/30 px-4 text-[14px] font-medium text-white hover:border-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const ICON_BADGE = "flex size-10 shrink-0 items-center justify-center rounded-full bg-brick-tint text-brick";

/** "/guides/atm-fees#find-cash" when that guide and section exist; the guide alone without the section. */
function guideHref(guides: Guide[], slug: string, section: string): string | null {
  const guide = guides.find((g) => g.slug === slug);
  if (!guide) return null;
  return `/guides/${slug}${guide.sections.some((s) => s.id === section) ? `#${section}` : ""}`;
}

/** The three tasks, as entrances in the band's right column; a row under the copy on a phone. */
function TaskList() {
  return (
    <nav aria-label="What you can do here">
      <ul className="grid gap-3">
        {TASKS.map(({ href, title, line, Icon }) => (
          <li key={href} className="min-w-0">
            <a
              href={href}
              className="flex min-h-11 items-center gap-3 rounded-xl bg-white/10 p-3 text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:p-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15" aria-hidden="true">
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{title}</span>
                <span className="block text-[13px] text-[#e0e9ee]">{line}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default async function ConsumerPage() {
  const [{ summary, categories }, guides, states, atmExample] = await Promise.all([
    getPublicSnapshot(),
    loadConsumerGuides().catch((error: unknown) => {
      console.error("Consumer page guides failed:", error);
      return [] as Guide[];
    }),
    getStatesWithFeeDataCached().catch((error: unknown) => {
      console.error("Consumer page states failed:", error);
      return [];
    }),
    getAtmTwoFeeExampleCached().catch((error: unknown) => {
      console.error("Consumer page ATM example failed:", error);
      return null;
    }),
  ]);
  const atmGuideHref = guideHref(guides, "atm-fees", "charged-twice");
  const summaryFor = new Map<string, FeeCategorySummary>(categories.map((c) => [c.fee_category, c]));
  const median = (category: string) => {
    const s = summaryFor.get(category);
    return s && s.median_amount != null ? { ...s, median_amount: s.median_amount } : null;
  };
  const asOf = summary.refreshedOn ? `, data as of ${summary.refreshedOn}` : "";

  // The five most-searched charges whose guides exist, each with its U.S. median.
  const charges = CHARGES.flatMap((charge) => {
    const guide = guides.find((g) => g.slug === charge.slug);
    if (!guide) return [];
    return [{ ...charge, stat: median(charge.category) }];
  });

  const stateOptions: StateOption[] = states
    .filter((s) => STATE_NAMES[s.state_code])
    .map((s) => ({ code: s.state_code, name: STATE_NAMES[s.state_code], institutions: s.institution_count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const unstatedShown = charges.some((c) => medianHasUnstatedAudience(c.stat));

  const example = await loadCheckExample(CHECK_EXAMPLE_ID, guides);

  return (
    <div className="min-h-screen overflow-x-clip bg-paper text-ink">
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "For consumers", href: "/consumer" }]} />
      {/* `relative z-20` keeps the search suggestions above the content below the band. */}
      <div className="relative z-20">
        <PageHero
          eyebrow="For consumers"
          title="Understand your bank fees. Find ways to pay less."
          aside={<TaskList />}
        >
          <div id="find-bank" className="max-w-xl scroll-mt-24">
            <InstitutionSearchBar resultPath="/check" ariaLabel="Your bank or credit union" placeholder="Your bank or credit union" />
          </div>
          <div className="mt-4">
            <p className="text-[13px] font-semibold text-[#c9d6de]">Or try</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <li key={ex.id}>
                  <Link href={`/check?id=${ex.id}`} className={CHIP}>
                    {ex.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </PageHero>
      </div>

      <div className={`${homeSerif.variable} ${PAGE_HERO_WRAP} pb-12 pt-8 sm:pb-16 sm:pt-10`}>
        <div className="space-y-10 sm:space-y-12">
          <section id="check" aria-labelledby="check-heading" className="min-w-0 scroll-mt-24">
            <h2 id="check-heading" className={BAND_H2} style={SERIF}>
              What a fee check shows
            </h2>
            <div className="mt-4">
              {example ? (
                <CheckExample example={example} />
              ) : (
                <p className={BAND_LINE}>
                  The example is not available right now.{" "}
                  <Link href={`/check?id=${CHECK_EXAMPLE_ID}`} className={LINK}>
                    Open the fee check
                  </Link>
                </p>
              )}
            </div>
          </section>

          <section id="charges" aria-labelledby="charges-heading" className={BAND}>
            <h2 id="charges-heading" className={BAND_H2} style={SERIF}>
              Understand a charge
            </h2>
            {charges.length > 0 ? (
              <ul className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
                {charges.map((charge, i) => {
                  const { slug, label, stat, Icon } = charge;
                  const note = "note" in charge ? charge.note : null;
                  return (
                    <li key={slug} className="fi-home-fade min-w-0" style={{ animationDelay: `${i * 60}ms` }}>
                      <Link
                        href={`/guides/${slug}`}
                        className="flex h-full min-h-11 items-center gap-3 rounded-xl border border-border bg-surface-0 p-3 hover:border-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:flex-col sm:items-start sm:gap-0 sm:p-4"
                      >
                        <span className={ICON_BADGE} aria-hidden="true">
                          <Icon className="size-5" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1 sm:flex sm:w-full sm:flex-1 sm:flex-col">
                          <span className="block text-[15px] font-semibold leading-snug text-ink sm:mt-3">{label}</span>
                          {stat && (
                            <span className="mt-0.5 block sm:mt-2">
                              <span className="font-mono text-[18px] font-semibold tabular-nums text-ink sm:block sm:text-[24px]">
                                {money(stat.median_amount)}
                                <UnstatedAudienceMark show={medianHasUnstatedAudience(stat)} />
                              </span>
                              <span className="ml-2 text-[12px] leading-snug text-ink-muted sm:ml-0 sm:block">
                                U.S. median, {count(stat.institution_count)} institutions
                              </span>
                            </span>
                          )}
                          {note && <span className="mt-1 block text-[12px] leading-snug text-ink-muted">{note}</span>}
                          <span className="mt-auto hidden pt-3 text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 sm:block">
                            How to avoid it
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={BAND_LINE}>The guides are not available right now.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6">
              <SourceNote>
                Published fee schedules of U.S. banks and credit unions, {PRODUCT_NAME}
                {asOf}; counts are institutions that list each fee.
              </SourceNote>
              <Link href="/guides" className={`inline-flex min-h-11 items-center text-[14px] font-semibold ${LINK}`}>
                {guides.length > 0 ? `All ${guides.length} guides` : "Fee guides"}
              </Link>
            </div>
          </section>

          {atmExample && (
            <section id="atm" aria-labelledby="atm-heading" className={`${BAND} grid items-center gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10`}>
              <div className="min-w-0">
                <h2 id="atm-heading" className={BAND_H2} style={SERIF}>
                  One ATM withdrawal, two fees
                </h2>
                <p className={BAND_LINE}>Your bank charges one. The ATM&apos;s owner can add another.</p>
                {atmGuideHref && (
                  <Link href={atmGuideHref} className={`mt-1 inline-flex min-h-11 items-center text-[14px] font-semibold ${LINK}`}>
                    How to avoid both
                  </Link>
                )}
              </div>
              <div className="flex min-w-0 justify-center sm:justify-start">
                <AtmReceipt example={atmExample} />
              </div>
            </section>
          )}

          <section id="compare" aria-labelledby="compare-heading" className={BAND}>
            <h2 id="compare-heading" className={BAND_H2} style={SERIF}>
              Compare local options
            </h2>
            <div className="mt-4 max-w-4xl">
              {stateOptions.length > 0 ? (
                <StatePicker states={stateOptions} initial="FL" />
              ) : (
                <p className={BAND_LINE}>The state list is not available right now.</p>
              )}
            </div>
          </section>
        </div>

        <div className="mt-10">
          <HamiltonEmployeeBand name="a bank or credit union" placement="consumer_employee_band" />
        </div>

        <div className="mt-6">
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
