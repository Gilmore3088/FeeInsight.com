import { getInstitutionById } from "@/lib/data-store";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getSegmentLabel } from "@/app/(public)/institution/[id]/enum-labels";
import { formatAssets } from "@/lib/format";
import {
  getFeePublicationStatusLabel,
  type FeePublicationStatus,
  type InstitutionInsightReadiness,
  type InstitutionSourceNeededReason,
} from "@/lib/institution-quality";

export interface HamiltonSelectedInstitutionContext {
  id: number;
  name: string;
  city: string | null;
  stateCode: string | null;
  charterType: string;
  assetSize: number | null;
  assetSizeLabel: string | null;
  assetTier: string | null;
  assetTierLabel: string | null;
  fedDistrict: number | null;
  districtName: string | null;
  feePublicationStatus: FeePublicationStatus;
  feePublicationLabel: string;
  insightReadiness: InstitutionInsightReadiness;
  confidenceSummary: string;
  sourceNeededReason: InstitutionSourceNeededReason;
  publishedFeeCount: number;
  provisionalFeeCount: number;
  qualityLabel: string | null;
  latestSourceStatus: string | null;
  latestSourceCollectedAt: string | null;
}

export function parseInstitutionId(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function getHamiltonInstitutionContext(
  instId: string | number | null | undefined,
): Promise<{ institution: HamiltonSelectedInstitutionContext | null; error: string | null }> {
  const parsedId = parseInstitutionId(instId);
  if (!parsedId) return { institution: null, error: instId ? "Invalid institution ID" : null };

  const inst = await getInstitutionById(parsedId).catch(() => null);
  if (!inst) return { institution: null, error: "Institution not found" };

  const status = inst.fee_publication_status ?? "unavailable";

  return {
    institution: {
      id: inst.id,
      name: inst.institution_name,
      city: inst.city,
      stateCode: inst.state_code,
      charterType: inst.charter_type,
      assetSize: inst.asset_size,
      assetSizeLabel: inst.asset_size ? formatAssets(inst.asset_size) : null,
      assetTier: inst.asset_size_tier,
      assetTierLabel: getSegmentLabel(inst.asset_size_tier, inst.charter_type),
      fedDistrict: inst.fed_district,
      districtName: inst.fed_district ? DISTRICT_NAMES[inst.fed_district] : null,
      feePublicationStatus: status,
      feePublicationLabel: getFeePublicationStatusLabel(status),
      insightReadiness: inst.insight_readiness ?? "source_needed",
      confidenceSummary:
        inst.confidence_summary ??
        "Official source evidence is needed before fee claims can be made.",
      sourceNeededReason: inst.source_needed_reason ?? "official_source_missing",
      publishedFeeCount: inst.published_fee_count ?? 0,
      provisionalFeeCount: inst.provisional_fee_count ?? 0,
      qualityLabel: inst.quality_label ?? null,
      latestSourceStatus: inst.latest_source_status ?? null,
      latestSourceCollectedAt: inst.latest_source_collected_at ?? null,
    },
    error: null,
  };
}
