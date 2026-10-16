export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_CRUMBS, PAGE_H1, PAGE_HEADER, PAGE_LEDE } from "@/components/public/page-header";
import { SITE_URL } from "@/lib/constants";
import { getStateMarketCitiesCached } from "@/lib/data-store/public-cached-reads";
import { CityList, type CityLink } from "./city-list";
import { titleCase } from "../[city]/city-lookup";

interface PageProps {
  params: Promise<{ state: string }>;
}

/** Markets offered as one-tap links under the search. */
const SHORTCUTS = 6;

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  if (!stateName) notFound();

  return {
    title: `Bank Fees by City in ${stateName}`,
    description: `Compare the published fees of the banks and credit unions with branches in each ${stateName} city: overdraft, monthly maintenance, ATM and more, each with its source.`,
  };
}

export default async function StateCityDirectory({ params }: PageProps) {
  const { state } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];

  if (!stateName) notFound();

  const cities = await getStateMarketCitiesCached(stateCode);
  // getStateMarketCities ranks by institutions with a branch in the city, most first.
  const links: CityLink[] = cities.map((c) => ({
    name: titleCase(c.city),
    href: `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(c.city.toLowerCase())}`,
    institutions: c.institutions,
    withFees: c.with_fees,
  }));

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
                ? "Each city page compares the banks and credit unions with a branch there, using the fees they publish."
                : `No ${stateName} city has an institution with published fees yet.`}
            </p>
          </div>
          <div className="mt-6">
            <CityList cities={links} stateName={stateName} stateCode={stateCode} shortcuts={links.slice(0, SHORTCUTS)} />
          </div>
          <p className="mt-4 text-[12px] text-ink-muted">
            A city is listed once at least one bank or credit union with a branch there has published fees. Counts are
            institutions with a branch in the city, from the FDIC Summary of Deposits and NCUA branch records.
          </p>
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
