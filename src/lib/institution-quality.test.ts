import { describe, expect, it } from "vitest";
import {
  classifyAgentFailure,
  classifyInstitutionQuality,
  getFeePublicationStatus,
  getFeePublicationStatusLabel,
  getInstitutionConfidenceSummary,
  getInstitutionInsightReadiness,
  getInstitutionSourceNeededReason,
  getPublicInstitutionQualityLabel,
  repairHrefForQualitySignal,
} from "./institution-quality";

describe("classifyInstitutionQuality", () => {
  it("flags JPM-style investor news URLs as suspect and unpublished", () => {
    const result = classifyInstitutionQuality({
      source: "fdic",
      certNumber: "628",
      websiteUrl: "https://www.jpmorganchase.com",
      feeScheduleUrl:
        "https://www.jpmorganchase.com/ir/news/2021/chase-helps-more-than-two-million-customers-avoid-overdraft-service-fees",
      publishedFeeCount: 0,
      latestSourceStatus: "failed",
      latestExtractedFeeCount: 0,
      latestSourceCollectedAt: "2026-03-17T01:00:43Z",
    });

    expect(result.quality_status).toBe("needs_review");
    expect(result.quality_signals.map((s) => s.code)).toContain("bad_or_suspect_url");
    expect(result.quality_signals.map((s) => s.code)).toContain("url_but_zero_published");
    expect(getPublicInstitutionQualityLabel(result.quality_signals)).toBe(
      "Fee schedule under review",
    );
  });

  it("routes extracted-but-unpublished records to Darwin", () => {
    const result = classifyInstitutionQuality({
      source: "fdic",
      certNumber: "3511",
      websiteUrl: "https://www.wellsfargo.com",
      feeScheduleUrl:
        "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/",
      publishedFeeCount: 0,
      latestSourceStatus: "success",
      latestExtractedFeeCount: 15,
    });

    const signal = result.quality_signals.find((s) => s.code === "extracted_not_published");
    expect(signal).toBeDefined();
    expect(repairHrefForQualitySignal(signal!)).toBe("/admin/darwin");
  });

  it("surfaces provider credit failures as critical", () => {
    expect(classifyAgentFailure("Error code: 400 - credit balance is too low")).toBe(
      "provider_credit",
    );
    expect(classifyAgentFailure("400 You have reached your specified API usage limits. You will regain access on 2026-11-01.")).toBe(
      "provider_credit",
    );

    const result = classifyInstitutionQuality({
      source: "fdic",
      certNumber: "1",
      websiteUrl: "https://example.com",
      feeScheduleUrl: "https://example.com/fees.pdf",
      publishedFeeCount: 0,
      latestSourceStatus: "failed",
      latestSourceError: "Your credit balance is too low to access the Anthropic API.",
    });

    expect(result.primary_signal.code).toBe("provider_failure");
    expect(result.primary_signal.severity).toBe("critical");
  });

  it("marks records with published fees and complete identity as verified", () => {
    const result = classifyInstitutionQuality({
      source: "ncua",
      certNumber: "5536",
      websiteUrl: "https://www.navyfederal.org",
      feeScheduleUrl: "https://www.navyfederal.org/membership/fees-and-charges.html",
      publishedFeeCount: 22,
      latestSourceStatus: "success",
      latestExtractedFeeCount: 22,
    });

    expect(result.quality_status).toBe("verified");
    expect(result.primary_signal.code).toBe("verified");
  });

  it("does not mark a complete institution with zero published fees as verified", () => {
    const result = classifyInstitutionQuality({
      source: "fdic",
      certNumber: "2945",
      websiteUrl: "https://examplebank.com",
      feeScheduleUrl: null,
      publishedFeeCount: 0,
      latestSourceStatus: null,
      latestExtractedFeeCount: 0,
    });

    expect(result.quality_status).toBe("needs_review");
    expect(result.primary_signal.code).toBe("no_published_fees");
    expect(getPublicInstitutionQualityLabel(result.quality_signals)).toBe(
      "Fee data unavailable",
    );
  });
});

describe("getFeePublicationStatus", () => {
  it("classifies approved, provisional, under-review, and unavailable public states", () => {
    expect(getFeePublicationStatus({ publishedFeeCount: 2 })).toBe("verified");
    expect(
      getFeePublicationStatus({ publishedFeeCount: 0, provisionalFeeCount: 3 }),
    ).toBe("provisional");
    expect(
      getFeePublicationStatus({
        publishedFeeCount: 0,
        provisionalFeeCount: 0,
        latestExtractedFeeCount: 4,
      }),
    ).toBe("under_review");
    expect(
      getFeePublicationStatus({
        publishedFeeCount: 0,
        provisionalFeeCount: 0,
        latestExtractedFeeCount: 0,
      }),
    ).toBe("unavailable");
  });

  it("provides explicit public labels", () => {
    expect(getFeePublicationStatusLabel("verified")).toBe("Verified fees");
    expect(getFeePublicationStatusLabel("provisional")).toBe("Provisional fees");
    expect(getFeePublicationStatusLabel("under_review")).toBe("Fee data under review");
    expect(getFeePublicationStatusLabel("unavailable")).toBe("Fee data unavailable");
  });
});

describe("institution readiness", () => {
  it("treats verified, provisional, review, and empty states as distinct readiness levels", () => {
    expect(
      getInstitutionInsightReadiness({
        publishedFeeCount: 4,
        provisionalFeeCount: 0,
      }),
    ).toBe("ready");

    expect(
      getInstitutionInsightReadiness({
        publishedFeeCount: 0,
        provisionalFeeCount: 4,
      }),
    ).toBe("directional");

    expect(
      getInstitutionInsightReadiness({
        publishedFeeCount: 0,
        provisionalFeeCount: 0,
        feeScheduleUrl: "https://bank.example/fees.pdf",
      }),
    ).toBe("under_review");

    expect(
      getInstitutionInsightReadiness({
        publishedFeeCount: 0,
        provisionalFeeCount: 0,
        latestExtractedFeeCount: 0,
      }),
    ).toBe("source_needed");
  });

  it("explains why empty public profiles need a source", () => {
    const input = {
      publishedFeeCount: 0,
      provisionalFeeCount: 0,
      latestExtractedFeeCount: 0,
      latestSourceStatus: null,
      feeScheduleUrl: null,
    };

    expect(getInstitutionSourceNeededReason(input)).toBe("official_source_missing");
    expect(getInstitutionConfidenceSummary(input)).toBe(
      "Official source evidence is needed before fee claims can be made.",
    );
  });
});
