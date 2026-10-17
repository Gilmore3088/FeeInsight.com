export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_CRUMBS, PAGE_H1, PAGE_HEADER, PAGE_LEDE } from "@/components/public/page-header";
import { SITE_URL } from "@/lib/constants";
import { getStateMarketCitiesCached } from "@/lib/data-store/public-cached-reads";
import { stateMarketMap } from "@/lib/geo/state-market-map";
import { StateExplorer, type ExplorerCity } from "./state-explorer";
import { titleCase } from "../[city]/city-lookup";

interface PageProps {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ city?: string | string[]; q?: string | string[]; all?: string | string[] }>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const COUNT = new Intl.NumberFormat("en-US");

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  if (!stateName) notFound();

  return {
    title: `Bank Fees by City in ${stateName}`,
    // ?city=, ?q= and ?all= only change what the explorer shows; one URL per state.
    alternates: { canonical: `/fees/city/${state.toLowerCase()}` },
    description: `Compare the published fees of the banks and credit unions with branches in each ${stateName} city: overdraft, monthly maintenance, ATM and more, each with its source.`,
  };
}

export default async function StateCityDirectory({ params, searchParams }: PageProps) {
  const { state } = await params;
  const query = await searchParams;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];

  if (!stateName) notFound();

  const cities = await getStateMarketCitiesCached(stateCode);
  // getStateMarketCities ranks by institutions with a branch in the city, most first.
  const links: ExplorerCity[] = cities.map((c) => ({
    key: c.city.toLowerCase(),
    name: titleCase(c.city),
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
  const asked = first(query.city).toLowerCase();
  const initialCity = links.some((l) => l.key === asked) ? asked : (links[0]?.key ?? "");

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: "Fees", href: `${SITE_URL}/fees` },
          { name: stateName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}` },
        ]}
      />

      <section className="border-b border-border bg-paper">
        <div className="mx-auto max-w-page px-4 pb-10 pt-6 sm:px-6 sm:pt-10">
          <div className={PAGE_HEADER}>
            <nav aria-label="Breadcrumb" className={PAGE_CRUMBS}>
              <Link href="/fees" className="hover:text-ink">Fees</Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink-soft">{stateName}</span>
            </nav>
            <h1 className={`mt-4 ${PAGE_H1}`}>
              {stateName} bank fees by city
            </h1>
            <p className={`mt-2 ${PAGE_LEDE}`}>
              {links.length > 0
                ? `${COUNT.format(links.length)} ${stateName} ${links.length === 1 ? "city has" : "cities have"} at least one bank or credit union with published fees. Each city page compares them.`
                : `No ${stateName} city has an institution with published fees yet.`}
            </p>
          </div>
          {links.length > 0 && (
            <StateExplorer
              map={map}
              cities={links}
              initialCity={initialCity}
              initialQuery={first(query.q)}
              initialAll={first(query.all) === "1"}
              stateName={stateName}
              stateCode={stateCode}
            />
          )}
          <p className="mt-6 text-[12px] text-ink-muted sm:mx-0 sm:text-left">
            Sources: FDIC Summary of Deposits, NCUA branch records, U.S. Census Bureau outlines. Counts are institutions with a
            branch in the city.
          </p>
          <details className="mt-2 text-[12px] text-ink-muted">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-ink underline decoration-border underline-offset-4">
              How the map is drawn
            </summary>
            <p className="mt-1 sm:mx-0 sm:text-left">
              A city is listed once at least one institution with a branch there has published fees. Each marker sits at the
              middle of the city&apos;s branch locations and is sized by institutions with a branch there.
            </p>
          </details>
        </div>
      </section>

      <nav aria-label="More fee pages" className="mx-auto flex max-w-page flex-wrap gap-x-6 gap-y-2 px-4 pb-16 pt-10 text-[14px] sm:px-6">
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
