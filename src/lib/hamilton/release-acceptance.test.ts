import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HAMILTON_ACCEPTANCE_CHECKS,
  HAMILTON_RELEASE_MATRIX_DOC,
  HAMILTON_RELEASE_MATRIX_VERSION,
  validateHamiltonAcceptanceChecks,
  type HamiltonAcceptanceCheck,
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
  it("maps all seven complaints to stable tasks, acceptance cases and release checks", () => {
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
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.mainSha).toMatch(/^[0-9a-f]{40}$/);
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.observedAt.startsWith("2026-10-17")).toBe(true);
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.branchProtected).toBe(false);
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.requiredStatusContexts).toEqual([]);
    expect(HAMILTON_RELEASE_PROTECTION_SNAPSHOT.note).toContain("not a server-side merge barrier");
  });
});


describe("Hamilton acceptance case checks (H07-T01, matrix v2)", () => {
  const root = path.resolve(__dirname, "../../..");

  it("gives all 28 cases an automated test or a named manual check", () => {
    expect(validateHamiltonAcceptanceChecks()).toEqual([]);
    expect(HAMILTON_ACCEPTANCE_CHECKS.map((entry) => entry.caseId)).toEqual(HAMILTON_REQUIRED_ACCEPTANCE_CASE_IDS);
  });

  it("names only test files that exist in the repository", () => {
    const missing = HAMILTON_ACCEPTANCE_CHECKS.flatMap((entry) => entry.automated)
      .filter((file) => !existsSync(path.join(root, file)));
    expect(missing).toEqual([]);
  });

  it("covers every acceptance case a complaint names", () => {
    const checked = new Set(HAMILTON_ACCEPTANCE_CHECKS.map((entry) => entry.caseId));
    const unchecked = HAMILTON_COMPLAINT_EVIDENCE.flatMap((entry) => entry.acceptanceCaseIds).filter((id) => !checked.has(id));
    expect(unchecked).toEqual([]);
  });

  it("fails a case with neither an automated test nor a manual check", () => {
    const bare: HamiltonAcceptanceCheck = { ...HAMILTON_ACCEPTANCE_CHECKS[0], automated: [], manual: null };
    expect(validateHamiltonAcceptanceChecks([bare, ...HAMILTON_ACCEPTANCE_CHECKS.slice(1)])).toContain("unchecked_case:H01-AC1");
  });

  it("fails a dropped, duplicated or misnamed case", () => {
    expect(validateHamiltonAcceptanceChecks(HAMILTON_ACCEPTANCE_CHECKS.slice(1))).toContain("missing_check:H01-AC1");
    expect(validateHamiltonAcceptanceChecks([...HAMILTON_ACCEPTANCE_CHECKS, HAMILTON_ACCEPTANCE_CHECKS[3]])).toContain("duplicate_check:H01-AC4");
    const notATest: HamiltonAcceptanceCheck = { ...HAMILTON_ACCEPTANCE_CHECKS[0], automated: ["src/lib/hamilton/peer-list.ts"] };
    expect(validateHamiltonAcceptanceChecks([notATest, ...HAMILTON_ACCEPTANCE_CHECKS.slice(1)]))
      .toContain("not_a_test_path:H01-AC1:src/lib/hamilton/peer-list.ts");
  });

  it("agrees with the matrix document: same version, every case and every manual check id listed", () => {
    const doc = readFileSync(path.join(root, HAMILTON_RELEASE_MATRIX_DOC), "utf8");
    expect(doc).toContain(`Code copy:** \`src/lib/hamilton/release-acceptance.ts\` version ${HAMILTON_RELEASE_MATRIX_VERSION}`);
    for (const entry of HAMILTON_ACCEPTANCE_CHECKS) {
      expect(doc).toContain(`| ${entry.caseId} |`);
      if (entry.manual) expect(doc).toContain(entry.manual.id);
    }
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

  it("rejects whitespace-only acceptance evidence refs despite a pass flag", () => {
    const cases = allPassed();
    cases.find((entry) => entry.caseId === "H06-AC4")!.evidenceRefs = ["  ", "\t"];
    const result = assessHamiltonReleaseCandidate({ candidateSha: sha, cases });
    expect(result.ready).toBe(false);
    expect(result.problems).toContain("missing_evidence_ref:H06-AC4");
    expect(result.passedCases).toBe(27);
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

  it("rejects whitespace-only recovery refs despite a pass flag", () => {
    const cases = allRecovered();
    cases.find((entry) => entry.caseId === "provider_stop")!.evidenceRefs = [" ", "\n"];
    const result = assessHamiltonFailureRecovery({ candidateSha: sha, cases });
    expect(result.ready).toBe(false);
    expect(result.problems).toContain("missing_failure_evidence_ref:provider_stop");
    expect(result.passedCases).toBe(6);
  });

  it("rejects a failure-recovery packet without a pinned commit SHA", () => {
    const cases = allRecovered().map((entry) => ({ ...entry, candidateSha: "main" }));
    expect(assessHamiltonFailureRecovery({ candidateSha: "main", cases }).problems)
      .toContain("invalid_failure_candidate_sha");
  });

  it("rejects unknown failure cases instead of silently ignoring extras", () => {
    const cases = allRecovered();
    cases.push({ ...cases[0], caseId: "fabricated_recovery" as HamiltonFailureRecoveryEvidence["caseId"] });
    expect(assessHamiltonFailureRecovery({ candidateSha: sha, cases }).problems)
      .toContain("unknown_failure_case:fabricated_recovery");
  });

  it("does not transfer a rollback rehearsal from another release candidate", () => {
    const cases = allRecovered();
    cases.find((entry) => entry.caseId === "invalid_migration")!.candidateSha = "d".repeat(40);
    expect(assessHamiltonFailureRecovery({ candidateSha: sha, cases }).problems)
      .toContain("wrong_failure_sha:invalid_migration");
  });
});
