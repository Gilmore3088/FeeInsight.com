/**
 * H07-T01 (#982): the code half of the Hamilton complaint-to-evidence matrix.
 *
 * `docs/plans/hamilton-h07-acceptance-matrix.md` is the one matrix: task status, owners, PRs,
 * live results and blockers live there and only there. This file keeps what does not go stale
 * and can be checked by a test: the stable complaint, task and case ids, and, for every
 * acceptance case, the automated tests that exercise it on synthetic data and the named manual
 * check a person runs on the live site. A synthetic pass is evidence for a case, never its pass.
 * Version 1 (2026-10-10, PR #996) also carried owners, PRs and a status per complaint; those went
 * stale within days (B11), so version 2 drops them here and leaves them to the document.
 */
export type HamiltonInitiativeId = "H01" | "H02" | "H03" | "H04" | "H05" | "H06" | "H07";

export type HamiltonReleaseCheck =
  | "exact_sha_ci" | "authenticated_preview" | "inspected_output" | "release_approval" | "post_release_read";

export interface HamiltonComplaintEvidence {
  complaintId: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  complaint: string;
  initiatives: HamiltonInitiativeId[];
  taskIds: string[];
  acceptanceCaseIds: string[];
  mandatoryReleaseChecks: HamiltonReleaseCheck[];
}

export interface HamiltonReleaseProtectionSnapshot {
  observedAt: string;
  mainSha: string;
  branchProtected: boolean;
  requiredStatusContexts: string[];
  note: string;
}

export const HAMILTON_RELEASE_MATRIX_VERSION = 2 as const;
export const HAMILTON_RELEASE_MATRIX_SNAPSHOT = "2026-10-17";
/** The matrix document this file must agree with. */
export const HAMILTON_RELEASE_MATRIX_DOC = "docs/plans/hamilton-h07-acceptance-matrix.md";

const ALL_CHECKS: HamiltonReleaseCheck[] = ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"];
const range = (initiative: string, kind: "T" | "AC", from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${initiative}-${kind}${kind === "T" ? String(from + i).padStart(2, "0") : from + i}`);

/** The seven complaints in #975's wording (C01 to C07 in the matrix document). */
export const HAMILTON_COMPLAINT_EVIDENCE: readonly HamiltonComplaintEvidence[] = [
  {
    complaintId: 1,
    complaint: "Multiple Ask/follow-up inputs",
    initiatives: ["H04", "H05"],
    taskIds: [...range("H04", "T", 1, 10), "H05-T03", "H05-T04"],
    acceptanceCaseIds: [...range("H04", "AC", 1, 4), "H05-AC1", "H07-AC2"],
    mandatoryReleaseChecks: ALL_CHECKS,
  },
  {
    complaintId: 2,
    complaint: "Viewed institutions called \"your institution\"",
    initiatives: ["H01", "H06"],
    taskIds: [...range("H01", "T", 1, 10), "H06-T04"],
    acceptanceCaseIds: [...range("H01", "AC", 1, 4), "H06-AC1", "H07-AC2"],
    mandatoryReleaseChecks: ALL_CHECKS,
  },
  {
    complaintId: 3,
    complaint: "Peer request gives a report instead of a list",
    initiatives: ["H02", "H04", "H05"],
    taskIds: ["H02-T01", "H02-T02", "H02-T07", "H02-T08", "H02-T09", "H04-T05", "H05-T04"],
    acceptanceCaseIds: [...range("H02", "AC", 1, 3), "H04-AC2", "H05-AC1", "H07-AC2"],
    mandatoryReleaseChecks: ALL_CHECKS,
  },
  {
    complaintId: 4,
    complaint: "Peer asset size missing",
    initiatives: ["H02", "H06"],
    taskIds: [...range("H02", "T", 3, 6), "H06-T03", "H06-T04"],
    acceptanceCaseIds: ["H02-AC1", "H02-AC2", "H02-AC4", "H06-AC3"],
    mandatoryReleaseChecks: ALL_CHECKS,
  },
  {
    complaintId: 5,
    complaint: "Word-heavy output and inconsistent fonts",
    initiatives: ["H05"],
    taskIds: range("H05", "T", 1, 8),
    acceptanceCaseIds: range("H05", "AC", 1, 4),
    mandatoryReleaseChecks: ALL_CHECKS,
  },
  {
    complaintId: 6,
    complaint: "Ordinary corrections require a coding assistant",
    initiatives: ["H03", "H07"],
    taskIds: [...range("H03", "T", 1, 12), "H07-T04"],
    acceptanceCaseIds: [...range("H03", "AC", 1, 4), "H07-AC3"],
    mandatoryReleaseChecks: ALL_CHECKS,
  },
  {
    complaintId: 7,
    complaint: "Hamilton is not ready for consulting (release scope: research-only readiness)",
    initiatives: ["H06", "H07"],
    taskIds: [...range("H06", "T", 1, 10), ...range("H07", "T", 1, 10)],
    acceptanceCaseIds: [...range("H06", "AC", 1, 4), ...range("H07", "AC", 1, 4)],
    mandatoryReleaseChecks: ALL_CHECKS,
  },
];

/** Read 2026-10-17 from the public API: `branches/main` and `rules/branches/main`. */
export const HAMILTON_RELEASE_PROTECTION_SNAPSHOT: HamiltonReleaseProtectionSnapshot = {
  observedAt: "2026-10-17T03:00:00Z",
  mainSha: "86fd3f2c133443728c68827c14596d78a9624578",
  branchProtected: false,
  requiredStatusContexts: [],
  note: "GitHub reported main unprotected with no ruleset. CI and review rules are process controls, not a server-side merge barrier; James applies the approved ruleset (H07-T06).",
};

export function validateHamiltonComplaintEvidence(
  entries: readonly HamiltonComplaintEvidence[] = HAMILTON_COMPLAINT_EVIDENCE,
): string[] {
  const problems: string[] = [];
  const expectedComplaints = new Set([1, 2, 3, 4, 5, 6, 7]);
  const seen = new Set<number>();
  const initiativePattern = /^H0[1-7]$/;
  const taskPattern = /^H0[1-7]-T\d{2}$/;
  const casePattern = /^H0[1-7]-AC[1-4]$/;

  for (const entry of entries) {
    if (!expectedComplaints.has(entry.complaintId)) problems.push(`unknown_complaint:${entry.complaintId}`);
    if (seen.has(entry.complaintId)) problems.push(`duplicate_complaint:${entry.complaintId}`);
    seen.add(entry.complaintId);
    if (!entry.complaint.trim()) problems.push(`missing_complaint_text:${entry.complaintId}`);
    if (entry.initiatives.length === 0 || entry.initiatives.some((id) => !initiativePattern.test(id))) {
      problems.push(`invalid_initiative_mapping:${entry.complaintId}`);
    }
    if (entry.taskIds.length === 0 || entry.taskIds.some((id) => !taskPattern.test(id))) {
      problems.push(`invalid_task_mapping:${entry.complaintId}`);
    }
    if (entry.acceptanceCaseIds.length === 0 || entry.acceptanceCaseIds.some((id) => !casePattern.test(id))) {
      problems.push(`invalid_acceptance_mapping:${entry.complaintId}`);
    }
    for (const initiative of entry.initiatives) {
      if (!entry.taskIds.some((id) => id.startsWith(`${initiative}-`))) {
        problems.push(`initiative_without_task:${entry.complaintId}:${initiative}`);
      }
    }
    for (const check of ALL_CHECKS) {
      if (!entry.mandatoryReleaseChecks.includes(check)) {
        problems.push(`missing_release_check:${entry.complaintId}:${check}`);
      }
    }
  }

  for (const complaintId of expectedComplaints) {
    if (!seen.has(complaintId)) problems.push(`unmapped_complaint:${complaintId}`);
  }
  return problems;
}

export interface HamiltonAcceptanceCheck {
  caseId: string;
  /** The case in a line, as the matrix document words it. */
  summary: string;
  /** Repo paths of tests that exercise the case on synthetic data. Evidence, never the pass. */
  automated: string[];
  /** The check a person runs on the live site (or preview), listed by id in the matrix document. */
  manual: { id: string; what: string } | null;
}

const RESEARCH_JOURNEY = "tests/e2e/hamilton/research-journey.pw.ts";
const ADMIN_JOURNEY = "tests/e2e/hamilton/admin-correction.pw.ts";
const manual = (caseId: string, what: string) => ({ id: `MC-${caseId}`, what });

/** Every acceptance case of H01 to H07, each with its automated tests and its named manual check. */
export const HAMILTON_ACCEPTANCE_CHECKS: readonly HamiltonAcceptanceCheck[] = [
  {
    caseId: "H01-AC1", summary: "Linked home: browse three others, \"compare with us\"; the home stays unchanged",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/account-context.test.ts", "src/lib/hamilton/workspace-context.test.ts", "src/app/api/research/hamilton/route.account-context.test.ts"],
    manual: manual("H01-AC1", "Signed in with a second, linked login on the live site: browse three other institutions, ask \"compare with us\", confirm the home is unchanged"),
  },
  {
    caseId: "H01-AC2", summary: "No home: a research subject is never called \"your\"",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/identity-display.test.ts", "src/lib/hamilton/ask-service.test.ts"],
    manual: manual("H01-AC2", "Live login with no linked institution: ask about \"us\" and confirm the answer says no institution is linked"),
  },
  {
    caseId: "H01-AC3", summary: "Save A, switch to B, reopen and export: still A",
    automated: [RESEARCH_JOURNEY, "src/app/pro/(hamilton)/analyze/page.test.tsx", "src/lib/hamilton/analysis-identity.test.ts"],
    manual: manual("H01-AC3", "Live: save an answer about A, switch to B, reopen the saved answer and download its PDF; both name A"),
  },
  {
    caseId: "H01-AC4", summary: "Cross-account read denied; a delayed answer is not relabeled",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/private-workspace.h01-acceptance.test.ts", "src/components/hamilton/analyze/StructuredAsk.h01-acceptance.test.tsx"],
    manual: manual("H01-AC4", "Live with two logins: the second cannot open the first's saved research link; switch subject while an answer loads"),
  },
  {
    caseId: "H02-AC1", summary: "\"List ten similarly sized credit unions\": ten rows with assets and dates, no report",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/peer-list.test.ts", "src/lib/data-store/hamilton-peer-list.db.test.ts"],
    manual: manual("H02-AC1", "Live: ask for ten similarly sized credit unions; ten rows, each with total assets and a reporting date, and the size range stated"),
  },
  {
    caseId: "H02-AC2", summary: "Only three match: the shortage is explained; unknown assets are not counted",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/peer-list-service.test.ts", "src/lib/data-store/hamilton-peer-list.db.test.ts"],
    manual: manual("H02-AC2", "Live: a narrow request (one state, tight size band) says how many matched and why there are fewer than asked"),
  },
  {
    caseId: "H02-AC3", summary: "\"Only Florida\", then \"Compare their NSF fees\": same list and subject",
    automated: [RESEARCH_JOURNEY, "src/components/hamilton/analyze/PeerAwareStructuredAsk.test.tsx", "src/lib/hamilton/peer-list-service.test.ts"],
    manual: manual("H02-AC3", "Live: list, then \"Only Florida\", then \"Compare their NSF fees\"; the fee table covers exactly the Florida rows"),
  },
  {
    caseId: "H02-AC4", summary: "Units and periods right, missing never $0, links open, zero model calls",
    automated: [RESEARCH_JOURNEY, "src/lib/data-store/hamilton-peer-fees.db.test.ts", "src/lib/data-store/hamilton-peer-fees.test.ts", "src/app/api/hamilton/ask/route.peer-list.test.ts"],
    manual: manual("H02-AC4", "Live: open each filing and fee schedule link from a peer table; no AI usage row is written for the turn"),
  },
  {
    caseId: "H03-AC1", summary: "Hold a wrong fee: it leaves comparisons, is auditable, never shows as $0 or free",
    automated: [ADMIN_JOURNEY, "src/lib/fee-hold.test.ts"],
    manual: manual("H03-AC1", "Production admin, approved scope only: hold one wrong fee and confirm the institution page and Hamilton drop it"),
  },
  {
    caseId: "H03-AC2", summary: "Correct and publish: the institution page and Hamilton agree",
    automated: [ADMIN_JOURNEY, "src/lib/fee-corrections.db.test.ts"],
    manual: manual("H03-AC2", "Preview or approved production scope: correct one fee and compare the institution page with a Hamilton answer"),
  },
  {
    caseId: "H03-AC3", summary: "Old-source replay never brings the old value back; a newer source goes to review",
    automated: ["src/lib/fee-corrections.db.test.ts", "src/lib/fee-corrections.adversarial.test.ts"],
    manual: manual("H03-AC3", "After a correction, a re-read of the same document leaves the corrected value; a newer schedule appears under conflicts"),
  },
  {
    caseId: "H03-AC4", summary: "Stale and unauthorized writes fail; a reversal keeps history",
    automated: [ADMIN_JOURNEY, "src/lib/fee-corrections.db.test.ts", "src/app/admin/institution/[id]/actions.corrections.test.ts"],
    manual: manual("H03-AC4", "Two admin tabs on one fee: the second save is refused; a reversal adds a history row and removes none"),
  },
  {
    caseId: "H04-AC1", summary: "One free-text field in every state, from a non-Analyze page",
    automated: [RESEARCH_JOURNEY, "src/components/hamilton/analyze/AnalyzeWorkspace.test.tsx"],
    manual: manual("H04-AC1", "Live: from Monitor and Reports, start a question and count the text inputs through clarification, answer and follow-up"),
  },
  {
    caseId: "H04-AC2", summary: "Peers, Florida, NSF, \"with us\": coherent across turns",
    automated: [RESEARCH_JOURNEY, "src/components/hamilton/analyze/AnalyzeWorkspace.conversation.test.tsx", "src/lib/hamilton/conversation-context.test.ts"],
    manual: manual("H04-AC2", "Live: the four-turn sequence keeps one subject and one peer list"),
  },
  {
    caseId: "H04-AC3", summary: "Clarification in the same composer; a new conversation inherits nothing",
    automated: ["src/components/hamilton/analyze/AnalyzeWorkspace.conversation.test.tsx", "src/components/hamilton/analyze/StructuredAsk.test.tsx"],
    manual: manual("H04-AC3", "Live: a question that needs a clarification is answered in the same box; New question starts with no earlier turns"),
  },
  {
    caseId: "H04-AC4", summary: "Failure, double submit, late response; phone and keyboard",
    automated: ["src/components/hamilton/analyze/AnalyzeWorkspace.double-submit.test.tsx", "src/components/hamilton/analyze/StructuredAsk.double-submit.test.tsx"],
    manual: manual("H04-AC4", "Phone and keyboard only: double Enter, offline retry and a slow answer leave one answer and the question kept"),
  },
  {
    caseId: "H05-AC1", summary: "Peer request: criteria and table first, no automatic report",
    automated: [RESEARCH_JOURNEY, "src/components/hamilton/analyze/answer-order.test.tsx", "src/components/hamilton/analyze/PeerAwareStructuredAsk.test.tsx"],
    manual: manual("H05-AC1", "Live: a peer request shows criteria and the table before any prose, and starts no report"),
  },
  {
    caseId: "H05-AC2", summary: "Same typography and formats across answer types",
    automated: ["src/lib/hamilton/css-tokens.test.ts"],
    manual: manual("H05-AC2", "James's visual review of a lookup, a comparison, a peer list and a written answer side by side"),
  },
  {
    caseId: "H05-AC3", summary: "Long names, missing assets, a wide table usable at phone width and 200% zoom",
    automated: [RESEARCH_JOURNEY],
    manual: manual("H05-AC3", "Live at 390px and at 200% browser zoom: the peer and fee tables scroll inside their frame, the page does not"),
  },
  {
    caseId: "H05-AC4", summary: "Export matches the saved screen; James accepts the visual change",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/evidence-export.test.ts", "src/lib/hamilton/board-brief.pdf.test.tsx"],
    manual: manual("H05-AC4", "James compares a saved answer's screen with its downloaded PDF and records his acceptance"),
  },
  {
    caseId: "H06-AC1", summary: "$10 vs $35: a false \"charges $35/$25\" is not verified; a $25 difference keeps its inputs",
    automated: ["src/lib/hamilton/evidence-regression-set.test.ts", "src/lib/hamilton/written-answer-binding.test.ts", "src/lib/hamilton/narrative-bound.test.ts"],
    manual: manual("H06-AC1", "A person reviews the 25 regression cases' expected outcomes (#629) and one live written answer"),
  },
  {
    caseId: "H06-AC2", summary: "-10% is never an \"increase\"; a 2024 value is never shown as 2026",
    automated: ["src/lib/hamilton/evidence-contract.test.ts", "src/lib/hamilton/evidence-regression-set.test.ts"],
    manual: manual("H06-AC2", "Live: a fee that fell shows as a decrease with both dated inputs"),
  },
  {
    caseId: "H06-AC3", summary: "Missing, stale, provisional and user values distinct; $0 vs unknown; rate vs dollar",
    automated: [RESEARCH_JOURNEY, "src/lib/hamilton/evidence-regression-set.test.ts", "src/lib/data-store/hamilton-peer-fees.db.test.ts"],
    manual: manual("H06-AC3", "Live: a peer fee table with a $0 fee, a rate fee and an old source shows each as itself"),
  },
  {
    caseId: "H06-AC4", summary: "Reopen and export an old \"high\" answer and a new one: limits shown, nothing rewritten",
    automated: [RESEARCH_JOURNEY, "src/app/pro/(hamilton)/analyze/actions.h06-reopen.test.ts", "src/lib/hamilton/confidence-legacy.test.tsx"],
    manual: manual("H06-AC4", "Live: reopen a saved answer from before Oct 10 and download its PDF; its limits show and its text is unchanged"),
  },
  {
    caseId: "H07-AC1", summary: "Any complaint traces to task, PR, test run, output and release SHA",
    automated: ["src/lib/hamilton/release-acceptance.test.ts"],
    manual: manual("H07-AC1", "A reviewer follows one complaint in the matrix document to its PR, CI run, inspected output and deployed SHA"),
  },
  {
    caseId: "H07-AC2", summary: "The full signed-in research journey passes",
    automated: [RESEARCH_JOURNEY],
    manual: manual("H07-AC2", "James's live computer-use run of the research journey on production, with the deployed SHA recorded"),
  },
  {
    caseId: "H07-AC3", summary: "The full admin correction journey passes in isolation",
    automated: [ADMIN_JOURNEY, "src/lib/fee-corrections.db.test.ts"],
    manual: manual("H07-AC3", "An operator completes hold, correct and reverse on a preview database without SQL or code"),
  },
  {
    caseId: "H07-AC4", summary: "Deployed SHA matches the reviewed SHA; post-release checks; James's go/no-go",
    automated: [],
    manual: manual("H07-AC4", "Record the deployed SHA, run each initiative's read checks, and record James's research-only go/no-go"),
  },
];

/** Every case has at least one automated test or a named manual check, once, with sane paths. */
export function validateHamiltonAcceptanceChecks(
  entries: readonly HamiltonAcceptanceCheck[] = HAMILTON_ACCEPTANCE_CHECKS,
  required: readonly string[] = HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.caseId)) problems.push(`duplicate_check:${entry.caseId}`);
    seen.add(entry.caseId);
    if (!required.includes(entry.caseId)) problems.push(`unknown_check:${entry.caseId}`);
    if (!entry.summary.trim()) problems.push(`missing_summary:${entry.caseId}`);
    if (entry.automated.length === 0 && !entry.manual) problems.push(`unchecked_case:${entry.caseId}`);
    for (const path of entry.automated) {
      if (!/^(src|tests)\/.+\.(test|pw)\.tsx?$/.test(path)) {
        problems.push(`not_a_test_path:${entry.caseId}:${path}`);
      }
    }
    if (entry.manual && (!/^MC-H0[1-7]-AC[1-4]$/.test(entry.manual.id) || !entry.manual.what.trim())) {
      problems.push(`invalid_manual_check:${entry.caseId}`);
    }
  }
  for (const caseId of required) if (!seen.has(caseId)) problems.push(`missing_check:${caseId}`);
  return problems;
}

export function releaseEvidenceIsComplete(input: {
  exactShaCi: boolean;
  authenticatedPreview: boolean;
  inspectedOutput: boolean;
  releaseApproval: boolean;
  postReleaseRead: boolean;
}): boolean {
  return input.exactShaCi
    && input.authenticatedPreview
    && input.inspectedOutput
    && input.releaseApproval
    && input.postReleaseRead;
}


export type HamiltonAcceptanceCaseStatus = "passed" | "failed" | "skipped" | "blocked";

export interface HamiltonAcceptanceCaseEvidence {
  caseId: string;
  candidateSha: string;
  status: HamiltonAcceptanceCaseStatus;
  inspectedOutput: boolean;
  evidenceRefs: string[];
}

export interface HamiltonReleaseCandidateAssessment {
  ready: boolean;
  problems: string[];
  passedCases: number;
  requiredCases: number;
}

export const HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS: readonly string[] = (
  ["H01", "H02", "H03", "H04", "H05", "H06", "H07"] as const
).flatMap((initiative) => [1, 2, 3, 4].map((n) => `${initiative}-AC${n}`));

/**
 * Candidate packet gate only. It cannot grant approval or prove deployment.
 * Every initiative case must be passed on the exact candidate SHA with an inspected
 * output/evidence reference. Skipped/blocked cases stay release blockers.
 */
function hasNonBlankEvidenceRefs(refs: unknown): refs is string[] {
  return Array.isArray(refs)
    && refs.length > 0
    && refs.every((ref) => typeof ref === "string" && ref.trim().length > 0);
}

/** A reference must be nonblank; a reference alone does not prove inspection or validity. */
export function assessHamiltonReleaseCandidate(input: {
  candidateSha: string;
  cases: readonly HamiltonAcceptanceCaseEvidence[];
}): HamiltonReleaseCandidateAssessment {
  const problems: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(input.candidateSha)) problems.push("invalid_candidate_sha");
  const byId = new Map<string, HamiltonAcceptanceCaseEvidence[]>();
  for (const entry of input.cases) {
    const group = byId.get(entry.caseId);
    if (group) group.push(entry);
    else byId.set(entry.caseId, [entry]);
  }

  for (const caseId of HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS) {
    const entries = byId.get(caseId) ?? [];
    if (entries.length === 0) {
      problems.push(`missing_case:${caseId}`);
      continue;
    }
    if (entries.length > 1) {
      problems.push(`duplicate_case:${caseId}`);
      continue;
    }
    const evidence = entries[0];
    if (evidence.candidateSha !== input.candidateSha) problems.push(`wrong_sha:${caseId}`);
    if (evidence.status !== "passed") problems.push(`${evidence.status}_case:${caseId}`);
    if (!evidence.inspectedOutput) problems.push(`uninspected_output:${caseId}`);
    if (!hasNonBlankEvidenceRefs(evidence.evidenceRefs)) problems.push(`missing_evidence_ref:${caseId}`);
  }

  for (const caseId of byId.keys()) {
    if (!HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS.includes(caseId)) problems.push(`unknown_case:${caseId}`);
  }

  const passedCases = HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS.filter((caseId) => {
    const entries = byId.get(caseId) ?? [];
    return entries.length === 1
      && entries[0].candidateSha === input.candidateSha
      && entries[0].status === "passed"
      && entries[0].inspectedOutput
      && hasNonBlankEvidenceRefs(entries[0].evidenceRefs);
  }).length;

  return {
    ready: problems.length === 0,
    problems,
    passedCases,
    requiredCases: HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS.length,
  };
}


export const HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS = [
  "failed_request",
  "duplicate_submit",
  "delayed_response",
  "provider_stop",
  "database_failure",
  "cache_refresh_failure",
  "invalid_migration",
] as const;

export type HamiltonFailureRecoveryId = (typeof HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS)[number];

export interface HamiltonFailureRecoveryEvidence {
  caseId: HamiltonFailureRecoveryId;
  candidateSha: string;
  status: "passed" | "failed" | "skipped" | "blocked";
  containment: string;
  rollbackOrRetry: string;
  evidenceRefs: string[];
}

export function assessHamiltonFailureRecovery(input: {
  candidateSha: string;
  cases: readonly HamiltonFailureRecoveryEvidence[];
}): { ready: boolean; problems: string[]; passedCases: number; requiredCases: number } {
  const problems: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(input.candidateSha)) problems.push("invalid_failure_candidate_sha");
  const byId = new Map<HamiltonFailureRecoveryId, HamiltonFailureRecoveryEvidence[]>();
  for (const entry of input.cases) {
    const group = byId.get(entry.caseId);
    if (group) group.push(entry);
    else byId.set(entry.caseId, [entry]);
  }

  for (const caseId of HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS) {
    const entries = byId.get(caseId) ?? [];
    if (entries.length === 0) {
      problems.push(`missing_failure_case:${caseId}`);
      continue;
    }
    if (entries.length > 1) {
      problems.push(`duplicate_failure_case:${caseId}`);
      continue;
    }
    const evidence = entries[0];
    if (evidence.candidateSha !== input.candidateSha) problems.push(`wrong_failure_sha:${caseId}`);
    if (evidence.status !== "passed") problems.push(`${evidence.status}_failure_case:${caseId}`);
    if (!evidence.containment.trim()) problems.push(`missing_containment:${caseId}`);
    if (!evidence.rollbackOrRetry.trim()) problems.push(`missing_rollback_or_retry:${caseId}`);
    if (!hasNonBlankEvidenceRefs(evidence.evidenceRefs)) problems.push(`missing_failure_evidence_ref:${caseId}`);
  }

  for (const caseId of byId.keys()) {
    if (!HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS.includes(caseId)) {
      problems.push(`unknown_failure_case:${caseId}`);
    }
  }

  const passedCases = HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS.filter((caseId) => {
    const entries = byId.get(caseId) ?? [];
    return entries.length === 1
      && entries[0].candidateSha === input.candidateSha
      && entries[0].status === "passed"
      && entries[0].containment.trim().length > 0
      && entries[0].rollbackOrRetry.trim().length > 0
      && hasNonBlankEvidenceRefs(entries[0].evidenceRefs);
  }).length;

  return {
    ready: problems.length === 0,
    problems,
    passedCases,
    requiredCases: HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS.length,
  };
}
