export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";
import { US_STATES } from "@/lib/us-map-paths";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";
import { getCitiesInStateCached } from "@/lib/data-store/public-cached-reads";
import { CityList, type CityLink } from "./city-list";
import { titleCase } from "../[city]/city-lookup";

interface PageProps {
  params: Promise<{ state: string }>;
}

/** Cities drawn as bars before the full list. */
const TOP_CITIES = 10;

const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  if (!stateName) notFound();

  return {
    title: `Bank Fees by City in ${stateName} - Local Fee Comparison`,
    description: `Compare bank fees by city in ${stateName}. Find banks and credit unions with lower fees in your area. Overdraft fees, monthly charges, and more.`,
    keywords: [
      `${stateName} bank fees by city`,
      `${stateName} banks with lower fees`,
      `${stateName} bank fee comparison`,
      `${stateName} credit union fees`,
    ],
  };
}

/** The country with this state lit: where the reader is, at a glance. */
function StateLocator({ stateCode }: { stateCode: string }) {
  return (
    <svg viewBox="0 0 960 600" className="h-auto w-full" aria-hidden="true">
      {US_STATES.map((s) => (
        <path
          key={s.id}
          d={s.d}
          className={`${s.id === stateCode ? "fill-[#c8553f]" : "fill-[#ece4d8]"} stroke-[#fbf7f1]`}
          strokeWidth={1.2}
        />
      ))}
    </svg>
  );
}

export default async function StateCityDirectory({ params }: PageProps) {
  const { state } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];

  if (!stateName) notFound();

  const cities = await getCitiesInStateCached(stateCode);
  const institutions = cities.reduce((s, c) => s + c.with_fees, 0);
  const links: CityLink[] = cities.map((c) => ({
    name: titleCase(c.city),
    href: `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(c.city.toLowerCase())}`,
    withFees: c.with_fees,
  }));
  // getCitiesInState ranks by institutions with published fees, most first.
  const top = links.slice(0, TOP_CITIES);
  const most = Math.max(...top.map((c) => c.withFees), 1);

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
        <div className="mx-auto grid max-w-page gap-6 px-4 pb-10 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center lg:gap-12">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Link href="/fees" className="hover:text-ink">Fees</Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink-soft">{stateName}</span>
            </nav>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">
              {stateName} bank fees by city
            </h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              {cities.length > 0
                ? `${cities.length} ${cities.length === 1 ? "city" : "cities"}, ${institutions} ${institutions === 1 ? "institution" : "institutions"} with published fees. Pick yours to compare its banks.`
                : `No ${stateName} city has published fees yet.`}
            </p>
          </div>
          <div className="mx-auto w-full max-w-sm lg:max-w-none">
            <StateLocator stateCode={stateCode} />
          </div>
        </div>
      </section>

      {links.length > 0 && (
        <section aria-labelledby="all-heading" className="mx-auto max-w-page px-4 pt-10 sm:px-6 sm:pt-14">
          <h2 id="all-heading" className={`${H2} mb-4`}>
            Every city
          </h2>
          <CityList cities={links} stateName={stateName} />
        </section>
      )}

      {top.length > 0 && (
        <section aria-labelledby="top-heading" className="mx-auto max-w-page px-4 pt-10 sm:px-6 sm:pt-14">
          <h2 id="top-heading" className={H2}>
            Most institutions to compare
          </h2>
          <ol className="mt-4 max-w-3xl space-y-1.5">
            {top.map((c) => (
              <li key={c.href}>
                <Link
                  href={c.href}
                  className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-[14px] text-ink hover:bg-surface-0 sm:grid-cols-[12rem_minmax(0,1fr)_3rem]"
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="h-3 rounded-full bg-surface-0" aria-hidden="true">
                    <span className="block h-full rounded-full bg-brick" style={{ width: `${(c.withFees / most) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-ink">{c.withFees}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12px] text-ink-muted">Institutions with published fees in each city.</p>
        </section>
      )}

      <nav aria-label="More fee pages" className="mx-auto flex max-w-page flex-wrap gap-x-6 gap-y-2 px-4 pb-16 pt-10 text-[14px] sm:px-6">
        <Link href={`/research/state/${stateCode}`} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          {stateName} fee report
        </Link>
        <Link href="/fees" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          Every fee category
        </Link>
      </nav>
    </>
  );
}
