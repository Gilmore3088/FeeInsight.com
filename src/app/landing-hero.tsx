"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent } from "react";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, REPORT_OFFER } from "@/lib/constants";

// Display form of the site domain for the "powered by" line under the product name.
const SITE_DOMAIN_DISPLAY = "FeeInsight.com";

const REPORT_REQUEST_HREF = "/for-institutions#report";

interface LandingHeroProps {
  institutionsLabel: string;
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

/**
 * Hero: what the index is, then a three-way choice so each visitor gets one clear next step.
 * Looking up a bank is the default panel; bank staff switch to "Benchmark your institution",
 * which leads to the one report offer (explained in full further down the page).
 */
export function LandingHero({ institutionsLabel }: LandingHeroProps) {
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
    <section className="border-b border-[#E0D7C9] bg-[#FAF7F2]">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-12 lg:pt-14">
        <div className="max-w-3xl">
          <h1
            className="text-[clamp(2.25rem,8vw,3.75rem)] font-normal leading-none tracking-[-0.01em] text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            The {PRODUCT_NAME}
          </h1>
          <p className="mt-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A8072]">
            <span aria-hidden="true" className="h-px w-5 bg-[#C44B2E]/60" />
            Powered by <span className="text-[#5A5347]">{SITE_DOMAIN_DISPLAY}</span>
          </p>
          <p className="mt-5 text-[16px] leading-relaxed text-[#3D3830] sm:text-[18px]">
            What {institutionsLabel} U.S. banks and credit unions charge, taken from their own
            published fee schedules. Free to search for anyone checking their bank; benchmarks for
            the banks themselves.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="What brings you here?"
          className="mt-7 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-[#E0D7C9] bg-white/70 p-1"
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
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C44B2E]/40 sm:px-4 ${
                  selected ? "bg-[#1A1815] text-white" : "text-[#5A5347] hover:text-[#1A1815]"
                }`}
              >
                {path.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 min-h-[132px]">
          <div
            id={panelId("lookup")}
            role="tabpanel"
            aria-labelledby={tabId("lookup")}
            hidden={active !== "lookup"}
            className="max-w-2xl"
          >
            <div role="search" aria-label="Search for a bank or credit union">
              <InstitutionSearchBar />
            </div>
            <p className="mt-3 text-[13px] text-[#6B6255]">
              Type a bank or credit union name to see its overdraft, ATM, wire and monthly fees.{" "}
              <Link href="/institutions" className="font-semibold text-[#A93D25] hover:text-[#8E2A17]">
                Browse by state
              </Link>
            </p>
          </div>

          <div
            id={panelId("explore")}
            role="tabpanel"
            aria-labelledby={tabId("explore")}
            hidden={active !== "explore"}
          >
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {EXPLORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group block h-full rounded-lg border border-[#E0D7C9] bg-white px-4 py-3.5 transition-colors hover:border-[#C44B2E]/40"
                  >
                    <span className="block text-[14px] font-semibold text-[#1A1815] group-hover:text-[#A93D25]">
                      {link.title} <span aria-hidden="true">→</span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-[#6B6255]">{link.body}</span>
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
            className="max-w-2xl"
          >
            <p className="text-[16px] leading-relaxed text-[#1A1815]">
              See how your fees compare with your competitors&apos;, fee by fee, in a PDF you can
              take to your pricing committee. Free for your institution ({REPORT_OFFER.valueLabel}),{" "}
              {REPORT_OFFER.turnaround}.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <TrackLink
                event="request_report"
                eventProps={{ placement: "home_hero" }}
                href={REPORT_REQUEST_HREF}
                className="inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
              >
                {REPORT_OFFER.ctaLabel}
              </TrackLink>
              <a
                href="#for-banks"
                className="text-sm font-semibold text-[#1A1815] underline-offset-4 hover:text-[#A93D25] hover:underline"
              >
                What&apos;s in the report ↓
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
