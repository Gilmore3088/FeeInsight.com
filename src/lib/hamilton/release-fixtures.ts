export interface HamiltonFixtureUser {
  id: number;
  label: string;
  homeInstitutionId: number | null;
  role: "premium";
}

export interface HamiltonFixtureInstitution {
  id: number;
  name: string;
  charterType: "bank" | "credit_union";
  stateCode: string;
  totalAssetsUsd: number | null;
  assetReportDate: string | null;
}

export interface HamiltonFixtureFeeRow {
  id: number;
  institutionId: number;
  feeCategory: string;
  amount: number | null;
  ratePercent: number | null;
  unit: "usd" | "percent";
  audience: "consumer" | "business" | "both" | "unknown";
  sourceDocumentId: number;
  sourceUrl: string;
  sourceAsOf: string;
  status: "published" | "held" | "proposed";
}

export interface HamiltonFixtureSavedAnalysis {
  id: string;
  userId: number;
  institutionId: number | null;
  prompt: string;
  legacyMissingContext: boolean;
  peerInstitutionIds: number[];
}

export interface HamiltonFixtureCorrectionHistory {
  institutionId: number;
  feeCategory: string;
  versions: Array<{
    sourceVersion: string;
    amount: number;
    status: "published" | "held" | "proposed";
    evidence: string;
  }>;
}

export interface HamiltonReleaseFixture {
  users: HamiltonFixtureUser[];
  institutions: HamiltonFixtureInstitution[];
  peerGroups: {
    complete: number[];
    floridaOnly: number[];
    thin: number[];
  };
  fees: HamiltonFixtureFeeRow[];
  savedAnalyses: HamiltonFixtureSavedAnalysis[];
  correctionHistory: HamiltonFixtureCorrectionHistory;
}

const TEMPLATE: HamiltonReleaseFixture = {
  users: [
    { id: 70001, label: "Synthetic primary analyst", homeInstitutionId: 8109, role: "premium" },
    { id: 70002, label: "Synthetic other workspace user", homeInstitutionId: 9201, role: "premium" },
  ],
  institutions: [
    { id: 8109, name: "Synthetic Space Coast CU", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 9_200_000_000, assetReportDate: "2026-06-30" },
    { id: 9101, name: "Synthetic Research Bank A", charterType: "bank", stateCode: "FL", totalAssetsUsd: 8_900_000_000, assetReportDate: "2026-06-30" },
    { id: 9102, name: "Synthetic Peer CU 1", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 8_700_000_000, assetReportDate: "2026-06-30" },
    { id: 9103, name: "Synthetic Peer CU 2", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 9_600_000_000, assetReportDate: "2026-03-31" },
    { id: 9104, name: "Synthetic Peer CU 3", charterType: "credit_union", stateCode: "GA", totalAssetsUsd: 9_100_000_000, assetReportDate: "2026-06-30" },
    { id: 9105, name: "Synthetic Peer CU 4", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: null, assetReportDate: null },
    { id: 9106, name: "Synthetic Peer CU 5", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 7_900_000_000, assetReportDate: "2025-06-30" },
    { id: 9107, name: "Synthetic Peer CU 6", charterType: "credit_union", stateCode: "TX", totalAssetsUsd: 10_100_000_000, assetReportDate: "2026-06-30" },
    { id: 9108, name: "Synthetic Peer CU 7", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 9_000_000_000, assetReportDate: "2026-06-30" },
    { id: 9109, name: "Synthetic Peer CU 8", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 9_300_000_000, assetReportDate: "2026-06-30" },
    { id: 9110, name: "Synthetic Peer CU 9", charterType: "credit_union", stateCode: "GA", totalAssetsUsd: 8_800_000_000, assetReportDate: "2026-06-30" },
    { id: 9111, name: "Synthetic Peer CU 10", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 9_400_000_000, assetReportDate: "2026-06-30" },
    { id: 9112, name: "Synthetic Peer CU 11", charterType: "credit_union", stateCode: "FL", totalAssetsUsd: 8_600_000_000, assetReportDate: "2026-06-30" },
    { id: 9201, name: "Synthetic Other User CU", charterType: "credit_union", stateCode: "WA", totalAssetsUsd: 2_500_000_000, assetReportDate: "2026-06-30" },
  ],
  peerGroups: {
    complete: [9102, 9103, 9104, 9106, 9107, 9108, 9109, 9110, 9111, 9112],
    floridaOnly: [9102, 9103, 9108, 9109, 9111, 9105, 9106],
    thin: [9102, 9105, 9106],
  },
  fees: [
    { id: 10001, institutionId: 8109, feeCategory: "overdraft", amount: 30, ratePercent: null, unit: "usd", audience: "consumer", sourceDocumentId: 5001, sourceUrl: "https://fixture.invalid/8109/fees-v1", sourceAsOf: "2026-06-30", status: "published" },
    { id: 10002, institutionId: 8109, feeCategory: "nsf", amount: 0, ratePercent: null, unit: "usd", audience: "consumer", sourceDocumentId: 5001, sourceUrl: "https://fixture.invalid/8109/fees-v1", sourceAsOf: "2026-06-30", status: "published" },
    { id: 10003, institutionId: 8109, feeCategory: "foreign_transaction", amount: null, ratePercent: 3, unit: "percent", audience: "consumer", sourceDocumentId: 5001, sourceUrl: "https://fixture.invalid/8109/fees-v1", sourceAsOf: "2026-06-30", status: "published" },
    { id: 10004, institutionId: 8109, feeCategory: "wire_domestic_outgoing", amount: null, ratePercent: null, unit: "usd", audience: "unknown", sourceDocumentId: 5001, sourceUrl: "https://fixture.invalid/8109/fees-v1", sourceAsOf: "2026-06-30", status: "proposed" },
    { id: 10102, institutionId: 9102, feeCategory: "nsf", amount: 25, ratePercent: null, unit: "usd", audience: "consumer", sourceDocumentId: 5102, sourceUrl: "https://fixture.invalid/9102/fees", sourceAsOf: "2026-06-30", status: "published" },
    { id: 10103, institutionId: 9103, feeCategory: "nsf", amount: 30, ratePercent: null, unit: "usd", audience: "consumer", sourceDocumentId: 5103, sourceUrl: "https://fixture.invalid/9103/fees", sourceAsOf: "2026-03-31", status: "published" },
    { id: 10108, institutionId: 9108, feeCategory: "nsf", amount: 0, ratePercent: null, unit: "usd", audience: "consumer", sourceDocumentId: 5108, sourceUrl: "https://fixture.invalid/9108/fees", sourceAsOf: "2026-06-30", status: "published" },
  ],
  savedAnalyses: [
    { id: "fixture-analysis-primary", userId: 70001, institutionId: 9101, prompt: "Compare this institution with us.", legacyMissingContext: false, peerInstitutionIds: [9102, 9103, 9108] },
    { id: "fixture-analysis-legacy", userId: 70001, institutionId: null, prompt: "Legacy answer without subject context.", legacyMissingContext: true, peerInstitutionIds: [] },
    { id: "fixture-analysis-other-user", userId: 70002, institutionId: 9201, prompt: "Private other-user answer.", legacyMissingContext: false, peerInstitutionIds: [] },
  ],
  correctionHistory: {
    institutionId: 9101,
    feeCategory: "overdraft",
    versions: [
      { sourceVersion: "v1", amount: 35, status: "held", evidence: "Synthetic old source later determined wrong." },
      { sourceVersion: "v1-corrected", amount: 30, status: "published", evidence: "Synthetic reviewed correction." },
      { sourceVersion: "v2", amount: 32, status: "proposed", evidence: "Synthetic newer source requires review." },
    ],
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Fresh fixture per test: mutation in one acceptance case cannot leak into another. */
export function createHamiltonReleaseFixture(): HamiltonReleaseFixture {
  return clone(TEMPLATE);
}

export function assertFixtureIsSynthetic(fixture: HamiltonReleaseFixture): string[] {
  const problems: string[] = [];
  if (fixture.users.length !== 2) problems.push("expected_two_users");
  if (!fixture.users.some((user) => user.homeInstitutionId === 8109)) problems.push("missing_space_coast_home");
  if (fixture.peerGroups.complete.length < 10) problems.push("complete_peer_set_too_small");
  if (fixture.peerGroups.thin.length >= 10) problems.push("thin_peer_set_not_thin");
  if (!fixture.fees.some((fee) => fee.amount === 0 && fee.status === "published")) problems.push("missing_genuine_zero");
  if (!fixture.fees.some((fee) => fee.amount === null && fee.ratePercent === null)) problems.push("missing_unknown_fee");
  if (!fixture.fees.some((fee) => fee.unit === "percent" && fee.ratePercent !== null)) problems.push("missing_rate_fee");
  if (!fixture.savedAnalyses.some((analysis) => analysis.legacyMissingContext)) problems.push("missing_legacy_saved_answer");
  if (!fixture.savedAnalyses.some((analysis) => analysis.userId === fixture.users[1].id)) problems.push("missing_cross_user_negative_fixture");
  if (!fixture.correctionHistory.versions.some((version) => version.status === "held")) problems.push("missing_held_correction");
  if (!fixture.correctionHistory.versions.some((version) => version.status === "proposed")) problems.push("missing_newer_conflict");
  for (const fee of fixture.fees) {
    if (!fee.sourceUrl.startsWith("https://fixture.invalid/")) problems.push(`non_synthetic_url:${fee.id}`);
  }
  return problems;
}
