export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { formatAssets } from "@/lib/format";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { SITE_URL } from "@/lib/constants";
import { buildHistogram } from "@/components/public/distribution-chart";
import { StateVideo } from "../../../../research/state/[code]/state-exhibits";
import { loadCityInstitutions, titleCase } from "./city-lookup";
import { CityStripChart } from "./city-exhibits";
import { HEADLINE_FEES, MIN_FOR_CITY_MEDIAN, cityFindings, cityStrips, money, stripScale, type CityStrip } from "./city-view";

interface PageProps {
  params: Promise<{ state: string; city: string }>;
}

/** Cities with fewer verified institutions than this are thin pages: rendered, not indexed. */
const MIN_INDEXABLE_INSTITUTIONS = 3;

const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";
const COLUMNS = "sm:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state, city } = await params;
  const stateName = STATE_NAMES[state.toUpperCase()];
  const cityName = titleCase(city);
  if (!stateName) notFound();

  const institutions = await loadCityInstitutions(cityName, state.toUpperCase());
  if (institutions.length === 0) notFound();
  const indexable = institutions.length >= MIN_INDEXABLE_INSTITUTIONS;

  return {
    robots: { index: indexable, follow: true },
    // One address per city: "little-rock" and "little%20rock" render the same page, and the
    // sitemap and breadcrumbs use the encoded lowercase name.
    alternates: { canonical: `/fees/city/${state.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}` },
    title: `Bank Fees in ${cityName}, ${state.toUpperCase()} - Compare Local Fees`,
    description: `Compare bank and credit union fees in ${cityName}, ${stateName}. See overdraft fees, monthly maintenance charges, NSF fees, and more from local institutions.`,
    keywords: [
      `${cityName} bank fees`,
      `${cityName} ${stateName} overdraft fees`,
      `banks in ${cityName}`,
      `credit unions in ${cityName}`,
      `${cityName} checking account fees`,
    ],
  };
}

/** One institution's amount on a fee, as a dot on the U.S. middle half. */
function RangeCell({ amount, strip }: { amount: number | null; strip: CityStrip }) {
  if (amount == null) return <span className="block text-right text-ink-muted">-</span>;
  const x = stripScale(strip);
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="relative block h-3 w-10 sm:w-14" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 border-t border-border" />
        {strip.nation && (
          <span
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brick-tint"
            style={{ left: `${x(strip.nation.p25)}%`, width: `${Math.max(x(strip.nation.p75) - x(strip.nation.p25), 1)}%` }}
          />
        )}
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${x(amount)}%` }} />
      </span>
      <span className="w-12 text-right font-mono tabular-nums text-ink">{money(amount)}</span>
    </span>
  );
}

export default async function CityFeePage({ params }: PageProps) {
  const { state, city } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const cityName = titleCase(city);

  if (!stateName) notFound();

  const institutions = await loadCityInstitutions(cityName, stateCode);
  if (institutions.length === 0) notFound();

  const [nationalIndex, summary] = await Promise.all([getPublicNationalIndex(), getPublicStatsSummary()]);
  const asOf = summary.refreshedOn;
  const strips = cityStrips(institutions, nationalIndex);
  const findings = cityFindings(strips, cityName);
  const stripFor = (key: string) => strips.find((s) => s.key === key)!;

  const bankCount = institutions.filter((i) => i.charter_type === "bank").length;
  const cuCount = institutions.filter((i) => i.charter_type === "credit_union").length;
  const overdraftBars = buildHistogram(stripFor("overdraft").banks.map((b) => b.amount)).map((b) => b.count);
  const cityHref = `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}`;
  const compared = strips.filter((s) => s.cityMedian != null && s.nation);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: "Fees", href: `${SITE_URL}/fees` },
          { name: stateName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}` },
          { name: cityName, href: `${SITE_URL}${cityHref}` },
        ]}
      />

      {/* 1. The answer: who charges what here, against the nation. */}
      <section className="border-b border-border bg-paper">
        <div className="mx-auto grid max-w-page gap-8 px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-12">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Link href="/fees" className="hover:text-ink">Fees</Link>
              <span aria-hidden="true">/</span>
              <Link href={`/fees/city/${stateCode.toLowerCase()}`} className="hover:text-ink">{stateName}</Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink-soft">{cityName}</span>
            </nav>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">
              {cityName} bank fees
            </h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              {institutions.length} {institutions.length === 1 ? "institution" : "institutions"} with published fees: {bankCount}{" "}
              {bankCount === 1 ? "bank" : "banks"}, {cuCount} {cuCount === 1 ? "credit union" : "credit unions"}.
            </p>
            {findings.length > 0 && (
              <ul className="mt-5 space-y-2.5">
                {findings.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[15px] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brick" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <CityStripChart strips={strips} cityName={cityName} />
        </div>
      </section>

      {/* 2. Every local institution, four fees, each against the U.S. middle half. */}
      <section aria-labelledby="compare-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
        <h2 id="compare-heading" className={H2}>
          Compare {cityName}&apos;s institutions
        </h2>
        <p className="mt-1 text-[14px] text-ink-muted">Largest first. The shaded band is the U.S. middle half for each fee.</p>
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface-0 shadow-fi-1">
          <div className={`hidden border-b border-border bg-paper px-5 py-2 text-[12px] font-medium text-ink-muted sm:grid sm:gap-4 ${COLUMNS}`} aria-hidden="true">
            <span>Institution</span>
            {HEADLINE_FEES.map((fee) => (
              <span key={fee.key} className="text-right">{fee.label}</span>
            ))}
          </div>
          <ul className="divide-y divide-border">
            {institutions.map((inst) => (
              <li key={inst.id} className={`grid gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:px-5 ${COLUMNS}`}>
                <div className="min-w-0">
                  <Link href={`/institution/${inst.id}`} className="font-semibold text-ink underline decoration-transparent underline-offset-4 hover:decoration-ink">
                    {inst.institution_name}
                  </Link>
                  <p className="text-[12px] text-ink-muted">
                    {inst.charter_type === "credit_union" ? "Credit union" : "Bank"}
                    {inst.asset_size ? ` · ${formatAssets(inst.asset_size)}` : ""} · {inst.fee_count} fees
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:contents">
                  {HEADLINE_FEES.map((fee) => (
                    <div key={fee.key} className="flex items-center justify-between gap-2 sm:block">
                      <dt className="text-ink-muted sm:sr-only">{fee.label}</dt>
                      <dd>
                        <RangeCell amount={inst[fee.key]} strip={stripFor(fee.key)} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. The city against the nation, fee by fee. */}
      {compared.length > 0 && (
        <section aria-labelledby="nation-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
          <h2 id="nation-heading" className={H2}>
            {cityName} against the U.S.
          </h2>
          <p className="mt-1 text-[14px] text-ink-muted">Medians of the institutions that publish each fee.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {compared.map((s) => {
              const diff = s.cityMedian! - s.nation!.median;
              const top = Math.max(s.cityMedian!, s.nation!.median, 1);
              return (
                <li key={s.key} className="rounded-2xl border border-border bg-surface-0 p-4">
                  <Link href={`/fees/${s.key}`} className="text-[14px] font-semibold text-ink hover:text-brick">
                    {s.label}
                  </Link>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    {Math.abs(diff) < 0.5 ? "Same as the U.S." : `${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the U.S.`}
                  </p>
                  <div className="mt-3 space-y-2 text-[12px]">
                    {[
                      { name: cityName, value: s.cityMedian!, bar: "bg-ink" },
                      { name: "U.S.", value: s.nation!.median, bar: "bg-brick/70" },
                    ].map((row) => (
                      <div key={row.name} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2">
                        <span className="truncate text-ink-soft">{row.name}</span>
                        <span className="h-2.5 rounded-full bg-paper" aria-hidden="true">
                          <span className={`block h-full rounded-full ${row.bar}`} style={{ width: `${(row.value / top) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono tabular-nums text-ink">{money(row.value)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-ink-muted">{s.banks.length} local institutions</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="mx-auto max-w-page px-4 pt-6 text-[12px] text-ink-muted sm:px-6">
        From {institutions.length} {cityName} {institutions.length === 1 ? "institution's" : "banks and credit unions'"} own published fee
        schedules, one value per institution; a local median needs at least {MIN_FOR_CITY_MEDIAN}. {asOf ? `Data as of ${asOf}. ` : ""}
        <Link href="/methodology" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          How we build it
        </Link>
      </p>

      {/* 4. The video, in its own section, after the answer. */}
      <StateVideo stateName={cityName} bars={overdraftBars} title={`Watch ${cityName}'s banks take their place`} />

      {/* 5. Staff of a local bank or credit union: Hamilton shows this view of their own competitors. */}
      <section className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-0 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <p className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Work at one of these banks or credit unions?</p>
            <p className="mt-1 max-w-[36rem] text-[14px] text-ink-muted">
              Hamilton keeps this comparison of your own competitors current, with the source for every fee.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "city_staff_band" }}
              href={PRO_PLANS_NAV.href}
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
            <Link href={DEMO_REQUEST_NAV.href} className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
              {DEMO_REQUEST_NAV.label}
            </Link>
          </div>
        </div>
      </section>

      <nav aria-label="More fee pages" className="mx-auto flex max-w-page flex-wrap gap-x-6 gap-y-2 px-4 pb-16 pt-8 text-[14px] sm:px-6">
        <Link href={`/fees/city/${stateCode.toLowerCase()}`} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          More cities in {stateName}
        </Link>
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
