import type { CountyDetail } from "@/components/public/county-price-map";
import type { getCountyFeeMap } from "@/lib/data-store/state-visuals";
import { countyFeatures } from "@/lib/geo/counties";
import { countyPriceMap, priceStep } from "@/lib/report-templates/base/state-charts";

type CountyFeeMap = Awaited<ReturnType<typeof getCountyFeeMap>>;

/** One state's county map against a price, with what the hover panel and the legend need. */
export interface CountyPriceView {
  wide: string;
  narrow: string | null;
  details: Record<string, CountyDetail>;
  /** Counties in each legend step (PRICE_MAP_LEGEND order). */
  steps: number[];
  /** Counties drawn with no published fee yet. */
  without: number;
}

/**
 * Shared by /tools/price-check and the homepage. The legend counts every county the map
 * draws, so counties with no branch in the deposit data (hatched) count as having no fee yet.
 */
export function buildCountyPriceView(fips: string, countyMap: CountyFeeMap | null, price: number): CountyPriceView | null {
  const counties = countyMap?.counties ?? [];
  const values = counties.map((c) => ({ fips: c.fips, value: c.overdraft, deposits: c.deposits, covered_deposits: c.covered_deposits }));
  if (values.length === 0) return null;
  const wide = countyPriceMap(fips, values, price);
  if (!wide) return null;
  const narrow = countyPriceMap(fips, values, price, { narrow: true });
  const steps = [0, 0, 0, 0, 0];
  let without = 0;
  const details: Record<string, CountyDetail> = {};
  const rows = new Map(counties.map((c) => [c.fips, c]));
  for (const feature of countyFeatures().filter((f) => f.id.startsWith(fips))) {
    const row = rows.get(feature.id);
    if (row?.overdraft == null) without++;
    else steps[priceStep(row.overdraft, price)]++;
    details[feature.id] = {
      name: feature.properties.name,
      fee: row?.overdraft ?? null,
      institutions: row?.institutions ?? 0,
      deposits: row?.deposits ?? 0,
      covered: row?.covered_deposits ?? 0,
      top: [],
    };
  }
  for (const inst of countyMap?.institutions ?? []) {
    details[inst.fips]?.top.push({ id: inst.institution_id, name: inst.name, fee: inst.fee, deposits: inst.deposits });
  }
  return { wide, narrow, details, steps, without };
}
