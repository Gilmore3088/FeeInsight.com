import Link from "next/link";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { SITE_NAME } from "@/lib/constants";
import type { NationalIndicator, NationalIndicators } from "@/lib/data-store/economic-context";
import { HubSection, signedPct } from "./district/[id]/district-hub";
import { monthYear } from "./district/[id]/district-hub-view";

/**
 * The hub's front door to the public economic, market and national data the site shows,
 * grouped by what a reader wants to know. Every card links to a page a signed-out reader can
 * open; data that lives inside the district and state reports links to the district list at
 * the end of the section. The paid-only analyses (fee revenue, market concentration) are left
 * out because a signed-out reader sees only an upgrade gate there.
 */

export interface DataCard {
  title: string;
  /** What it shows, in one plain line. */
  line: string;
  /** The agency or publisher the data comes from. */
  source: string;
  href: string;
}

export interface DataGroup {
  id: string;
  title: string;
  cards: DataCard[];
}

/** Where the district-level datasets point: the list of the 12 district reports below. */
export const DISTRICT_LIST_ANCHOR = "#district-reports";
const FEE_SCHEDULES = "Bank and credit union fee schedules";

export const DATA_GROUPS: readonly DataGroup[] = [
  {
    id: "data-fees",
    title: "Fees and prices",
    cards: [
      {
        title: "National fee index",
        line: "U.S. medians for the main fees, beside the price index for bank services.",
        source: `${FEE_SCHEDULES}; BLS`,
        href: "/research/national-fee-index",
      },
      {
        title: "Every fee category",
        line: "The median, the spread and state comparisons for each fee we track.",
        source: FEE_SCHEDULES,
        href: "/fees",
      },
      {
        title: "Overdraft and NSF price check",
        line: "Where one overdraft or NSF fee sits among the institutions in its state.",
        source: FEE_SCHEDULES,
        href: "/tools/price-check",
      },
      {
        title: "Fees city by city",
        line: "Pick a state above. Its report opens on the cities where you can compare local fees.",
        source: `${FEE_SCHEDULES}; FDIC and NCUA branch data`,
        href: "#explore",
      },
    ],
  },
  {
    id: "data-finances",
    title: "Bank finances and markets",
    cards: [
      {
        title: "Fee income",
        line: "Quarterly service charge income for banks and fee income for credit unions, in the district and state reports.",
        source: "FDIC and NCUA call reports",
        href: DISTRICT_LIST_ANCHOR,
      },
      {
        title: "Deposit share and branches",
        line: "Which banks hold the most deposits in an area, and how many branches serve it.",
        source: "FDIC Summary of Deposits; NCUA",
        href: DISTRICT_LIST_ANCHOR,
      },
      {
        title: "Institution profiles",
        line: "One bank's or credit union's published fees beside its financials and regulatory record.",
        source: "FDIC, NCUA, SEC and OCC",
        href: "/institutions",
      },
      {
        title: "Fee complaints",
        line: "Fee-related complaints per $1 billion of deposits, in the district reports.",
        source: "CFPB",
        href: DISTRICT_LIST_ANCHOR,
      },
    ],
  },
  {
    id: "data-economy",
    title: "Economy and policy",
    cards: [
      {
        title: "Beige Book",
        line: "What the Federal Reserve hears about each district's economy, from its latest edition.",
        source: "Federal Reserve",
        href: DISTRICT_LIST_ANCHOR,
      },
      {
        title: "Jobs, prices and income",
        line: "Unemployment by state, bank services prices and median household income, in the district reports.",
        source: "BLS; Census Bureau",
        href: DISTRICT_LIST_ANCHOR,
      },
    ],
  },
  {
    id: "data-method",
    title: "Sources and method",
    cards: [
      {
        title: "Data sources",
        line: "Every public source we use, what we take from it and how often it refreshes.",
        source: "FDIC, NCUA, BLS, BEA, Federal Reserve, CFPB, Census",
        href: "/research/data-sources",
      },
      {
        title: "Methodology",
        line: "How each fee is found, read, checked against its schedule and published.",
        source: SITE_NAME,
        href: "/methodology",
      },
    ],
  },
];

export const DISTRICT_REPORT_LINKS = Array.from({ length: 12 }, (_, i) => i + 1).map((id) => ({
  id,
  name: DISTRICT_NAMES[id] ?? `District ${id}`,
  href: `/research/district/${id}`,
}));

export interface IndicatorTile {
  key: string;
  label: string;
  value: string;
  /** The month the figure is for, as "Sep 2026". */
  date: string;
  source: string;
}

/** The 12-month change, or null without a reading a year earlier. */
function yearChange(ind: NationalIndicator | null): number | null {
  if (!ind?.year_ago || ind.year_ago.value === 0) return null;
  return (ind.latest.value / ind.year_ago.value - 1) * 100;
}

/** The strip's tiles, in order; a series that wasn't read is left out, never shown as 0. */
export function nationalIndicatorTiles(ind: NationalIndicators | null): IndicatorTile[] {
  if (!ind) return [];
  const tiles: IndicatorTile[] = [];
  if (ind.unemployment) {
    tiles.push({
      key: "unemployment",
      label: "U.S. unemployment rate",
      value: `${ind.unemployment.latest.value.toFixed(1)}%`,
      date: monthYear(ind.unemployment.latest.date),
      source: "BLS",
    });
  }
  if (ind.fed_funds) {
    tiles.push({
      key: "fed_funds",
      label: "Federal funds rate, monthly average",
      value: `${ind.fed_funds.latest.value.toFixed(2)}%`,
      date: monthYear(ind.fed_funds.latest.date),
      source: "Federal Reserve Board",
    });
  }
  const allItems = yearChange(ind.cpi_all_items);
  if (ind.cpi_all_items && allItems !== null) {
    tiles.push({
      key: "cpi_all_items",
      label: "Consumer prices, 12-month change",
      value: signedPct(allItems),
      date: monthYear(ind.cpi_all_items.latest.date),
      source: "BLS CPI",
    });
  }
  const bank = yearChange(ind.cpi_bank_services);
  if (ind.cpi_bank_services && bank !== null) {
    tiles.push({
      key: "cpi_bank_services",
      label: "Bank services prices, 12-month change",
      value: signedPct(bank),
      date: monthYear(ind.cpi_bank_services.latest.date),
      source: "BLS CPI",
    });
  }
  return tiles;
}

const CARD_LINK =
  "group flex h-full min-h-11 flex-col rounded-lg border border-border bg-white p-4 transition-colors hover:border-ink focus-visible:border-ink";

function Card({ card }: { card: DataCard }) {
  const body = (
    <>
      <span className="text-[15px] font-semibold text-ink underline decoration-transparent underline-offset-4 group-hover:decoration-ink">
        {card.title}
      </span>
      <span className="mt-1 text-[13.5px] leading-snug text-ink-soft">{card.line}</span>
      <span className="mt-auto pt-3 text-[12px] text-ink-muted">Source: {card.source}</span>
    </>
  );
  // Same-page anchors are plain links; pages go through Link.
  return card.href.startsWith("#") ? (
    <a href={card.href} className={CARD_LINK}>
      {body}
    </a>
  ) : (
    <Link href={card.href} className={CARD_LINK}>
      {body}
    </Link>
  );
}

export function NationalIndicatorStrip({ indicators }: { indicators: NationalIndicators | null }) {
  const tiles = nationalIndicatorTiles(indicators);
  if (tiles.length === 0) {
    return (
      <p className="text-[14px] text-ink-muted">The latest national indicators aren&apos;t available right now. Try again in a minute.</p>
    );
  }
  return (
    <dl aria-label="Latest national indicators" className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.key} className="flex flex-col-reverse border-l-2 border-brick pl-4">
          <dt className="mt-2 text-[13px] leading-snug text-ink-soft">
            {t.label}, {t.date}
            <span className="block text-[12px] text-ink-muted">{t.source}</span>
          </dt>
          <dd className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EconomicData({ indicators }: { indicators: NationalIndicators | null }) {
  return (
    <HubSection
      id="economic-data"
      kicker="Economic and market data"
      title="The public data behind our research"
      line="Find it by what you want to know. Each card names the agency the data comes from."
      source={
        <>
          Unemployment and consumer prices: Bureau of Labor Statistics. Federal funds rate: Federal Reserve Board, H.15. Each figure
          is the latest month its publisher has released that we have on file. The{" "}
          <Link href="/research/data-sources" className="underline decoration-border underline-offset-4 hover:text-ink">
            data sources page
          </Link>{" "}
          lists every source and how often it refreshes.
        </>
      }
    >
      <NationalIndicatorStrip indicators={indicators} />
      <div className="space-y-10">
        {DATA_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`${group.id}-heading`}>
            <h3 id={`${group.id}-heading`} className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
              {group.title}
            </h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {group.cards.map((card) => (
                <li key={card.title}>
                  <Card card={card} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section id="district-reports" aria-labelledby="district-reports-heading" className="scroll-mt-28">
          <h3 id="district-reports-heading" className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
            Federal Reserve district reports
          </h3>
          <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
            Fee income, deposit share, complaints, the Beige Book and local jobs and income data, for each of the 12 districts.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4">
            {DISTRICT_REPORT_LINKS.map((d) => (
              <li key={d.id}>
                <Link
                  href={d.href}
                  className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                >
                  <span className="font-mono text-[12px] tabular-nums text-ink-muted">{d.id}</span>
                  {d.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </HubSection>
  );
}
