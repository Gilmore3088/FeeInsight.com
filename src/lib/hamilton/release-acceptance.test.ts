import { describe, expect, it } from "vitest";
import {
  HAMILTON_COMPLAINT_EVIDENCE,
  HAMILTON_RELEASE_PROTECTION_SNAPSHOT,
  releaseEvidenceIsComplete,
  validateHamiltonComplaintEvidence,
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
