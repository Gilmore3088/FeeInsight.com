/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown invalidates
 * the public read cache its read carries (#1811). The page reads no session, cookies or search
 * params; the explorer reads `?city=` in the browser. A render whose city list came back empty
 * is cached for a minute instead (`shortenPageLife`, as the homepage), so a failed read is retried.
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_HERO_WRAP, PageHero } from "@/components/public/page-hero";
import { SITE_URL } from "@/lib/constants";
import { getStateLocalEconomyCached, getStateMarketCitiesCached } from "@/lib/data-store/public-cached-reads";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { cityKey, correctSpelling } from "@/lib/geo/city-names";
import { createReadBudget } from "@/lib/read-deadline";
import { displayCity } from "@/lib/format";
import { stateMarketMap } from "@/lib/geo/state-market-map";
import { CitySearch, ExplorerMap, SelectedCity, StateExplorer, type ExplorerCity } from "./state-explorer";
import { CityList } from "./city-list";

interface PageProps {
  params: Promise<{ state: string }>;
}

/** Nothing is rendered at build time; each state renders on its first visit, then from cache. */
export function generateStaticParams() {
  return [];
}

/** The local economy block's read: optional, so a slow read leaves the block's unavailable note, not a held page. */
const ECONOMY_READ_BUDGET_MS = 8_000;

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  if (!stateName) notFound();

  return {
    title: `Compare Bank and Credit Union Fees in ${stateName}`,
    // ?city= only changes which city the explorer opens on; one URL per state.
    alternates: { canonical: `/fees/city/${state.toLowerCase()}` },
    description: `Compare the published fees of the banks and credit unions with branches in each ${stateName} city: overdraft, monthly maintenance, ATM and more, each with its source.`,
  };
}

export default async function StateCityDirectory({ params }: PageProps) {
  const { state } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];

  if (!stateName) notFound();

  const budget = createReadBudget(ECONOMY_READ_BUDGET_MS, "State city explorer");
  const [cities, economy] = await Promise.all([
    getStateMarketCitiesCached(stateCode),
    budget.optional(getStateLocalEconomyCached(stateCode, stateName), "local economy", null),
  ]);
  if (cities.length === 0 || budget.failed()) await shortenPageLife();
  // getStateMarketCities folds each city's spellings into one and ranks by institutions with a branch there, most first.
  const links: ExplorerCity[] = cities.map((c) => ({
    key: c.city.toLowerCase(),
    economyKey: cityKey(c.city),
    // Hyphens kept: WINSTON-SALEM reads "Winston-Salem".
    name: correctSpelling(displayCity(c.city)),
    href: `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(c.city.toLowerCase())}`,
    institutions: c.institutions,
    withFees: c.with_fees,
  }));
  // Each city sits at the middle of its branches' recorded coordinates; a city without any is listed but not drawn.
  const map = links.length
    ? stateMarketMap(
        stateCode,
        cities.flatMap((c) => (c.lat != null && c.lon != null ? [{ key: c.city.toLowerCase(), lat: c.lat, lon: c.lon }] : [])),
      )
    : null;

  const crumbs = (
    <>
      <Link href="/fees">Fees</Link>
      <span aria-hidden="true">/</span>
      <span>{stateName}</span>
    </>
  );
  const title = `Compare bank and credit union fees in ${stateName}`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: "Fees", href: `${SITE_URL}/fees` },
          { name: stateName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}` },
        ]}
      />

      {links.length > 0 ? (
        <StateExplorer map={map} cities={links} stateName={stateName} economy={economy}>
          <PageHero
            crumbs={crumbs}
            title={title}
            lede="Choose a city to explore published fees at institutions with local branches."
            aside={<SelectedCity />}
          >
            <CitySearch />
          </PageHero>
          <div className={`${PAGE_HERO_WRAP} pb-10 pt-10 text-left sm:pt-14`}>
            <div className={map ? "grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start" : ""}>
              <CityList cities={links} stateName={stateName} />
              {map && <ExplorerMap />}
            </div>
            <p className="mt-6 max-w-[46rem] text-[12px] text-ink-muted">
              Sources: FDIC Summary of Deposits, NCUA branch records, U.S. Census Bureau outlines. A city is listed once at least
              one bank or credit union with a branch there has published fees. Spellings of one city in the branch records
              (Saint, St and St., for example) are counted as one city, and each institution once.
            </p>
          </div>
        </StateExplorer>
      ) : (
        <PageHero
          crumbs={crumbs}
          title={title}
          lede={`No ${stateName} city has an institution with published fees yet.`}
        />
      )}

      <nav aria-label="More fee pages" className={`${PAGE_HERO_WRAP} flex flex-wrap gap-x-6 gap-y-2 border-t border-border pb-16 pt-8 text-[14px]`}>
        <Link href={`/research/state/${stateCode}`} className={LINK}>
          {stateName} fee report
        </Link>
        <Link href="/institutions" className={LINK}>
          Search institutions
        </Link>
        <Link href="/fees" className={LINK}>
          Every fee category
        </Link>
      </nav>
    </>
  );
}
