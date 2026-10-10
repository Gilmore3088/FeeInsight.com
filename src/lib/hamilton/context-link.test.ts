import { describe, expect, it } from "vitest";
import {
  hrefWithInstitutionContext,
  isCanonicalInstitutionId,
  normalizeCanonicalInstitutionId,
} from "./context-link";

describe("Hamilton context links", () => {
  it("recognizes canonical numeric institution IDs only", () => {
    expect(isCanonicalInstitutionId("2945")).toBe(true);
    expect(isCanonicalInstitutionId(" 2945 ")).toBe(true);
    expect(isCanonicalInstitutionId("0")).toBe(false);
    expect(isCanonicalInstitutionId("-1")).toBe(false);
    expect(isCanonicalInstitutionId("first-bank")).toBe(false);
    expect(isCanonicalInstitutionId("02945")).toBe(false);
  });

  it("normalizes canonical numeric IDs and rejects profile-name slugs", () => {
    expect(normalizeCanonicalInstitutionId(" 2945 ")).toBe("2945");
    expect(normalizeCanonicalInstitutionId(8109)).toBe("8109");
    expect(normalizeCanonicalInstitutionId("first-bank")).toBeNull();
    expect(normalizeCanonicalInstitutionId("02945")).toBeNull();
  });

  it("accepts only safely represented canonical decimal institution IDs", () => {
    for (const value of [8109, "8109", " 8109 ", Number.MAX_SAFE_INTEGER]) {
      expect(normalizeCanonicalInstitutionId(value)).toBe(String(value).trim());
    }
    for (const value of ["08109", "0x1", "8.109e3", "8109.0", Number.MAX_SAFE_INTEGER + 1, "9007199254740992"]) {
      expect(isCanonicalInstitutionId(String(value))).toBe(false);
      expect(normalizeCanonicalInstitutionId(value)).toBeNull();
      expect(hrefWithInstitutionContext("/pro/reports", String(value))).toBe("/pro/reports");
    }
  });

  it("appends selected institution context to Pro links", () => {
    expect(hrefWithInstitutionContext("/pro/analyze", "2945")).toBe(
      "/pro/analyze?instId=2945",
    );
    expect(hrefWithInstitutionContext("/pro", "2945")).toBe("/pro?instId=2945");
    expect(hrefWithInstitutionContext("/pro?source=account", "2945")).toBe(
      "/pro?source=account&instId=2945",
    );
    expect(hrefWithInstitutionContext("/pro/reports?intent=competitive-brief", "2945")).toBe(
      "/pro/reports?intent=competitive-brief&instId=2945",
    );
    expect(hrefWithInstitutionContext("/pro/analyze", " 2945 ")).toBe(
      "/pro/analyze?instId=2945",
    );
  });

  it("preserves hash fragments after appending selected institution context", () => {
    expect(hrefWithInstitutionContext("/pro/settings#workspace-access", "2945")).toBe(
      "/pro/settings?instId=2945#workspace-access",
    );
    expect(hrefWithInstitutionContext("/pro/settings?tab=access#workspace-access", "2945")).toBe(
      "/pro/settings?tab=access&instId=2945#workspace-access",
    );
    expect(hrefWithInstitutionContext("/pro?source=account#workspace", "2945")).toBe(
      "/pro?source=account&instId=2945#workspace",
    );
  });

  it("does not override explicit context or touch public/admin links", () => {
    expect(hrefWithInstitutionContext("/pro/analyze?instId=8109", "2945")).toBe(
      "/pro/analyze?instId=8109",
    );
    expect(hrefWithInstitutionContext("/pro/settings?instId=8109#workspace-access", "2945")).toBe(
      "/pro/settings?instId=8109#workspace-access",
    );
    expect(hrefWithInstitutionContext("/pro?instId=8109&source=account", "2945")).toBe(
      "/pro?instId=8109&source=account",
    );
    expect(hrefWithInstitutionContext("/admin", "2945")).toBe("/admin");
    expect(hrefWithInstitutionContext("/institution/2945", "2945")).toBe("/institution/2945");
  });
});
