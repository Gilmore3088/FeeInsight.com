import { describe, expect, it } from "vitest";
import { flagOn, flagState } from "./live-flag";
import { federalBillsLive } from "./federal-bills";

describe("tracker live switches", () => {
  it("treats true typed with spaces, quotes or capitals as on", () => {
    for (const raw of ["true", " true", "true\n", "True", "TRUE", '"true"', "'true'"]) expect(flagOn(raw)).toBe(true);
  });

  it("says whether a switch that is off is unset or set to something else", () => {
    expect(flagState(undefined)).toBe("unset");
    expect(flagState("  ")).toBe("unset");
    expect(flagState("false")).toBe("not_true");
    expect(flagState("1")).toBe("not_true");
    expect(flagState("yes")).toBe("not_true");
  });

  it("reads the Congress bills switch through the same rule", () => {
    expect(federalBillsLive({ FEDERAL_BILLS_TRACKER_LIVE: "True " } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(federalBillsLive({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
