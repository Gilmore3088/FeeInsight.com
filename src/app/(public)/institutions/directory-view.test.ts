import { describe, expect, it } from "vitest";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import {
  bandsInUse,
  charterNoun,
  coverageSegments,
  directoryHref,
  namedStates,
  normalizeCharter,
  normalizeStateCode,
  percentLabel,
  publishedShare,
  percentSentence,
  reportCta,
  shareBand,
  shareSentence,
  totalSummary,
} from "./directory-view";

function row(state_code: string, verified: number, total: number, review = 0, missing = total - verified - review): InstitutionStateDirectorySummary {
  return {
    state_code,
    institution_count: total,
    verified_institution_count: verified,
    provisional_institution_count: review,
    under_review_institution_count: 0,
    source_needed_institution_count: missing,
    verified_fee_count: verified * 10,
    provisional_fee_count: 0,
  };
}

describe("directory-view", () => {
  it("builds links that keep every filter and drop empty ones", () => {
    expect(directoryHref({})).toBe("/institutions");
    expect(directoryHref({ q: "M&T", state: "NY", charter: "bank", fee: "overdraft", page: 2 })).toBe(
      "/institutions?q=M%26T&state=NY&charter=bank&fee=overdraft&page=2",
    );
    expect(directoryHref({ state: "CA", page: 1 })).toBe("/institutions?state=CA");
  });

  it("degrades unknown params to the plain directory", () => {
    expect(normalizeCharter("credit_union")).toBe("credit_union");
    expect(normalizeCharter("thrift")).toBe("");
    expect(normalizeStateCode("fl")).toBe("FL");
    expect(normalizeStateCode("ZZ")).toBe("");
    expect(normalizeStateCode(undefined)).toBe("");
  });

  it("splits a state three ways that add up to the institutions monitored", () => {
    const s = row("CA", 30, 100, 20);
    const segments = coverageSegments(s);
    expect(segments.map((x) => x.count)).toEqual([30, 20, 50]);
    expect(segments.reduce((sum, x) => sum + x.count, 0)).toBe(s.institution_count);
  });

  it("adds every state up for the panel's default view", () => {
    const total = totalSummary([row("CA", 30, 100), row("NY", 10, 50)]);
    expect(total.institution_count).toBe(150);
    expect(total.verified_institution_count).toBe(40);
    expect(total.state_code).toBe("");
  });

  it("shades by share with published fees, and keys only the bands in use", () => {
    expect(publishedShare(row("CA", 0, 0))).toBe(0);
    expect(shareBand(0)).toBe(0);
    expect(shareBand(0.05)).toBe(1);
    expect(shareBand(0.1)).toBe(2);
    expect(shareBand(0.3)).toBe(3);
    expect(shareBand(0.9)).toBe(4);
    expect(bandsInUse([row("CA", 0, 10), row("NY", 6, 10)])).toEqual([0, 4]);
  });

  it("never rounds a real share down to 0%", () => {
    expect(percentLabel(0.004)).toBe("under 1%");
    expect(percentLabel(0)).toBe("0%");
    expect(percentLabel(0.426)).toBe("43%");
  });

  it("names the institution type in every count sentence once one is picked", () => {
    expect(charterNoun("")).toBe("banks and credit unions");
    expect(charterNoun("bank")).toBe("banks");
    const s = row("TX", 412, 1050);
    expect(shareSentence(s, "")).toBe("412 of 1,050 institutions have published fees");
    expect(shareSentence(s, "credit_union")).toBe("412 of 1,050 credit unions have published fees");
    expect(percentSentence(s, "")).toBe("39% have published fees");
    expect(percentSentence(s, "bank")).toBe("39% of banks have published fees");
    expect(percentSentence(row("GU", 0, 0), "")).toBe("None monitored yet");
  });

  it("keeps only states the map can name", () => {
    expect(namedStates([row("TX", 1, 2), row("XX", 1, 2)]).map((s) => s.state_code)).toEqual(["TX"]);
  });

  it("sends bank staff to the sample when it is live, else to the request form", () => {
    expect(reportCta(true).href).toBe("/reports/sample-competitive-fee-position");
    expect(reportCta(false)).toEqual({
      href: "/reports?report=institution&src=institutions#request",
      label: "Request your institution report",
      event: "request_report_click",
    });
  });
});
