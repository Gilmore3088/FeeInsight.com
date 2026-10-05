import { describe, expect, it } from "vitest";
import { trackEvent } from "./analytics";

describe("trackEvent", () => {
  it("never throws, with or without props", () => {
    expect(() => trackEvent("create_account")).not.toThrow();
    expect(() => trackEvent("request_report", { plan: "report" })).not.toThrow();
  });
});
