import { describe, expect, it } from "vitest";
import {
  buildCaptureAttribution,
  isEmailOnlySource,
  isWorkEmail,
  parseStateCode,
  placementForSource,
} from "./lead-capture";

describe("lead capture contract", () => {
  it("maps every placement to a distinct source", () => {
    expect(placementForSource("capture_institution")).toBe("institution_alerts");
    expect(placementForSource("capture_state")).toBe("state_benchmark");
    expect(placementForSource("capture_national_index")).toBe("national_index");
    expect(placementForSource("capture_report_sample")).toBe("sample_report");
    expect(placementForSource("report")).toBeNull();
  });

  it("treats newsletter and capture sources as email-only", () => {
    expect(isEmailOnlySource("newsletter")).toBe(true);
    expect(isEmailOnlySource("capture_state")).toBe(true);
    expect(isEmailOnlySource("report")).toBe(false);
  });

  it("validates state codes and work email domains", () => {
    expect(parseStateCode(" tx ")).toBe("TX");
    expect(parseStateCode("ZZ")).toBeNull();
    expect(isWorkEmail("vp@firstbank.com")).toBe(true);
    expect(isWorkEmail("VP@Gmail.com")).toBe(false);
  });

  it("builds queryable attribution", () => {
    expect(buildCaptureAttribution("institution_alerts", 12, "OH")).toBe(
      "placement=institution_alerts; institution_id=12; state=OH",
    );
  });
});
