export type HamiltonInitiativeId = "H01" | "H02" | "H03" | "H04" | "H05" | "H06" | "H07";
export type HamiltonImplementationStatus = "queued" | "in_progress" | "partial" | "preview_verified" | "released_verified";

export interface HamiltonComplaintEvidence {
  complaintId: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  complaint: string;
  initiatives: HamiltonInitiativeId[];
  taskIds: string[];
  acceptanceCaseIds: string[];
  implementationPrs: number[];
  owner: string;
  statusAtSnapshot: HamiltonImplementationStatus;
  mandatoryReleaseChecks: Array<
    "exact_sha_ci" | "authenticated_preview" | "inspected_output" | "release_approval" | "post_release_read"
  >;
}

export interface HamiltonReleaseProtectionSnapshot {
  observedAt: string;
  mainSha: string;
  branchProtected: boolean;
  requiredStatusContexts: string[];
  note: string;
}

export const HAMILTON_RELEASE_MATRIX_VERSION = 1 as const;
export const HAMILTON_RELEASE_MATRIX_SNAPSHOT = "2026-10-10T09:30:00Z";

/**
 * Release-evidence routing only. This table never marks a complaint fixed by itself.
 * Initiative issues remain authoritative for task/case proof and current status.
 */
export const HAMILTON_COMPLAINT_EVIDENCE: readonly HamiltonComplaintEvidence[] = [
  {
    complaintId: 1,
    complaint: "Multiple Ask/follow-up inputs and fragmented conversation state",
    initiatives: ["H04", "H05"],
    taskIds: ["H04-T01", "H04-T03", "H04-T04", "H04-T05", "H05-T03", "H05-T04"],
    acceptanceCaseIds: ["H04-AC1", "H04-AC2", "H04-AC3", "H04-AC4"],
    implementationPrs: [],
    owner: "H04/H05 autonomous lane",
    statusAtSnapshot: "queued",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
  {
    complaintId: 2,
    complaint: "Viewed research institutions are mislabeled as the user's institution",
    initiatives: ["H01", "H06"],
    taskIds: ["H01-T02", "H01-T04", "H01-T05", "H01-T06", "H06-T04"],
    acceptanceCaseIds: ["H01-AC1", "H01-AC2", "H01-AC3", "H01-AC4"],
    implementationPrs: [985, 995],
    owner: "H01/H02 core lane + H06 trust lane",
    statusAtSnapshot: "in_progress",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
  {
    complaintId: 3,
    complaint: "A peer-list request returns a report instead of the requested list",
    initiatives: ["H02", "H04"],
    taskIds: ["H02-T02", "H02-T07", "H02-T08", "H02-T09", "H04-T05"],
    acceptanceCaseIds: ["H02-AC1", "H02-AC2", "H02-AC3", "H04-AC2"],
    implementationPrs: [988],
    owner: "H01/H02 core lane",
    statusAtSnapshot: "in_progress",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
  {
    complaintId: 4,
    complaint: "Peer results omit total assets and reporting context",
    initiatives: ["H02", "H06"],
    taskIds: ["H02-T03", "H02-T04", "H02-T05", "H02-T06", "H06-T04", "H06-T05"],
    acceptanceCaseIds: ["H02-AC1", "H02-AC2", "H02-AC4"],
    implementationPrs: [988, 995],
    owner: "H01/H02 core lane + H06 trust lane",
    statusAtSnapshot: "in_progress",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
  {
    complaintId: 5,
    complaint: "Hamilton output is word-heavy, visually inconsistent and task-inappropriate",
    initiatives: ["H05", "H06"],
    taskIds: ["H05-T01", "H05-T02", "H05-T03", "H05-T04", "H05-T05", "H05-T06", "H06-T06"],
    acceptanceCaseIds: ["H05-AC1", "H05-AC2", "H05-AC3", "H05-AC4"],
    implementationPrs: [],
    owner: "H04/H05 autonomous lane",
    statusAtSnapshot: "queued",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
  {
    complaintId: 6,
    complaint: "Ordinary fee corrections require engineering instead of an admin workflow",
    initiatives: ["H03", "H06", "H07"],
    taskIds: ["H03-T02", "H03-T04", "H03-T05", "H03-T06", "H03-T07", "H03-T10", "H06-T03", "H07-T04"],
    acceptanceCaseIds: ["H03-AC1", "H03-AC2", "H03-AC3", "H03-AC4", "H07-AC3"],
    implementationPrs: [],
    owner: "H03 autonomous lane",
    statusAtSnapshot: "queued",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
  {
    complaintId: 7,
    complaint: "Hamilton is not ready for trustworthy research/consulting use",
    initiatives: ["H06", "H07"],
    taskIds: ["H06-T01", "H06-T02", "H06-T04", "H06-T05", "H06-T06", "H06-T08", "H06-T09", "H07-T03", "H07-T08", "H07-T09", "H07-T10"],
    acceptanceCaseIds: ["H06-AC1", "H06-AC2", "H06-AC3", "H06-AC4", "H07-AC1", "H07-AC2", "H07-AC4"],
    implementationPrs: [995, 993],
    owner: "H06/H07 trust-release lane",
    statusAtSnapshot: "in_progress",
    mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval", "post_release_read"],
  },
];

export const HAMILTON_RELEASE_PROTECTION_SNAPSHOT: HamiltonReleaseProtectionSnapshot = {
  observedAt: "2026-10-10T09:30:00Z",
  mainSha: "a22efb7896772735e57f7dde59f070d304389ca6",
  branchProtected: false,
  requiredStatusContexts: [],
  note: "GitHub branch API reported main unprotected with no required status contexts. Repository intake/CI rules are process controls, not a server-side merge barrier.",
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
  const requiredChecks = new Set([
    "exact_sha_ci",
    "authenticated_preview",
    "inspected_output",
    "release_approval",
    "post_release_read",
  ]);

  for (const entry of entries) {
    if (!expectedComplaints.has(entry.complaintId)) problems.push(`unknown_complaint:${entry.complaintId}`);
    if (seen.has(entry.complaintId)) problems.push(`duplicate_complaint:${entry.complaintId}`);
    seen.add(entry.complaintId);
    if (!entry.complaint.trim()) problems.push(`missing_complaint_text:${entry.complaintId}`);
    if (!entry.owner.trim()) problems.push(`missing_owner:${entry.complaintId}`);
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
      if (!entry.taskIds.some((id) => id.startsWith(`${initiative}-`)) && initiative !== "H07") {
        problems.push(`initiative_without_task:${entry.complaintId}:${initiative}`);
      }
    }
    for (const check of requiredChecks) {
      if (!entry.mandatoryReleaseChecks.includes(check as HamiltonComplaintEvidence["mandatoryReleaseChecks"][number])) {
        problems.push(`missing_release_check:${entry.complaintId}:${check}`);
      }
    }
    if (
      ["in_progress", "partial", "preview_verified", "released_verified"].includes(entry.statusAtSnapshot)
      && entry.implementationPrs.length === 0
    ) {
      problems.push(`active_without_pr:${entry.complaintId}`);
    }
  }

  for (const complaintId of expectedComplaints) {
    if (!seen.has(complaintId)) problems.push(`unmapped_complaint:${complaintId}`);
  }
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
    if (evidence.evidenceRefs.length === 0) problems.push(`missing_evidence_ref:${caseId}`);
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
      && entries[0].evidenceRefs.length > 0;
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
    if (evidence.evidenceRefs.length === 0) problems.push(`missing_failure_evidence_ref:${caseId}`);
  }

  const passedCases = HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS.filter((caseId) => {
    const entries = byId.get(caseId) ?? [];
    return entries.length === 1
      && entries[0].candidateSha === input.candidateSha
      && entries[0].status === "passed"
      && entries[0].containment.trim().length > 0
      && entries[0].rollbackOrRetry.trim().length > 0
      && entries[0].evidenceRefs.length > 0;
  }).length;

  return {
    ready: problems.length === 0,
    problems,
    passedCases,
    requiredCases: HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS.length,
  };
}
