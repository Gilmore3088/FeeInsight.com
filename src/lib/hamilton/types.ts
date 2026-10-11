/**
 * Hamilton AI Analyst — Type Definitions
 * All report sections are generated through this typed contract.
 */

import type { HamiltonPersistedContextSource } from "@/lib/hamilton/context-source";
import type { Storyline, StorylineMemo } from "@/lib/hamilton/workspace/storyline-types";
import type { HamiltonIdentitySnapshot } from "@/lib/hamilton/account-context";

export type SectionType =
  | "overview"
  | "findings"
  | "trend_analysis"
  | "peer_comparison"
  | "peer_competitive"
  | "regional_analysis"
  | "recommendation"
  | "executive_summary"
  | "methodology_note"
  | "strategic";

export interface SectionInput {
  type: SectionType;
  /** Section title — must state the conclusion, not the topic */
  title: string;
  /** Structured source data. Hamilton may only reference figures present here. */
  data: Record<string, unknown>;
  /** Optional context for framing (report type, geography, time period) */
  context?: string;
}

/** @deprecated Use SectionOutput instead */
export type GenerateSectionOutput = SectionOutput;

export interface SectionOutput {
  /** Hamilton narrative — validated against source data before use */
  narrative: string;
  wordCount: number;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ValidationResult {
  passed: boolean;
  /** Numbers found in narrative that have no match in source data */
  inventedNumbers: string[];
  /** Total numeric tokens checked */
  checkedCount: number;
  /** All numeric values extracted from source data */
  sourceValues: number[];
}

export interface ValidatedSection extends SectionOutput {
  validation: ValidationResult;
  input: SectionInput;
}

// ─── Report Data Types ─────────────────────────────────────────────────────────

/**
 * Input data shape for national overview reports.
 */
export interface NationalOverviewData {
  report_date: string;
  total_institutions: number;
  total_observations: number;
  categories: Array<{
    fee_category: string;
    display_name: string;
    median_amount: number | null;
    p25_amount: number | null;
    p75_amount: number | null;
    institution_count: number;
    observation_count: number;
    maturity: string;
    is_featured: boolean;
  }>;
  charter_split?: Record<string, unknown>;
}

/**
 * Input data shape for peer competitive benchmarking reports.
 * All fields are pipeline-verified before passing to Hamilton.
 */
export interface PeerCompetitiveData {
  title: string;
  subtitle: string;
  report_date: string;
  peer_definition: {
    charter_type?: string;
    asset_tiers?: string[];
    fed_districts?: number[];
    state?: string;
  };
  categories: Array<{
    fee_category: string;
    display_name: string;
    peer_median: number | null;
    national_median: number | null;
    p25_amount: number | null;
    p75_amount: number | null;
    delta_pct: number | null;
    peer_count: number;
    is_featured: boolean;
  }>;
  total_peer_institutions: number;
  total_observations: number;
}

// ─── Thesis Types (Phase 33) ────────────────────────────────────────────────

/**
 * Report scope determines thesis depth.
 * quarterly = full treatment (all fields). Others = lighter (no contrarian_insight).
 */
export type ThesisScope = 'quarterly' | 'monthly_pulse' | 'peer_brief' | 'state_index';

/** A single tension: two opposing forces + what the opposition implies for strategy. */
export interface ThesisTension {
  force_a: string;
  force_b: string;
  implication: string;
}

/**
 * Structured thesis output from generateGlobalThesis().
 * contrarian_insight is null for lighter scopes (monthly_pulse, peer_brief, state_index).
 */
export interface ThesisOutput {
  core_thesis: string;
  tensions: ThesisTension[];
  revenue_model: string;
  competitive_dynamic: string;
  /** Non-obvious finding. Null for lighter scopes (not quarterly). */
  contrarian_insight: string | null;
  /** 150-word flowing summary injected into every section's context. */
  narrative_summary: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Condensed data summary (~5KB) passed to the thesis generator.
 * Derived from NationalQuarterlyPayload by buildThesisSummary().
 */
export interface ThesisSummaryPayload {
  quarter: string;
  total_institutions: number;
  top_categories: Array<{
    fee_category: string;
    display_name: string;
    median_amount: number | null;
    bank_median: number | null;
    cu_median: number | null;
    institution_count: number;
    maturity_tier: string;
  }>;
  revenue_snapshot: {
    latest_quarter: string;
    total_service_charges: number;
    yoy_change_pct: number | null;
    bank_service_charges: number;
    cu_service_charges: number;
    total_institutions: number;
  } | null;
  fred_snapshot: {
    fed_funds_rate: number | null;
    unemployment_rate: number | null;
    cpi_yoy_pct: number | null;
    consumer_sentiment: number | null;
    as_of: string;
  } | null;
  /** Beige Book headline text snippets, one per Fed district that has data. */
  beige_book_themes: string[];
  /**
   * Pre-computed tension candidates from the assembler's derived analytics.
   * E.g. "Bank fees exceed CU fees in 18 of 22 comparable categories".
   * Helps the thesis generator identify genuine data tensions quickly.
   */
  derived_tensions: string[];
}

/** Input contract for generateGlobalThesis(). */
export interface ThesisInput {
  scope: ThesisScope;
  data: ThesisSummaryPayload;
}

// ─── Screen DTOs (Phase 38) ────────────────────────────────────────────────

/** Analyze screen response — explores and explains, does NOT recommend (ARCH-05) */
export interface AnalyzeResponse {
  identityContext?: HamiltonIdentitySnapshot;
  title: string;
  confidence: {
    level: "high" | "medium" | "low";
    basis: string[];
  };
  hamiltonView: string;
  whatThisMeans: string;
  whyItMatters: string[];
  evidence: {
    metrics: Array<{ label: string; value: string; note?: string }>;
    chart?: unknown;
  };
  exploreFurther: string[];
  /** Set when the Ask engine answered: the storyline it built, and Hamilton's checked memo once written. */
  storyline?: Storyline;
  memo?: StorylineMemo;
  engineVersion?: string;
  // NOTE: No recommendedPosition — screen boundary rule (ARCH-05)
}

/** Simulate screen response — the ONLY screen that issues recommendations (ARCH-05) */
export interface SimulationResponse {
  scenarioSetup: {
    feeCategory: string;
    currentFee: number;
    proposedFee: number;
    min?: number;
    max?: number;
  };
  currentState: {
    percentile: number;
    medianGap: number;
    riskProfile: string;
  };
  proposedState: {
    percentile: number;
    medianGap: number;
    riskProfile: string;
  };
  deltas: {
    percentileChange: number;
    medianGapChange: number;
    riskShift: string;
  };
  interpretation: string;
  tradeoffs: Array<{ label: string; value: string; note?: string }>;
  recommendedPosition: string;
}

/** Report Builder screen response — read-only presentation with export controls (ARCH-05) */
export type ReportConfidence = "High" | "Medium" | "Low";

/** One decision on the report's answer page. */
export interface ReportDecision {
  action: string;
  why: string;
  confidence: ReportConfidence | null;
  confidenceReason: string | null;
}

/** A table built from data (never written by the model); its title is the takeaway. */
export interface ReportExhibit {
  id: "local_market" | "peer_range" | "dollar_impact" | "competitor_moves" | "regulatory" | "fee_income_trend" | "statistical_appendix";
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  note: string | null;
}

export interface ReportSource {
  label: string;
  detail: string;
  url: string | null;
}

export interface ReportSummaryResponse {
  title: string;
  /** Historical reference identity captured on the authenticated generation request. */
  identityContext?: HamiltonIdentitySnapshot;
  /** Answer page: one-sentence headline and up to three decisions (reports since v4 voice). */
  answer?: { headline: string; decisions: ReportDecision[]; /** The client goal the decisions are ranked by, when one was chosen. */ goal?: string | null };
  exhibits?: ReportExhibit[];
  /** "What to watch" lines from the trade-offs section. */
  watchlist?: string[];
  sources?: ReportSource[];
  executiveSummary: string[];
  snapshot: Array<{ label: string; current: string; proposed: string }>;
  strategicRationale: string;
  tradeoffs: Array<{ label: string; value: string }>;
  recommendation: string;
  implementationNotes: string[];
  /** Findings and tests the reader added to the report basket, shown as written */
  addedFindings?: Array<{ source: "Position" | "Ask" | "Test"; title: string; detail: string; identityContext?: HamiltonIdentitySnapshot }>;
  exportControls: {
    pdfEnabled: boolean;
    shareEnabled: boolean;
  };
}

export type ReportArtifactEvidencePolicy =
  | "verified-only"
  | "provisional-first"
  | "source-diligence";

export type ReportArtifactPeerBaselineSource =
  | "saved-peer-set"
  | "selected-institution-default"
  | "national";

export interface ReportArtifactMetadata {
  evidencePolicy: ReportArtifactEvidencePolicy;
  selectedSource: HamiltonPersistedContextSource;
  selectedSourceLabel: string | null;
  peerSetId: string | null;
  peerBaselineSource: ReportArtifactPeerBaselineSource | null;
  peerBaselineLabel: string | null;
  peerFallbackReason: string | null;
  selectedVerifiedFeeCount: number;
  selectedProvisionalFeeCount: number;
  selectedFeeDeltaCount: number;
}

/** Monitor screen response — signals and alerts, no recommendations (ARCH-05) */
export interface MonitorResponse {
  status: {
    overall: "stable" | "watch" | "worsening";
    newSignals: number;
    highPriorityAlerts: number;
  };
  priorityAlert?: {
    title: string;
    severity: string;
    impact: string;
    whyItMatters: string;
    actions: string[];
  };
  signalFeed: Array<{
    tsLabel: string;
    signalType: string;
    title: string;
    implication: string;
    tags?: string[];
  }>;
  watchlists: {
    institutions: string[];
    feeCategories: string[];
    regions: string[];
  };
}
