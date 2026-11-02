/**
 * The server read behind the Research market explorer. One existing read, getPeerFeeValues on
 * published_fee_catalog (approved dollar fees, one value per institution, the fee index's own
 * contract, the read the state map already used), loaded once and split in memory by filter sets:
 * every institution (for the subject's own price), the type-and-size slice, its banks (to label
 * charters) and the Fed district when one is asked for. Read-only, cached for an hour, no model call.
 * A failed read returns null and the page says so.
 */

import { unstable_cache } from "next/cache";
import { getPeerFeeValues, type PeerFeeValue, type PeerFilterSet } from "@/lib/data-store/fee-index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { AssetSize } from "../asset-size";
import type { Charter } from "../intelligence-data";
import { buildMarketExplorer, type ExplorerRegion, type ExplorerValue, type MarketExplorerData } from "./market-explorer";

interface ExplorerReadValue extends ExplorerValue {
  /** Which filter sets took it in: slice, district. */
  inSlice: boolean;
  inDistrict: boolean;
}

function toValue(v: PeerFeeValue, charter: ExplorerValue["charter"]): ExplorerValue {
  return {
    id: v.institution_id,
    name: v.institution_name,
    stateCode: v.state_code,
    assets: v.total_assets ?? null,
    charter,
    amount: v.amount,
    ...(v.counted_as !== undefined ? { countedAs: v.counted_as } : {}),
    documentUrl: v.document_urls[0] ?? null,
    ...(v.several ? { several: true } : {}),
  };
}

/** Plain arrays only, so the result can sit in the data cache. */
async function readValues(category: string, charter: Charter, tiers: string[] | null, district: number | null): Promise<ExplorerReadValue[]> {
  const slice: PeerFilterSet = {
    ...(charter === "all" ? {} : { charter_type: charter }),
    ...(tiers?.length ? { asset_tiers: tiers } : {}),
  };
  const sets: PeerFilterSet[] = [{}, slice, { charter_type: "bank" }, { charter_type: "credit_union" }, ...(district ? [{ ...slice, fed_districts: [district] }] : [])];
  const [all, inSlice, banks, unions, inDistrict] = (await getPeerFeeValues(sets, [category])).map((m) => m.get(category) ?? []);
  const ids = (list: PeerFeeValue[] | undefined) => new Set((list ?? []).map((v) => v.institution_id));
  const sliceIds = ids(inSlice);
  const bankIds = ids(banks);
  const unionIds = ids(unions);
  const districtIds = ids(inDistrict);
  return all.map((v) => ({
    ...toValue(v, bankIds.has(v.institution_id) ? "bank" : unionIds.has(v.institution_id) ? "credit_union" : null),
    inSlice: sliceIds.has(v.institution_id),
    inDistrict: districtIds.has(v.institution_id),
  }));
}

const cachedValues = unstable_cache(readValues, ["hamilton-market-explorer-v1"], { revalidate: 3600 });

export async function readMarketExplorer(input: {
  category: string;
  charter: Charter;
  size: AssetSize;
  region: ExplorerRegion;
  subject: { id: number; name: string; stateCode: string | null } | null;
}): Promise<MarketExplorerData | null> {
  try {
    const district = input.region.kind === "district" ? input.region.district : null;
    const values = await cachedValues(input.category, input.charter, input.size.tiers ? [...input.size.tiers] : null, district);
    const own = input.subject ? values.find((v) => v.id === input.subject!.id) ?? null : null;
    const region = input.region;
    return buildMarketExplorer({
      category: input.category,
      feeName: getDisplayName(input.category),
      region,
      values: values.filter((v) => v.inSlice),
      inRegion: (v) => region.kind === "national" ? true
        : region.kind === "state" ? v.stateCode === region.stateCode
        : (v as ExplorerReadValue).inDistrict,
      subject: input.subject ? { ...input.subject, value: own } : null,
    });
  } catch {
    return null;
  }
}
