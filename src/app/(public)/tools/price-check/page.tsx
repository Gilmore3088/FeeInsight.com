export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { DistributionChart } from "@/components/public/distribution-chart";
import { CountyPriceMap, type CountyDetail } from "@/components/public/county-price-map";
import { InstitutionSearchBar } from "@/app/(public)/institutions/search-bar";
import { TrackLink } from "@/components/track-link";
import { PAGE_HEADER } from "@/components/public/page-header";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";
import { countyFeatures } from "@/lib/geo/counties";
import { getCountyFeeMapCached, getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { getPublicSnapshot } from "@/lib/public-stats";
import { countyPriceMap, PRICE_MAP_FILLS, PRICE_MAP_LEGEND, priceStep } from "@/lib/report-templates/base/state-charts";
import { isPriceCheckFee, loadStatePricesCached, marketChecks, parsePrice, PRICE_CHECK_FEES, type PriceCheckFee } from "@/lib/price-check";
import { InstitutionList, MarketList, RangeStack, ShareBar, VerdictTag } from "./price-check-exhibits";
import {
  askedSummary,
  charterPlacements,
  countyCaption,
  COPY,
  FEE_LABEL,
  lessHeadline,
  money,
  nationalSource,
  placeAmong,
  previewHeading,
  REPORT_HREF,
  sameAndMore,
  shownNote,
  stateRowLabel,
  stateSource,
  stateTooFew,
  uncheckedNote,
  versusMedian,
  FEE_NOUN,
} from "./price-check-view";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted";
const FIELD = "mt-1.5 block min-h-11 w-full rounded-lg border border-border bg-surface-0 px-3 text-[16px] text-ink";
const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";
const H3 = "text-[17px] font-semibold text-ink";
const PANEL = "rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6";
const SHOWN = 25;

export const metadata: Metadata = {
  title: "Overdraft and NSF Fee Price Check",
  description:
    "Enter the overdraft or NSF fee you were charged and see where it sits among U.S. banks and credit unions, and in your state.",
  robots: { index: false, follow: true },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PriceCheckPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const state = typeof params.state === "string" && STATE_NAMES[params.state.toUpperCase()] ? params.state.toUpperCase() : null;
  const fee: PriceCheckFee = isPriceCheckFee(params.fee) ? params.fee : "overdraft";
  const priceRaw = typeof params.price === "string" ? params.price : "";
  const price = parsePrice(priceRaw);
  const stateName = state ? STATE_NAMES[state] : "";
  const fips = state ? STATE_TO_FIPS[state] : undefined;

  // National figures come from the same read as /fees/[fee] (one value per institution from
  // published_fee_catalog), so the median here is the one that page shows. The state figures
  // are the price check's own source-checked list, as before.
  const [detail, snapshot, prices, countyMap] = await Promise.all([
    getFeeCategoryDetailCached(fee).catch(() => null),
    getPublicSnapshot().catch(() => null),
    state && price !== null ? loadStatePricesCached(state, fee).catch(() => null) : Promise.resolve(null),
    state && fips && price !== null ? getCountyFeeMapCached(state, fee).catch(() => null) : Promise.resolve(null),
  ]);
  const points = detail?.institution_points ?? [];
  const values = points.map((p) => p.value);
  const unstated = medianHasUnstatedAudience(snapshot?.categories.find((c) => c.fee_category === fee) ?? null);

  const preview = placeAmong("U.S.", values, 0);
  const national = price !== null ? placeAmong("U.S.", values, price) : null;
  const charters = price !== null && national ? charterPlacements(points, price) : [];
  const statePlace = price !== null && prices ? placeAmong(stateRowLabel(stateName), prices.institutions.map((i) => i.value), price) : null;
  const markets = price !== null && prices && statePlace ? marketChecks(price, prices) : [];
  const rows = [national, ...charters, statePlace].filter((r) => r !== null);
  const answered = price !== null && national !== null;

  // The county map, as before: each county's deposit-weighted fee against the price.
  const countyValues = (countyMap?.counties ?? []).map((c) => ({ fips: c.fips, value: c.overdraft, deposits: c.deposits, covered_deposits: c.covered_deposits }));
  const mapWide = statePlace && price !== null && fips && countyValues.length > 0 ? countyPriceMap(fips, countyValues, price) : null;
  const mapNarrow = mapWide && price !== null && fips ? countyPriceMap(fips, countyValues, price, { narrow: true }) : null;
  // The legend counts every county the map draws; a county with no branch in the deposit data
  // (hatched on the map) counts as having no fee yet.
  const countySteps = [0, 0, 0, 0, 0];
  let countiesWithout = 0;
  const countyDetails: Record<string, CountyDetail> = {};
  if (mapWide && price !== null && fips) {
    const byFips = new Map((countyMap?.counties ?? []).map((c) => [c.fips, c]));
    for (const f of countyFeatures().filter((x) => x.id.startsWith(fips))) {
      const c = byFips.get(f.id);
      if (c?.overdraft == null) countiesWithout++;
      else countySteps[priceStep(c.overdraft, price)]++;
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

  const medianFigure = (median: number) => (
    <>
      {money(median)}
      <UnstatedAudienceMark show={unstated} />
    </>
  );
  const refreshedOn = snapshot?.summary.refreshedOn ?? null;
  const unchecked = prices ? uncheckedNote(prices.uncheckedCount, fee) : null;
  const shown = prices ? shownNote(SHOWN, prices.institutions.length) : null;

  const badPrice = priceRaw !== "" && price === null;
  const form = (
    <form method="get" className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className={EYEBROW}>{COPY.feeLabel}</span>
        <select name="fee" defaultValue={fee} className={FIELD}>
          {PRICE_CHECK_FEES.map((key) => (
            <option key={key} value={key}>
              {FEE_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      <div>
        <label htmlFor="pc-price" className={EYEBROW}>
          {COPY.amountLabel}
        </label>
        <input
          id="pc-price"
          name="price"
          inputMode="decimal"
          defaultValue={priceRaw}
          placeholder={COPY.amountPlaceholder}
          required
          aria-invalid={badPrice || undefined}
          aria-describedby={badPrice ? "pc-price-error" : undefined}
          className={FIELD}
        />
        {badPrice && (
          <p id="pc-price-error" role="alert" className="mt-1.5 text-[13px] text-brick">
            {COPY.badPrice}
          </p>
        )}
      </div>
      <label className="block">
        <span className={EYEBROW}>{COPY.stateLabel}</span>
        <select name="state" defaultValue={state ?? ""} className={FIELD}>
          <option value="">{COPY.allStates}</option>
          {[...STATE_CODES].sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])).map((code) => (
            <option key={code} value={code}>
              {STATE_NAMES[code]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="min-h-11 self-end rounded-lg bg-ink px-5 text-[15px] font-semibold text-white hover:bg-ink/90">
        {COPY.submit}
      </button>
    </form>
  );

  return (
    <div className="mx-auto max-w-page px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-10 sm:space-y-12">
        {/* 1. The question and the form (a GET form, so every answer has its own link). Once a
            fee is answered, the form folds to one line so the answer leads on a phone. */}
        <section aria-labelledby="pc-heading" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-end">
          <header className={`mx-auto max-w-xl sm:mx-0 ${PAGE_HEADER}`}>
            <p className={`${EYEBROW} sm:mx-0`}>{COPY.eyebrow}</p>
            <h1
              id="pc-heading"
              className={`mt-2 font-semibold leading-tight tracking-[-0.03em] text-ink ${answered ? "text-[22px] sm:text-[28px]" : "text-[30px] sm:text-[40px]"}`}
            >
              {COPY.title}
            </h1>
            {!answered && <p className="mt-2 text-[15px] text-ink-muted sm:mx-0">{COPY.intro}</p>}
          </header>
          {answered && price !== null ? (
            <details className="group rounded-2xl border border-border bg-surface-0 shadow-fi-1">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[15px] text-ink [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 font-medium">{askedSummary(fee, price, state ? stateName : null)}</span>
                <span className="shrink-0 text-[14px] font-semibold text-brick group-open:hidden">{COPY.change}</span>
              </summary>
              <div className="border-t border-border p-4 sm:p-5">{form}</div>
            </details>
          ) : (
            <div className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5">{form}</div>
          )}
        </section>

        {/* 2. Before a price: the fee's national spread, so the page shows something at once. */}
        {price === null && preview && (
          <section aria-labelledby="preview-heading" className="space-y-3">
            <h2 id="preview-heading" className={H2}>
              {previewHeading(preview.count, fee)}
            </h2>
            <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
              <Figure label={COPY.medianLabel}>{medianFigure(preview.band.median)}</Figure>
              <Figure label={COPY.middleHalfLabel}>
                {money(preview.band.p25)}–{money(preview.band.p75)}
              </Figure>
            </dl>
            <div className={PANEL}>
              <div className="mx-auto max-w-[640px]">
                <DistributionChart values={values} median={preview.band.median} />
              </div>
            </div>
            <p className="text-[12px] text-ink-muted">{nationalSource(preview.count, refreshedOn)}</p>
          </section>
        )}

        {/* 3. The answer: the fee placed on the live U.S. spread, then each group on one axis. */}
        {price !== null && national && (
          <section aria-labelledby="answer-heading" className="space-y-6">
            <div className="space-y-3">
              <VerdictTag placement={national} />
              <h2 id="answer-heading" className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
                {lessHeadline(national, "U.S. institutions", price)}
              </h2>
              <p className="text-[15px] text-ink-muted">{sameAndMore(national)}</p>
              <ShareBar placement={national} />
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Figure label={COPY.medianLabel}>{medianFigure(national.band.median)}</Figure>
              <Figure label={COPY.middleHalfLabel}>
                {money(national.band.p25)}–{money(national.band.p75)}
              </Figure>
              <Figure label={COPY.versusLabel} wide>
                {versusMedian(price, national.band.median)}
              </Figure>
            </dl>
            <div className="space-y-3">
              <h3 className={H3}>{COPY.rangeHeading}</h3>
              <RangeStack rows={rows} price={price} />
            </div>
            <div className="space-y-3">
              <h3 className={H3}>{COPY.spreadHeading}</h3>
              <div className={PANEL}>
                <div className="mx-auto max-w-[640px]">
                  <DistributionChart values={values} median={national.band.median} />
                </div>
              </div>
              <p className="text-[12px] text-ink-muted">{nationalSource(national.count, refreshedOn)}</p>
            </div>
          </section>
        )}

        {/* 4. The state, when one is picked. */}
        {price !== null && national && state && (
          <section aria-labelledby="state-heading" className="space-y-4">
            <h2 id="state-heading" className={H2}>
              {stateName}
            </h2>
            {prices === null && <p className="text-[14px] text-ink-muted">{COPY.readError}</p>}
            {prices !== null && !statePlace && <p className="text-[15px] text-ink-muted">{stateTooFew(stateName, prices.institutions.length, fee)}</p>}
            {prices !== null && statePlace && (
              <>
                <div className="space-y-2">
                  <p className={H3}>{lessHeadline(statePlace, `${stateName} institutions`, price)}</p>
                  <ShareBar placement={statePlace} />
                  {unchecked && <p className="text-[12px] text-ink-muted">{unchecked}</p>}
                  <p className="text-[12px] text-ink-muted">
                    {stateSource(stateName, statePlace.count, prices.institutions.map((i) => i.readAt))}
                  </p>
                </div>

                {mapWide && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-soft">
                      {PRICE_MAP_LEGEND.map((label, i) => (
                        <span key={label} className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-3 w-4 rounded-sm" style={{ background: PRICE_MAP_FILLS[i] }} />
                          {label} <b className="tabular-nums text-ink">{countySteps[i]}</b>
                        </span>
                      ))}
                      {countiesWithout > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-3 w-4 rounded-sm border border-border"
                            style={{ background: "repeating-linear-gradient(45deg,#fff 0 2px,#ddd5c6 2px 4px)" }}
                          />
                          {COPY.noFeeYet} <b className="tabular-nums text-ink">{countiesWithout}</b>
                        </span>
                      )}
                    </div>
                    <CountyPriceMap wide={mapWide} narrow={mapNarrow} details={countyDetails} price={price} feeNoun={FEE_NOUN[fee]} />
                    <p className="text-[12px] text-ink-muted">{countyCaption(fee, countyMap?.sod_year ?? null)}</p>
                  </div>
                )}

                <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                  {markets.length > 0 && (
                    <div className="space-y-2">
                      <h3 className={H3}>{COPY.marketsHeading}</h3>
                      <MarketList rows={markets} price={price} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <h3 className={H3}>{COPY.lowestHeading}</h3>
                    <InstitutionList institutions={prices.institutions} shown={SHOWN} />
                    {shown && <p className="text-[12px] text-ink-muted">{shown}</p>}
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* 5. One next step: the visitor's own bank. */}
        <section aria-labelledby="next-heading" className={PANEL}>
          <h2 id="next-heading" className={H2}>
            {COPY.nextHeading}
          </h2>
          <p className="mt-1 text-[15px] text-ink-muted">{COPY.nextBody}</p>
          <div className="mt-4 max-w-xl">
            <InstitutionSearchBar ariaLabel={COPY.nextHeading} />
          </div>
        </section>

        {/* 6. Notes, and one small line for bank staff. */}
        <div className="space-y-2 text-[12px] leading-relaxed text-ink-muted">
          <UnstatedAudienceFootnote show={unstated && preview !== null} />
          <p>
            {COPY.staffPrefix}{" "}
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "price_check" }}
              href={REPORT_HREF}
              className="font-medium text-ink underline underline-offset-2 hover:text-ink-soft"
            >
              {COPY.staffLink}
            </TrackLink>
          </p>
          <p>
            {COPY.disclaimer}{" "}
            <Link href="/methodology" className="font-medium text-ink underline underline-offset-2 hover:text-ink-soft">
              {COPY.methodLink}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-border bg-surface-0 px-4 py-3 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-[17px] font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}
