"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";
import { CheckList, CTA_PRIMARY, GLASS, H1, LEAD } from "@/components/public/site-look";

// Display form of the site domain for the "powered by" line under the product name.
const SITE_DOMAIN_DISPLAY = "FeeInsight.com";

// The request form sits in the bank section further down this page.
const REPORT_REQUEST_HREF = "#for-banks";
const INSTITUTION_REPORT_HREF = "/?report=institution#for-banks";

interface LandingHeroProps {
  institutionsLabel: string;
  /** Show the "Read the full sample" link: the live sample report exists today. */
  sampleLive?: boolean;
  /** The box beside the search on wide screens (the "What banks charge" medians). */
  aside?: ReactNode;
}

type PathKey = "lookup" | "explore" | "benchmark";

/** The three reasons people arrive, each with its own next step. Lookup is the default. */
const PATHS: { key: PathKey; label: string }[] = [
  { key: "lookup", label: "Find your bank's fees" },
  { key: "explore", label: "Explore fee data" },
  { key: "benchmark", label: "Benchmark your institution" },
];

const EXPLORE_LINKS = [
  {
    href: "/research/national-fee-index",
    title: "National fee index",
    body: "Typical prices and ranges for every fee type",
  },
  { href: "/fees", title: "Every fee, explained", body: "Overdraft, ATM, wire, monthly and more" },
  { href: "/research", title: "Research and state data", body: "Trends, state and district analysis" },
  { href: "/guides", title: "Guides", body: "How to avoid or reduce common fees" },
];

/** What an institution page shows today (src/app/(public)/institution/[id]). */
const LOOKUP_SHOWS = [
  "Every published fee, grouped by type",
  "Each fee beside the national and state medians",
  "A link to the fee schedule each figure came from",
];

/**
 * Hero: what the index is, then a three-way choice so each visitor gets one clear next step.
 * Looking up a bank is the default panel; bank staff switch to "Benchmark your institution",
 * which leads to the one report offer (explained in full further down the page).
 */
export function LandingHero({ institutionsLabel, sampleLive = false, aside }: LandingHeroProps) {
  const [active, setActive] = useState<PathKey>("lookup");
  const baseId = useId();
  const tabId = (key: PathKey) => `${baseId}-tab-${key}`;
  const panelId = (key: PathKey) => `${baseId}-panel-${key}`;

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = PATHS[(index + step + PATHS.length) % PATHS.length].key;
    setActive(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <section aria-labelledby="home-title">
      <div className="mx-auto max-w-page px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12 lg:pt-16">
        {/* The headline spans the page; the search and the medians sit side by side below it
            at desktop widths, in two boxes of the same size (the /subscribe layout). */}
        <div className="max-w-4xl">
          <h1 id="home-title" className={H1}>
            The {PRODUCT_NAME}
          </h1>
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B6255]">
            <span aria-hidden="true" className="h-px w-5 bg-[#C44B2E]/60" />
            Powered by <span className="text-[#5A5347]">{SITE_DOMAIN_DISPLAY}</span>
          </p>
          <p className={`mt-5 text-pretty ${LEAD}`}>
            What {/\d/.test(institutionsLabel) ? `${institutionsLabel} ` : ""}U.S. banks and credit unions charge, taken from their own
            published fee schedules. Free to search for anyone checking their bank; benchmarks for
            the banks themselves.
          </p>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-2 xl:items-stretch xl:gap-8">
        <div className={`flex min-w-0 flex-col p-5 sm:p-7 ${GLASS}`}>
        <div
          role="tablist"
          aria-label="What brings you here?"
          className="grid grid-cols-3 gap-1 rounded-2xl bg-[#F3EEE6] p-1 ring-1 ring-[#E8E1D6] sm:flex"
        >
          {PATHS.map((path, index) => {
            const selected = active === path.key;
            return (
              <button
                key={path.key}
                id={tabId(path.key)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId(path.key)}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(path.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={`min-h-11 cursor-pointer rounded-xl px-2 py-2 text-[13px] font-semibold leading-tight transition-colors duration-200 sm:flex-1 sm:px-4 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A93D25] ${
                  selected ? "bg-[#1A1815] text-white shadow-sm" : "text-[#5A5347] hover:bg-white/70 hover:text-[#1A1815]"
                }`}
              >
                {path.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 min-h-[132px] flex-1">
          <div
            id={panelId("lookup")}
            role="tabpanel"
            aria-labelledby={tabId("lookup")}
            hidden={active !== "lookup"}
          >
            <div role="search" aria-label="Search for a bank or credit union">
              <InstitutionSearchBar />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#5A5347]">
              Type a bank or credit union name to see its overdraft, ATM, wire and monthly fees.{" "}
              <Link href="/institutions" className="font-semibold text-[#A93D25] underline underline-offset-2 hover:text-[#8E2A17]">
                Browse by state
              </Link>
            </p>
            {/* What a lookup shows, so the box says what the search is for (the /subscribe checklist). */}
            <CheckList
              className="mt-6 border-t border-[#E8E1D6] pt-6"
              items={LOOKUP_SHOWS}
            />
          </div>

          <div
            id={panelId("explore")}
            role="tabpanel"
            aria-labelledby={tabId("explore")}
            hidden={active !== "explore"}
          >
            <ul className="grid gap-3 sm:grid-cols-2">
              {EXPLORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group block h-full min-h-11 rounded-xl bg-white/80 px-4 py-3.5 ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:ring-[#C44B2E]/40"
                  >
                    <span className="block text-[15px] font-semibold text-[#1A1815] group-hover:text-[#A93D25]">
                      {link.title} <span aria-hidden="true">→</span>
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug text-[#5A5347]">{link.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div
            id={panelId("benchmark")}
            role="tabpanel"
            aria-labelledby={tabId("benchmark")}
            hidden={active !== "benchmark"}
          >
            <p className="text-pretty text-base leading-relaxed text-[#1A1815]">
              See how your fees compare with your competitors&apos;, fee by fee, in a PDF you can
              take to your pricing committee. Start with a free national or Fed district report;
              the report for your institution starts at $300.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <TrackLink
                event="request_report_click"
                eventProps={{ placement: "home_hero" }}
                href={REPORT_REQUEST_HREF}
                className={CTA_PRIMARY}
              >
                {REPORT_OFFER.ctaLabel}
              </TrackLink>
              {/* The paid report keeps report=institution so the form below opens on it, price shown. */}
              <TrackLink
                event="request_report_click"
                eventProps={{ placement: "home_hero", report: "institution" }}
                href={INSTITUTION_REPORT_HREF}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-[#A93D25] underline underline-offset-4 hover:text-[#8E2A17]"
              >
                {REPORT_OFFER.institutionCtaLabel}, {REPORT_OFFER.priceLabel.toLowerCase()}
              </TrackLink>
              {sampleLive && (
                <Link
                  href="/reports/sample-competitive-fee-position"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-[#1A1815] underline underline-offset-4 hover:text-[#A93D25]"
                >
                  Read the full sample
                </Link>
              )}
            </div>
          </div>
        </div>
        </div>
        {aside}
        </div>
      </div>
    </section>
  );
}
