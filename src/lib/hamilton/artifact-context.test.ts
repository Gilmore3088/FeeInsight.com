import { describe, expect, it } from "vitest";
import {
  isSavedArtifactId,
  getHamiltonArtifactContextLookup,
  resolveArtifactContextInstitutionId,
  shouldPersistUrlInstitutionSelection,
} from "@/lib/hamilton/artifact-context";

describe("Hamilton artifact context resolution", () => {
  it("uses explicit URL institution context first", () => {
    expect(
      resolveArtifactContextInstitutionId({
        urlInstitutionId: "8109",
        artifactInstitutionId: "2945",
      }),
    ).toBe("8109");
  });

  it("falls back to canonical saved artifact institution context", () => {
    expect(
      resolveArtifactContextInstitutionId({
        urlInstitutionId: null,
        artifactInstitutionId: " 2945 ",
      }),
    ).toBe("2945");
  });

  it("does not use profile-name slugs from saved artifacts as institution context", () => {
    expect(
      resolveArtifactContextInstitutionId({
        urlInstitutionId: null,
        artifactInstitutionId: "first-national-bank",
      }),
    ).toBeUndefined();
  });

  it("only persists explicit URL institution selections", () => {
    expect(shouldPersistUrlInstitutionSelection("2945")).toBe(true);
    expect(shouldPersistUrlInstitutionSelection(null)).toBe(false);
  });

  it("detects saved analysis context routes when URL institution context is absent", () => {
    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/analyze",
        searchParams: new URLSearchParams("analysis=abc-123"),
      }),
    ).toEqual({ kind: "analysis", artifactId: "abc-123" });
  });

  it("detects saved scenario context routes for simulate and reports", () => {
    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/simulate",
        searchParams: new URLSearchParams("scenario_id=scn-1"),
      }),
    ).toEqual({ kind: "scenario", artifactId: "scn-1" });

    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/reports",
        searchParams: new URLSearchParams("scenario_id=scn-2"),
      }),
    ).toEqual({ kind: "scenario", artifactId: "scn-2" });
  });

  it("detects saved report context routes before scenario context", () => {
    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/reports",
        searchParams: new URLSearchParams("report_id=report-1&scenario_id=scn-1"),
      }),
    ).toEqual({ kind: "report", artifactId: "report-1" });

    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/reports",
        searchParams: new URLSearchParams("report=report-2"),
      }),
    ).toEqual({ kind: "report", artifactId: "report-2" });
  });

  it.each(["scenario", "scenario_id"])("resolves a saved simulation before a conflicting URL subject (%s)", (key) => {
    expect(getHamiltonArtifactContextLookup({
      pathname: "/pro/simulate",
      searchParams: new URLSearchParams({ [key]: "saved-a", instId: "303" }),
    })).toEqual({ kind: "scenario", artifactId: "saved-a" });
  });

  it("always queries a saved analysis even with conflicting URL institution context", () => {
    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/analyze",
        searchParams: new URLSearchParams("analysis=abc-123&instId=8109"),
      }),
    ).toEqual({ kind: "analysis", artifactId: "abc-123" });
  });

  it("always queries a saved report even with conflicting URL institution context", () => {
    expect(getHamiltonArtifactContextLookup({ pathname: "/pro/reports", searchParams: new URLSearchParams("report_id=saved-a&instId=1535") }))
      .toEqual({ kind: "report", artifactId: "saved-a" });
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "1535", artifactInstitutionId: "8109", preferArtifact: true })).toBe("8109");
    expect(resolveArtifactContextInstitutionId({ urlInstitutionId: "1535", artifactInstitutionId: null, preferArtifact: true })).toBeUndefined();
  });

  it("allows blank URL institution context to fall back to saved artifact context", () => {
    expect(
      getHamiltonArtifactContextLookup({
        pathname: "/pro/analyze",
        searchParams: new URLSearchParams("analysis=abc-123&instId="),
      }),
    ).toEqual({ kind: "analysis", artifactId: "abc-123" });
  });
});

describe("isSavedArtifactId", () => {
  it.each([
    "5d0f3f4e-8a1b-4c2d-9e3f-0a1b2c3d4e5f",
    "5D0F3F4E-8A1B-4C2D-9E3F-0A1B2C3D4E5F",
    "00000000-0000-1000-8000-000000000000",
  ])("accepts the uuid %s", (id) => {
    expect(isSavedArtifactId(id)).toBe(true);
  });

  it.each(["", "not-a-uuid", "saved-a", "5d0f3f4e-8a1b-4c2d-9e3f", "5d0f3f4e8a1b4c2d9e3f0a1b2c3d4e5f", " 5d0f3f4e-8a1b-4c2d-9e3f-0a1b2c3d4e5f"])(
    "rejects %j",
    (id) => {
      expect(isSavedArtifactId(id)).toBe(false);
    },
  );
});
