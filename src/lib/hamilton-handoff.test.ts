import { describe, expect, it } from "vitest";
import { shouldResumeAfterCheckout } from "@/app/account/welcome/resume";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { HANDOFF_QUESTION_MAX, driversQuestion, handoffHref, hamiltonHandoffs, type HandoffContext } from "./hamilton-handoff";

const ctx: HandoffContext = {
  institutionId: 323,
  institutionName: "Capital City Bank",
  kind: "bank",
  place: "Tallahassee, Florida",
  quarter: "Q2 2026",
  ownSharePct: 8.7,
  peerSharePct: 2.2,
  peerCount: 869,
  sizeRange: "$1B to $10B",
  incomeLabel: "Service-charge income",
  fees: [
    { key: "overdraft", label: "overdraft", amount: "$35", against: "the Florida median of $30" },
    { key: "atm_non_network", label: "out-of-network ATM", amount: "$3", against: "the Florida median of $2" },
  ],
};

const params = (href: string) => new URL(href, "https://feeinsight.com").searchParams;

describe("hamiltonHandoffs", () => {
  it("offers the three contextual actions on this institution", () => {
    const handoffs = hamiltonHandoffs(ctx);
    expect(handoffs.map((h) => h.label)).toEqual([
      "Analyze the drivers of service\u2011charge income",
      "Compare local deposit competitors",
      "Generate a pricing committee briefing",
    ]);
    for (const h of handoffs) expect(params(h.proHref).get("instId")).toBe("323");
    expect(handoffs[2].proHref).toBe("/pro/reports?instId=323&intent=competitive-brief");
  });

  it("writes the cohort, quarter and fees into the question, and never sends it unasked", () => {
    const [drivers, competitors] = hamiltonHandoffs(ctx);
    const q = params(drivers.proHref).get("q") ?? "";
    expect(q).toContain("8.7% of revenue in Q2 2026");
    expect(q).toContain("869 banks with $1B to $10B in assets");
    expect(q).toContain("overdraft $35 against the Florida median of $30 and out-of-network ATM $3");
    expect(params(competitors.proHref).get("q")).toContain("around Tallahassee, Florida");
    for (const h of hamiltonHandoffs(ctx)) expect(params(h.proHref).has("send")).toBe(false);
  });

  it("keeps a question inside /pro/analyze's limit, dropping context before the closing instruction", () => {
    const fees = [...ctx.fees, { key: "monthly_maintenance", label: "monthly maintenance", amount: "$8.45", against: "the Florida median of $7.50" }];
    const long = driversQuestion({ ...ctx, institutionName: "First Citizens Community Federal Savings Bank of the Gulf Coast", fees });
    expect(long.length).toBeLessThanOrEqual(HANDOFF_QUESTION_MAX);
    expect(long).toContain("8.7% of revenue");
    expect(long).not.toMatch(/\d\. \d|  /);
    expect(long.endsWith("say what data would settle it.")).toBe(true);
  });


  it("leaves the cohort out of the question when there is no comparison", () => {
    const q = driversQuestion({ ...ctx, ownSharePct: null, peerSharePct: null, peerCount: null, fees: [] });
    expect(q).not.toContain("median");
    expect(q.startsWith("What drives Capital City Bank's service-charge income?")).toBe(true);
  });
});

describe("handoffHref", () => {
  const proHref = "/pro/analyze?instId=323&intent=institution&q=What+drives+it%3F+8.7%25+%26+more";

  it("opens Hamilton directly for a Pro reader", () => {
    expect(handoffHref(proHref, 323, { isPro: true })).toBe(proHref);
  });

  it("sends everyone else to the plans on this institution's tier, carrying the Pro address", () => {
    const href = handoffHref(proHref, 323, { isPro: false });
    expect(href.startsWith("/subscribe?")).toBe(true);
    expect(href.endsWith("#pro")).toBe(true);
    const sub = params(href);
    expect(sub.get("inst")).toBe("323");
    expect(sub.get("from")).toBe(proHref);
  });

  it("survives sign-up, checkout and the welcome page unchanged", () => {
    for (const h of [...hamiltonHandoffs(ctx), { proHref: "/pro/settings?instId=323&peers=10,11&name=Home+metro&fee=overdraft#peer-sets" }]) {
      // /subscribe reads `from` and sanitizes it; register/login carry it back; checkout puts it on the success URL.
      const fromSubscribe = sanitizeInternalRedirect(params(handoffHref(h.proHref, 323, { isPro: false })).get("from"), "/account/welcome");
      const success = new URLSearchParams({ success: "true", from: fromSubscribe });
      const atWelcome = sanitizeInternalRedirect(new URLSearchParams(success.toString()).get("from"), "/account/welcome");
      expect(shouldResumeAfterCheckout(atWelcome)).toBe(true);
      expect(atWelcome).toBe(h.proHref);
    }
  });
});
