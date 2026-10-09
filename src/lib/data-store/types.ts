import type { FeeAudience, FeeTreatment } from "@/lib/fee-audience";
import type {
  FeePublicationStatus,
  InstitutionInsightReadiness,
  InstitutionQualitySignal,
  InstitutionQualityStatus,
  InstitutionSourceNeededReason,
} from "@/lib/institution-quality";

export interface InstitutionSummary {
  id: number;
  institution_name: string;
  state_code: string | null;
  charter_type: string;
  asset_size: number | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  document_type: string | null;
  fee_count: number;
}

export interface ExtractedFee {
  fee_audience?: FeeAudience;
  audience_evidence?: string | null;
  fee_treatment?: FeeTreatment;
  id: number;
  fee_name: string;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  extraction_confidence: number;
  review_status: string;
  validation_flags: unknown;
  institution_name: string;
  institution_id: number;
  fee_category?: string | null;
  fee_family?: string | null;
  source_url?: string | null;
  created_at?: string | Date;
}

export interface ReviewableFee extends ExtractedFee {
  state_code: string | null;
  charter_type: string;
  fee_category: string | null;
  document_url: string | null;
  fee_schedule_url: string | null;
}

export interface FeeReview {
  id: number;
  fee_id: number;
  action: string;
  username: string | null;
  previous_status: string | null;
  new_status: string | null;
  previous_values: unknown;
  new_values: unknown;
  notes: string | null;
  created_at: string | Date;
}

export interface ReviewStats {
  pending: number;
  staged: number;
  flagged: number;
  approved: number;
  rejected: number;
}

export interface InstitutionDetail {
  id: number;
  institution_name: string;
  state_code: string | null;
  charter_type: string;
  asset_size: number | null;
  asset_size_tier: string | null;
  fed_district: number | null;
  city: string | null;
  source?: string | null;
  cert_number?: string | null;
  rssd_id?: string | null;
  lei?: string | null;
  document_type?: string | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  fee_count: number;
  published_fee_count?: number;
  provisional_fee_count?: number;
  fee_publication_status?: FeePublicationStatus;
  insight_readiness?: InstitutionInsightReadiness;
  source_needed_reason?: InstitutionSourceNeededReason;
  confidence_summary?: string;
  latest_source_status?: string | null;
  latest_extracted_fee_count?: number;
  latest_source_collected_at?: string | null;
  quality_status?: InstitutionQualityStatus;
  quality_signals?: InstitutionQualitySignal[];
  quality_label?: string;
}

export interface CollectionStats {
  total_institutions: number;
  banks: number;
  credit_unions: number;
  with_website: number;
  with_fee_url: number;
  total_fees: number;
  collection_runs: number;
}
