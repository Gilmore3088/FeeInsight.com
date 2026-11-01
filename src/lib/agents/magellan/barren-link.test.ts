import { describe, expect, it } from "vitest";

import { barrenLinkReplaces } from "./discovery";

const schedule = ["Schedule of Fees", "Overdraft fee $32.00", "NSF fee $32.00", "Stop payment fee $30.00", "Wire transfer outgoing $25.00", "Monthly maintenance fee $10.00"].join("\n");

describe("barrenLinkReplaces", () => {
  it("replaces a barren link with a fee page that lists more fee lines", () => {
    expect(barrenLinkReplaces(schedule, "https://bank.example/fee-schedule.pdf", 1)).toEqual({ replaces: true, feeLines: 5, oldFeeLines: 1 });
  });

  it("keeps the link when the page found lists no more fee lines than the old one", () => {
    expect(barrenLinkReplaces(schedule, "https://bank.example/fee-schedule.pdf", 5).replaces).toBe(false);
  });

  it("keeps the link when the page found is not a fee page or was never read", () => {
    expect(barrenLinkReplaces("Open a checking account today. Apply online.", "https://bank.example/checking", 0).replaces).toBe(false);
    expect(barrenLinkReplaces(null, "https://bank.example/fees", 0).replaces).toBe(false);
  });
});
