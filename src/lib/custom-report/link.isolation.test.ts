/**
 * #1922 token review: what a /market-report/<token> link can and cannot be turned into.
 * Revocation after a refund and the cancelled-subscription case are the database checks in
 * src/lib/hamilton/customer-isolation.db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReportToken, LINK_LIFETIME_DAYS, verifyReportToken } from "./link";

const NOW = new Date("2026-10-18T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("market-report link guessability and scope", () => {
  beforeEach(() => { process.env.CUSTOM_REPORT_LINK_SECRET = "isolation-secret"; });
  afterEach(() => { delete process.env.CUSTOM_REPORT_LINK_SECRET; });

  it("carries a 96-bit signature over the bank and the issue day", () => {
    const token = createReportToken(9922101, NOW) as string;
    expect(token).toMatch(/^9922101-20261018-[0-9a-f]{24}$/);
  });

  it("does not open another bank's report by changing the id, the day, or one signature digit", () => {
    const token = createReportToken(9922101, NOW) as string;
    const [, day, sig] = token.split("-");
    expect(verifyReportToken(`9922102-${day}-${sig}`, NOW)).toBeNull();
    expect(verifyReportToken(`9922101-20261017-${sig}`, NOW)).toBeNull();
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(verifyReportToken(`9922101-${day}-${flipped}`, NOW)).toBeNull();
  });

  it("refuses a link signed with another secret, and a link dated more than a day ahead", () => {
    const token = createReportToken(9922101, NOW) as string;
    process.env.CUSTOM_REPORT_LINK_SECRET = "rotated-secret";
    expect(verifyReportToken(token, NOW)).toBeNull();
    const ahead = createReportToken(9922101, new Date(NOW.getTime() + 2 * DAY)) as string;
    expect(verifyReportToken(ahead, NOW)).toBeNull();
  });

  it("closes on day 91 and has no other expiry", () => {
    const token = createReportToken(9922101, NOW) as string;
    expect(verifyReportToken(token, new Date(NOW.getTime() + (LINK_LIFETIME_DAYS - 1) * DAY))).not.toBeNull();
    expect(verifyReportToken(token, new Date(NOW.getTime() + (LINK_LIFETIME_DAYS + 1) * DAY))).toBeNull();
  });

  it("is the same link for every buyer of one bank on one day (it names the bank, not the buyer)", () => {
    expect(createReportToken(9922101, NOW)).toBe(createReportToken(9922101, new Date(NOW.getTime() + 60_000)));
  });
});
