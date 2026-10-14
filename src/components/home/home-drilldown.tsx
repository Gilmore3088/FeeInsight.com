import Link from "next/link";
import { BranchFootprintCard } from "@/app/(public)/institution/[id]/registry-cards";
import { DistrictBoard } from "@/app/(public)/research/district-board";
import { StateExplorer } from "@/app/(public)/research/state-explorer";
import { FeeRange, FeeRangeAxis } from "@/brand/components";
import { CountyPriceMap } from "@/components/public/county-price-map";
import { buildCountyPriceView } from "@/lib/county-price-view";
import { getBranchFootprint } from "@/lib/data-store/registry-profile";
import { getCountyFeeMapCached, getResearchCoverageCached } from "@/lib/data-store/public-cached-reads";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { PRICE_MAP_FILLS, PRICE_MAP_LEGEND } from "@/lib/report-templates/base/state-charts";
import { STATE_NAMES } from "@/lib/us-states";
import { formatFee, type HomeData } from "./home-data";
import { Eyebrow, Section } from "./home-section";
import type { SampleStory } from "./sample-story";
import { DrilldownTabs, type DrilldownPanel } from "./drilldown-tabs";

const COUNTY_FEE = "overdraft";

/**
 * From the nation to the branch: the maps and data the site already publishes, one level
 * per tab. Every panel is optional; a failed read drops its tab rather than showing a blank.
 */
export async function DrilldownSection({ data, sample }: { data: HomeData; sample: SampleStory | null }) {
  const nation = data.nationalFees.find((fee) => fee.key === COUNTY_FEE);
  const stateCode = sample?.stateCode && STATE_TO_FIPS[sample.stateCode] ? sample.stateCode : null;
  const fips = stateCode ? STATE_TO_FIPS[stateCode] : null;
  const [coverage, countyMap, footprint] = await Promise.all([
    getResearchCoverageCached().catch(() => null),
    stateCode ? getCountyFeeMapCached(stateCode, COUNTY_FEE).catch(() => null) : Promise.resolve(null),
    sample ? getBranchFootprint(sample.institutionId).catch(() => null) : Promise.resolve(null),
  ]);
  const county = fips && nation ? buildCountyPriceView(fips, countyMap, nation.median) : null;
  const stateName = stateCode ? STATE_NAMES[stateCode] : "";

  const panels: DrilldownPanel[] = [];
  if (data.nationalFees.length > 0) {
    const top = Math.ceil(Math.max(10, ...data.nationalFees.map((fee) => fee.max)) / 10) * 10;
    panels.push({
      key: "nation",
      label: "The nation",
      blurb: `Each fee's spread across ${data.institutionsLabel} U.S. institutions: the lowest, the middle half, the median and the highest.`,
      body: (
        <div className="rounded-lg border border-border bg-surface-0 p-5">
          {data.nationalFees.map((fee) => (
            <FeeRange key={fee.key} label={fee.label} min={fee.min} q1={fee.q1} median={fee.median} q3={fee.q3} max={fee.max} domain={[0, top]} format={formatFee} />
          ))}
          <FeeRangeAxis ticks={[0, top / 4, top / 2, (top * 3) / 4, top]} />
          <p className="mt-3 text-[12px] text-ink-muted">Bank Fee Index · {data.freshnessLabel}</p>
        </div>
      ),
    });
  }
  if (coverage) {
    panels.push({
      key: "districts",
      label: "Fed districts",
      blurb: "The twelve Federal Reserve districts, each with its own fee index against the nation.",
      body: <DistrictBoard districts={coverage.districts} />,
    });
    panels.push({
      key: "states",
      label: "States",
      blurb: "Every state, by institutions with published fees. Pick one for its state fee report.",
      body: <StateExplorer states={coverage.states} />,
    });
  }
  if (county && nation && stateCode) {
    panels.push({
      key: "counties",
      label: "Counties",
      blurb: `${stateName}'s counties shaded by the deposit-weighted overdraft fee, against the national median of ${formatFee(nation.median)}. Hover a county for its institutions.`,
      body: (
        <div className="grid gap-3 rounded-lg border border-border bg-surface-0 p-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-label="Map legend">
            {PRICE_MAP_LEGEND.map((label, i) => (
              <li key={label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ background: PRICE_MAP_FILLS[i] }} />
                {label} <b className="tabular-nums text-ink">{county.steps[i]}</b>
              </li>
            ))}
          </ul>
          <CountyPriceMap wide={county.wide} narrow={county.narrow} details={county.details} price={nation.median} feeNoun="overdraft fee" />
          <Link href={`/tools/price-check?state=${stateCode}&fee=${COUNTY_FEE}`} className="text-[14px] font-semibold text-ink underline underline-offset-4">
            Check any price in any state
          </Link>
        </div>
      ),
    });
  }
  if (footprint && sample) {
    panels.push({
      key: "branches",
      label: "Branches",
      blurb: `Down to the branch: every office of ${sample.name}, the institution in the live sample report.`,
      body: <BranchFootprintCard footprint={footprint} />,
    });
  }
  if (panels.length === 0) return null;

  return (
    <Section tone="surface">
      <Eyebrow>From the nation to the branch</Eyebrow>
      <h2 className="mt-3 max-w-[22ch] text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-ink">
        Every fee, at every level of the market
      </h2>
      <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-ink-soft">
        The same published fees, aggregated for the nation, each Fed district, each state and each county, and mapped to
        every branch. Every figure keeps its source: the institution&apos;s own document, the page and the date.
      </p>
      <div className="mt-10">
        <DrilldownTabs panels={panels} />
      </div>
    </Section>
  );
}
