export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { formatFeeAmount } from "@/lib/format";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { DistributionChart } from "@/components/public/distribution-chart";
import { CountyPriceMap, type CountyDetail } from "@/components/public/county-price-map";
import { countyFeatures } from "@/lib/geo/counties";
import { getNationalIndexCached } from "@/lib/data-store/fee-index";
import { getCountyFeeMapCached, getStateDemographicsCached } from "@/lib/data-store/public-cached-reads";
import { countyPriceMap, PRICE_MAP_FILLS, PRICE_MAP_LEGEND, priceStep } from "@/lib/report-templates/base/state-charts";
import {
  charterChecks,
  marketChecks,
  type GroupCheck,
  isPriceCheckFee,
  loadStatePricesCached,
  parsePrice,
  priceCheck,
  PRICE_CHECK_FEES,
  type PriceCheckFee,
} from "@/lib/price-check";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const FEE_LABEL: Record<PriceCheckFee, string> = { overdraft: "Overdraft fee", nsf: "NSF (returned item) fee" };
const FEE_NOUN: Record<PriceCheckFee, string> = { overdraft: "overdraft fee", nsf: "NSF fee" };
const SHOWN = 25;

export const metadata: Metadata = {
  title: "Overdraft and NSF Fee Price Check by State",
  description:
    "Enter any overdraft or NSF fee and a state to see how many institutions there charge less, the same or more, counted only from fees checked against each institution's own published schedule.",
  robots: { index: false, follow: true },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const money = (value: number) => formatFeeAmount(value) ?? `$${value.toFixed(2)}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export default async function PriceCheckPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const state = typeof params.state === "string" && STATE_NAMES[params.state.toUpperCase()] ? params.state.toUpperCase() : null;
  const fee: PriceCheckFee = isPriceCheckFee(params.fee) ? params.fee : "overdraft";
  const priceRaw = typeof params.price === "string" ? params.price : "";
  const price = parsePrice(priceRaw);
  const asked = state !== null && price !== null;

  const prices = asked ? await loadStatePricesCached(state, fee).catch(() => null) : null;
  const check = prices && price !== null ? priceCheck(price, prices) : null;
  const stateName = state ? STATE_NAMES[state] : "";
  const fips = state ? STATE_TO_FIPS[state] : undefined;
  const [national, demographics, countyMap] = check && state
    ? await Promise.all([
        getNationalIndexCached().catch(() => []),
        fips ? getStateDemographicsCached(fips).catch(() => null) : Promise.resolve(null),
        fips ? getCountyFeeMapCached(state, fee).catch(() => null) : Promise.resolve(null),
      ])
    : [[], null, null];
  const nationalEntry = national.find((entry) => entry.fee_category === fee) ?? null;
  const charters = prices && price !== null ? charterChecks(price, prices) : [];
  const markets = prices && price !== null ? marketChecks(price, prices) : [];
  const countyValues = (countyMap?.counties ?? []).map((c) => ({ fips: c.fips, value: c.overdraft, deposits: c.deposits, covered_deposits: c.covered_deposits }));
  const mapWide = check && fips && countyValues.length > 0 ? countyPriceMap(fips, countyValues, check.price) : null;
  const mapNarrow = mapWide && check && fips ? countyPriceMap(fips, countyValues, check.price, { narrow: true }) : null;
  // The legend counts every county the map draws, so counties with no branch in the deposit
  // data (hatched on the map) are counted as having no fee yet.
  const countySteps = [0, 0, 0, 0, 0];
  let countiesWithout = 0;
  const countyDetails: Record<string, CountyDetail> = {};
  if (mapWide && check && fips) {
    const rows = new Map((countyMap?.counties ?? []).map((c) => [c.fips, c]));
    for (const f of countyFeatures().filter((x) => x.id.startsWith(fips))) {
      const c = rows.get(f.id);
      if (c?.overdraft == null) countiesWithout++;
      else countySteps[priceStep(c.overdraft, check.price)]++;
      countyDetails[f.id] = {
        name: f.properties.name,
        fee: c?.overdraft ?? null,
        institutions: c?.institutions ?? 0,
        deposits: c?.deposits ?? 0,
        covered: c?.covered_deposits ?? 0,
        top: [],
      };
    }
    for (const i of countyMap?.institutions ?? []) {
      countyDetails[i.fips]?.top.push({ id: i.institution_id, name: i.name, fee: i.fee, deposits: i.deposits });
    }
  }
  const nationalMedian = nationalEntry?.median_amount != null && (nationalEntry.institution_count ?? 0) > 0 ? nationalEntry.median_amount : null;
  const income = demographics?.median_household_income ? Number(demographics.median_household_income) : null;

  return (
    <div className="mx-auto max-w-page px-4 py-14 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:items-end">
        <div className="max-w-2xl">
      <p className={EYEBROW}>Free tool</p>
      <h1 className="mt-3 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]" style={SERIF}>
        Where does a fee price sit in its state?
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[#5A5347]">
        Enter a price, including $0, and a state. Every fee counted was checked against the institution&apos;s own
        schedule.
      </p>
        </div>

      <form method="get" className="grid gap-4 rounded-xl border border-[#E8DFD1] bg-white/70 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end xl:grid-cols-[1.3fr_1fr_0.7fr_auto]">
        <label className="block">
          <span className={EYEBROW}>Fee</span>
          <select name="fee" defaultValue={fee} className="mt-1.5 block w-full rounded-lg border border-[#E8DFD1] bg-white px-3 py-2.5 text-[15px] text-[#1A1815]">
            {PRICE_CHECK_FEES.map((key) => (
              <option key={key} value={key}>
                {FEE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={EYEBROW}>State</span>
          <select name="state" defaultValue={state ?? ""} required className="mt-1.5 block w-full rounded-lg border border-[#E8DFD1] bg-white px-3 py-2.5 text-[15px] text-[#1A1815]">
            <option value="" disabled>
              Choose a state
            </option>
            {[...STATE_CODES].sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])).map((code) => (
              <option key={code} value={code}>
                {STATE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2 xl:col-span-1">
          <span className={EYEBROW}>Price</span>
          <input
            name="price"
            inputMode="decimal"
            defaultValue={priceRaw}
            placeholder="$35"
            required
            className="mt-1.5 block w-full rounded-lg border border-[#E8DFD1] bg-white px-3 py-2.5 text-[15px] text-[#1A1815]"
          />
        </label>
        <button type="submit" className="rounded-lg bg-[#1A1815] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#33302A]">
          Check
        </button>
      </form>
      </div>

      {state !== null && priceRaw && price === null && (
        <p className="mt-6 text-[14px] text-[#A93D25]">Enter the price as a dollar amount, such as 35 or 12.50.</p>
      )}

      {asked && prices === null && (
        <p className="mt-6 text-[14px] text-[#5A5347]">The fee data couldn&apos;t be read just now. Please try again in a minute.</p>
      )}

      {asked && prices !== null && check === null && (
        <p className="mt-8 text-[15px] leading-relaxed text-[#5A5347]">
          {stateName} has {plural(prices.institutions.length, "institution", "institutions")} with a source-checked{" "}
          {FEE_NOUN[fee]} so far, too few for a fair comparison. The national picture is on the{" "}
          <Link href={`/fees/${fee}`} className="font-medium text-[#A93D25] hover:underline">
            {FEE_NOUN[fee]} page
          </Link>
          .
        </p>
      )}

      {prices !== null && check !== null && (
        <section className="mt-10">
          <p className={EYEBROW}>
            {FEE_LABEL[fee]} in {stateName}
          </p>
          <h2 className="mt-2 max-w-4xl text-[1.4rem] leading-snug text-[#1A1815]" style={SERIF}>
            {check.lower} of {check.count} institutions charge less than {money(check.price)}, {check.same} charge the same and{" "}
            {check.higher} charge more.
          </h2>
          <PositionBar lower={check.lower} same={check.same} higher={check.higher} />
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start">
            <div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <Stat label="Institutions counted" value={String(check.count)} />
            <Stat label={`${state} median`} value={money(check.median)} />
            {nationalMedian !== null ? <Stat label="National median" value={money(nationalMedian)} /> : <Stat label="Charge less" value={`${check.lowerShare}%`} />}
            <Stat label="Charge $0" value={String(check.zero)} />
          </dl>
          {prices.uncheckedCount > 0 && (
            <p className="mt-4 max-w-prose text-[13px] text-[#6B6255]">
              {plural(prices.uncheckedCount, "other institution has", "other institutions have")} a published {FEE_NOUN[fee]}{" "}
              that hasn&apos;t been matched to its schedule yet, so {prices.uncheckedCount === 1 ? "it is" : "they are"} not counted.
            </p>
          )}
          {income !== null && (
            <p className="mt-3 text-[12px] text-[#6B6255]">
              Median household income in {stateName}: {money(income)} (Census ACS {demographics?.year}).
            </p>
          )}

            </div>
            <div>
          <h3 className="text-[1.1rem] text-[#1A1815]" style={SERIF}>
            How the {stateName} figures are spread
          </h3>
          <div className="mt-3 rounded-xl border border-[#E8DFD1]/80 bg-white/70 p-3">
            <DistributionChart values={prices.institutions.map((institution) => institution.value)} median={check.median} />
          </div>
            </div>
          </div>

          {mapWide && (
            <>
              <h3 className="mt-10 text-[1.1rem] text-[#1A1815]" style={SERIF}>
                {stateName} counties against {money(check.price)}
              </h3>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-[#5A5347]">
                {PRICE_MAP_LEGEND.map((label, i) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-4 rounded-sm" style={{ background: PRICE_MAP_FILLS[i] }} />
                    {label} <b className="tabular-nums text-[#1A1815]">{countySteps[i]}</b>
                  </span>
                ))}
                {countiesWithout > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-4 rounded-sm border border-[#E0D7C9]"
                      style={{ background: "repeating-linear-gradient(45deg,#fff 0 2px,#E0D7C9 2px 4px)" }}
                    />
                    No fee yet <b className="tabular-nums text-[#1A1815]">{countiesWithout}</b>
                  </span>
                )}
              </div>
              <CountyPriceMap wide={mapWide} narrow={mapNarrow} details={countyDetails} price={check.price} feeNoun={FEE_NOUN[fee]} />
              <p className="mt-2 max-w-3xl text-[12px] text-[#6B6255]">
                Each county shows the published {FEE_NOUN[fee]} of the institutions with branches there, weighted by their deposits (FDIC Summary of Deposits
                {countyMap?.sod_year ? `, ${countyMap.sod_year}` : ""}). Fees of $0 are left out.
              </p>
            </>
          )}

          <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
          {charters.length > 0 && (
            <div>
              <h3 className=" text-[1.1rem] text-[#1A1815]" style={SERIF}>
                Banks and credit unions
              </h3>
              <GroupTable rows={charters} price={check.price} firstColumn="Charter" />
            </div>
          )}

          {markets.length > 0 && (
            <div>
              <h3 className=" text-[1.1rem] text-[#1A1815]" style={SERIF}>
                By local market
              </h3>
              <p className="mt-1 max-w-prose text-[13px] text-[#6B6255]">
                Metro areas, or the city where an institution has no metro, with at least 3 source-checked institutions.
              </p>
              <GroupTable rows={markets} price={check.price} firstColumn="Market" />
            </div>
          )}
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
            <div>
          <h3 className="text-[1.1rem] text-[#1A1815]" style={SERIF}>
            The institutions behind the count
          </h3>
          <ul className="mt-3 divide-y divide-[#E8DFD1]/60 rounded-xl border border-[#E8DFD1]/80 bg-white/70">
            {prices.institutions.slice(0, SHOWN).map((institution) => (
              <li key={institution.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <Link href={`/institution/${institution.id}`} className="text-[#1A1815] hover:underline">
                    {institution.name}
                  </Link>
                  {institution.documentUrl && (
                    <>
                      {" "}
                      <a href={institution.documentUrl} rel="nofollow noopener" target="_blank" className="text-[12px] text-[#A93D25] hover:underline">
                        schedule
                      </a>
                    </>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-[#1A1815]">{money(institution.value)}</span>
              </li>
            ))}
          </ul>
          {prices.institutions.length > SHOWN && (
            <p className="mt-2 text-[13px] text-[#6B6255]">
              Showing the {SHOWN} lowest of {prices.institutions.length}. The full list, with every competitor in a market, is part of a
              market report.
            </p>
          )}

            </div>
            <div className="lg:sticky lg:top-24">
          <div className="rounded-xl border border-[#E8DFD1] bg-[#FAF7F2] p-5">
            <p className="text-[15px] leading-relaxed text-[#1A1815]">
              A market report puts one institution&apos;s full fee schedule beside its named local competitors, fee by fee, with
              every figure linked to its source.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/contact?source=report" className="rounded-lg bg-[#1A1815] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#33302A]">
                Request a market report
              </Link>
              <Link href="/reports/sample-competitive-fee-position" className="rounded-lg border border-[#E8DFD1] px-4 py-2 text-[14px] font-semibold text-[#1A1815] hover:bg-white">
                See a sample
              </Link>
            </div>
          </div>
          <p className="mt-4 text-[13px] text-[#5A5347]">
            More on {stateName}:{" "}
            <Link href={`/research/state/${state}`} className="font-medium text-[#A93D25] hover:underline">
              state fee report
            </Link>
            {" · "}
            <Link href={`/fees/city/${(state ?? "").toLowerCase()}`} className="font-medium text-[#A93D25] hover:underline">
              fees by city
            </Link>
          </p>

          <p className="mt-6 text-[12px] leading-relaxed text-[#6B6255]">
            Counts show where a price sits among published fees. They are not advice on what any institution should charge. How fees
            are collected and checked is on the{" "}
            <Link href="/methodology" className="text-[#A93D25] hover:underline">
              methodology page
            </Link>
            .
          </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** Where the price sits in each group: lower, same, higher, and the group's median. */
function GroupTable({ rows, price, firstColumn }: { rows: GroupCheck[]; price: number; firstColumn: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[#E8DFD1]/80 bg-white/70">
      <table className="w-full min-w-[22rem] text-left text-[14px]">
        <thead>
          <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
            <th className={`px-4 py-2.5 ${EYEBROW}`}>{firstColumn}</th>
            <th className={`px-3 py-2.5 text-right ${EYEBROW}`}>Counted</th>
            <th className={`px-3 py-2.5 text-right ${EYEBROW}`}>Median</th>
            <th className={`px-4 py-2.5 text-right ${EYEBROW}`}>Lower / same / higher than {money(price)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E8DFD1]/40">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="px-4 py-2.5 text-[#1A1815]">{row.label}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.count}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{money(row.median)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.lower} / {row.same} / {row.higher}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-4 py-3">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="mt-1 text-[1.25rem] tabular-nums text-[#1A1815]">{value}</dd>
    </div>
  );
}

/** One bar split into lower, same and higher, so the position reads at a glance on a phone. */
function PositionBar({ lower, same, higher }: { lower: number; same: number; higher: number }) {
  const total = lower + same + higher;
  const pct = (count: number) => `${(count / total) * 100}%`;
  return (
    <div className="mt-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-[#E8DFD1]" role="img" aria-label={`${lower} lower, ${same} same, ${higher} higher`}>
        <span style={{ width: pct(lower) }} className="bg-[#B8AC98]" />
        <span style={{ width: pct(same) }} className="bg-[#1A1815]" />
        <span style={{ width: pct(higher) }} className="bg-[#6B6255]" />
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-[#6B6255]">
        <span>Lower {lower}</span>
        <span>Same {same}</span>
        <span>Higher {higher}</span>
      </div>
    </div>
  );
}
