import { describe, expect, it } from "vitest";
import { analyzeWorkspaceKey, getHamiltonArtifactContextLookup, resolveArtifactContextInstitutionId } from "./artifact-context";
import { hrefWithInstitutionContext } from "./context-link";

describe("saved analysis identity", () => {
  it("pins the authorized saved subject rather than the URL", () => {
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "8109", artifactInstitutionId: 2945, preferArtifact: true })).toBe("2945");
  });
  it("does not substitute a URL for a legacy answer without a subject", () => {
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "8109", artifactInstitutionId: null, preferArtifact: true })).toBeUndefined();
  });
  it("does not substitute a URL for an invalid stored subject", () => {
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "8109", artifactInstitutionId: "bank-name", preferArtifact: true })).toBeUndefined();
  });
  it("normalizes a recorded numeric ID without reading the URL", () => {
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "bad-id", artifactInstitutionId: " 2945 ", preferArtifact: true })).toBe("2945");
  });
  it("keeps the existing explicit-URL behavior for non-analysis consumers", () => {
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "8109", artifactInstitutionId: 2945 })).toBe("8109");
  });
  it("looks up an analysis even when a URL subject is present", () => {
    expect(getHamiltonArtifactContextLookup({ pathname: "/pro/analyze", searchParams: new URLSearchParams("analysis=saved-a&instId=8109&setBank=1") })).toEqual({ kind: "analysis", artifactId: "saved-a" });
  });
  it("does not change explicit scenario routing", () => {
    expect(getHamiltonArtifactContextLookup({ pathname: "/pro/simulate", searchParams: new URLSearchParams("scenario_id=saved-a&instId=8109") })).toBeNull();
  });
  it("does not change explicit report routing", () => {
    expect(getHamiltonArtifactContextLookup({ pathname: "/pro/reports", searchParams: new URLSearchParams("report_id=saved-a&instId=8109") })).toBeNull();
  });
  it("does not treat a blank analysis parameter as a saved answer", () => {
    expect(getHamiltonArtifactContextLookup({ pathname: "/pro/analyze", searchParams: new URLSearchParams("analysis=%20&instId=8109") })).toBeNull();
  });
  it("does not contaminate a saved-answer link with the current institution", () => {
    expect(hrefWithInstitutionContext("/pro/analyze?analysis=saved-a", "8109")).toBe("/pro/analyze?analysis=saved-a");
  });
  it("preserves history query parameters and fragments without appending context", () => {
    expect(hrefWithInstitutionContext("/pro/analyze?analysis=saved-a&from=history#answer", "8109")).toBe("/pro/analyze?analysis=saved-a&from=history#answer");
  });
  it("still carries context for a new question", () => {
    expect(hrefWithInstitutionContext("/pro/analyze?q=peers", "8109")).toBe("/pro/analyze?q=peers&instId=8109");
  });
  it("still carries context when the analysis parameter is blank", () => {
    expect(hrefWithInstitutionContext("/pro/analyze?analysis=", "8109")).toBe("/pro/analyze?analysis=&instId=8109");
  });
  it("does not rewrite an existing link's explicit query; the page enforces saved identity", () => {
    expect(hrefWithInstitutionContext("/pro/analyze?analysis=saved-a&instId=2945", "8109")).toBe("/pro/analyze?analysis=saved-a&instId=2945");
  });
});

describe("conversation state identity", () => {
  const base = { userId: 7, institutionId: "2945", analysisId: "saved-a" };
  it("is stable for unchanged context", () => { expect(analyzeWorkspaceKey(base)).toBe(analyzeWorkspaceKey({ ...base })); });
  it("resets when the authenticated user changes", () => { expect(analyzeWorkspaceKey(base)).not.toBe(analyzeWorkspaceKey({ ...base, userId: 8 })); });
  it("resets when the subject changes", () => { expect(analyzeWorkspaceKey(base)).not.toBe(analyzeWorkspaceKey({ ...base, institutionId: "8109" })); });
  it("resets when another saved answer opens for the same subject", () => { expect(analyzeWorkspaceKey(base)).not.toBe(analyzeWorkspaceKey({ ...base, analysisId: "saved-b" })); });
  it("normalizes canonical subject IDs", () => { expect(analyzeWorkspaceKey(base)).toBe(analyzeWorkspaceKey({ ...base, institutionId: 2945 })); });
  it("isolates an unscoped saved answer from the workspace institution", () => { expect(analyzeWorkspaceKey(base)).not.toBe(analyzeWorkspaceKey({ ...base, institutionId: null })); });
  it("resets when a read-only view becomes usable", () => { expect(analyzeWorkspaceKey(base)).not.toBe(analyzeWorkspaceKey({ ...base, readOnly: true })); });
  it("resets for a new question handed over by navigation", () => { expect(analyzeWorkspaceKey({ ...base, analysisId: null, question: "fees" })).not.toBe(analyzeWorkspaceKey({ ...base, analysisId: null, question: "peers" })); });
});
