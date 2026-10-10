import { describe, expect, it } from "vitest";
import {
  HAMILTON_COMPLAINT_EVIDENCE,
  HAMILTON_RELEASE_PROTECTION_SNAPSHOT,
  releaseEvidenceIsComplete,
  validateHamiltonComplaintEvidence,
  assessHamiltonReleaseCandidate,
  HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS,
  assessHamiltonFailureRecovery,
  HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS,
  type HamiltonFailureRecoveryEvidence,
  type HamiltonAcceptanceCaseEvidence,
  type HamiltonComplaintEvidence,
} from "./release-acceptance";

describe("Hamilton complaint-to-evidence matrix", () => {
  it("maps all seven complaints to stable tasks, acceptance cases, owners and release checks", () => {
    expect(validateHamiltonComplaintEvidence()).toEqual([]);
    expect(HAMILTON_COMPLAINT_EVIDENCE.map((entry) => entry.complaintId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("fails when a complaint silently disappears", () => {
    expect(validateHamiltonComplaintEvidence(HAMILTON_COMPLAINT_EVIDENCE.slice(1)))
      .toContain("unmapped_complaint:1");
  });

  it("fails duplicate complaint mappings instead of treating them as additional proof", () => {
    const duplicated = [...HAMILTON_COMPLAINT_EVIDENCE, HAMILTON_COMPLAINT_EVIDENCE[0]];
    expect(validateHamiltonComplaintEvidence(duplicated)).toContain("duplicate_complaint:1");
  });

  it("fails an active work claim with no implementation PR", () => {
    const bad: HamiltonComplaintEvidence = {
      ...HAMILTON_COMPLAINT_EVIDENCE[0],
      statusAtSnapshot: "in_progress",
      implementationPrs: [],
    };
    expect(validateHamiltonComplaintEvidence([bad, ...HAMILTON_COMPLAINT_EVIDENCE.slice(1)]))
      .toContain("active_without_pr:1");
  });

  it("fails a missing mandatory release gate", () => {
    const bad: HamiltonComplaintEvidence = {
      ...HAMILTON_COMPLAINT_EVIDENCE[1],
      mandatoryReleaseChecks: ["exact_sha_ci", "authenticated_preview", "inspected_output", "release_approval"],
    };
    expect(validateHamiltonComplaintEvidence([
      HAMILTON_COMPLAINT_EVIDENCE[0],
      bad,
      ...HAMILTON_COMPLAINT_EVIDENCE.slice(2),
    ])).toContain("missing_release_check:2:post_release_read");
  });

  it("does not treat green CI as release completion", () => {
    expect(releaseEvidenceIsComplete({
      exactShaCi: true,
      authenticatedPreview: false,
      inspectedOutput: false,
      releaseApproval: false,
      postReleaseRead: false,
    })).toBe(false);
  });

  it("requires every release boundary including post-release reads", () => {
    expect(releaseEvidenceIsComplete({
      exactShaCi: true,
      authenticatedPreview: true,
      inspectedOutput: true,
      releaseApproval: true,
      postReleaseRead: true,
    })).toBe(true);
  });

  it("records that current main has process gates but no server-side protection", () => {
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.mainSha).toBe("a22efb7896772735e57f7dde59f070d304389ca6");
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.branchProtected).toBe(false);
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.requiredStatusContexts).toEqual([]);
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.note).toContain("not a server-side merge barrier");
  });
});


describe("Hamilton release-candidate packet", () => {
  const sha = "a".repeat(40);
  const allPassed = (): HamiltonAcceptanceCaseEvidence[] =>
    HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS.map((caseId) => ({
      caseId,
      candidateSha: sha,
      status: "passed",
      inspectedOutput: true,
      evidenceRefs: [`artifact:${caseId}`],
    }));

  it("requires all 28 initiative acceptance cases", () => {
    expect(HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS).toHaveLength(28);
    const result = assessHamiltonReleaseCandidate({ candidateSha: sha, cases: allPassed() });
    expect(result).toEqual({ ready: true, problems: [], passedCases: 28, requiredCases: 28 });
  });

  it("keeps a skipped required browser case as a release blocker", () => {
    const cases = allPassed();
    cases.find((entry) => entry.caseId === "H04-AC4")!.status = "skipped";
    const result = assessHamiltonReleaseCandidate({ candidateSha: sha, cases });
    expect(result.ready).toBe(false);
    expect(result.problems).toContain("skipped_case:H04-AC4");
    expect(result.passedCases).toBe(27);
  });

  it("does not transfer evidence from an older SHA", () => {
    const cases = allPassed();
    cases.find((entry) => entry.caseId === "H02-AC1")!.candidateSha = "b".repeat(40);
    expect(assessHamiltonReleaseCandidate({ candidateSha: sha, cases }).problems)
      .toContain("wrong_sha:H02-AC1");
  });

  it("requires inspected output and an evidence reference, not a bare pass flag", () => {
    const cases = allPassed();
    const target = cases.find((entry) => entry.caseId === "H06-AC2")!;
    target.inspectedOutput = false;
    target.evidenceRefs = [];
    const problems = assessHamiltonReleaseCandidate({ candidateSha: sha, cases }).problems;
    expect(problems).toContain("uninspected_output:H06-AC2");
    expect(problems).toContain("missing_evidence_ref:H06-AC2");
  });

  it("rejects duplicate cases rather than choosing the favorable copy", () => {
    const cases = allPassed();
    cases.push({ ...cases[0], status: "failed" });
    expect(assessHamiltonReleaseCandidate({ candidateSha: sha, cases }).problems)
      .toContain("duplicate_case:H01-AC1");
  });

  it("rejects an invalid candidate SHA", () => {
    expect(assessHamiltonReleaseCandidate({ candidateSha: "main", cases: allPassed() }).problems)
      .toContain("invalid_candidate_sha");
  });
});


describe("Hamilton failure-recovery release evidence", () => {
  const sha = "c".repeat(40);
  const allRecovered = (): HamiltonFailureRecoveryEvidence[] =>
    HAMILTON_REQUIRED_FAILURE_RECOVERY_IDS.map((caseId) => ({
      caseId,
      candidateSha: sha,
      status: "passed",
      containment: "Synthetic failure stayed within the affected request/transaction.",
      rollbackOrRetry: "Synthetic retry or rollback restored the prior state without deleting audit history.",
      evidenceRefs: [`failure-artifact:${caseId}`],
    }));

  it("requires all seven failure-recovery cases before the packet can call recovery ready", () => {
    const result = assessHamiltonFailureRecovery({ candidateSha: sha, cases: allRecovered() });
    expect(result).toEqual({ ready: true, problems: [], passedCases: 7, requiredCases: 7 });
  });

  it("keeps provider-stop and database failures blocked when they were not actually exercised", () => {
    const cases = allRecovered();
    cases.find((entry) => entry.caseId === "provider_stop")!.status = "blocked";
    cases.find((entry) => entry.caseId === "database_failure")!.status = "skipped";
    const problems = assessHamiltonFailureRecovery({ candidateSha: sha, cases }).problems;
    expect(problems).toContain("blocked_failure_case:provider_stop");
    expect(problems).toContain("skipped_failure_case:database_failure");
  });

  it("requires explicit containment and rollback/retry evidence rather than a pass flag", () => {
    const cases = allRecovered();
    const delayed = cases.find((entry) => entry.caseId === "delayed_response")!;
    delayed.containment = "";
    delayed.rollbackOrRetry = "";
    delayed.evidenceRefs = [];
    const problems = assessHamiltonFailureRecovery({ candidateSha: sha, cases }).problems;
    expect(problems).toEqual(expect.arrayContaining([
      "missing_containment:delayed_response",
      "missing_rollback_or_retry:delayed_response",
      "missing_failure_evidence_ref:delayed_response",
    ]));
  });

  it("does not transfer a rollback rehearsal from another release candidate", () => {
    const cases = allRecovered();
    cases.find((entry) => entry.caseId === "invalid_migration")!.candidateSha = "d".repeat(40);
    expect(assessHamiltonFailureRecovery({ candidateSha: sha, cases }).problems)
      .toContain("wrong_failure_sha:invalid_migration");
  });
});
