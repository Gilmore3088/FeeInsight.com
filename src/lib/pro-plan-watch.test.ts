import { describe, expect, it } from "vitest";
import { baseDomain, emailDomain, planWatchReasons, type WatchInstitution } from "./pro-plan-watch";

const small: WatchInstitution = { id: 1, name: "Small Town Bank", websiteUrl: "https://www.smalltownbank.com/", assetsThousands: 300_000 };
const big: WatchInstitution = { id: 2, name: "Big Regional Bank", websiteUrl: "https://bigregional.com", assetsThousands: 4_100_000 };
const peer: WatchInstitution = { id: 3, name: "Peer Bank", websiteUrl: null, assetsThousands: 250_000 };

describe("domains", () => {
  it("reduces hosts, URLs and emails to the base domain", () => {
    expect(baseDomain("https://www.smalltownbank.com/fees?x=1")).toBe("smalltownbank.com");
    expect(emailDomain("Jane@Mail.SmallTownBank.com")).toBe("smalltownbank.com");
    expect(emailDomain("nobody")).toBeNull();
    expect(baseDomain(null)).toBeNull();
  });
});

describe("planWatchReasons", () => {
  const base = { paidTier: "small" as const, otherOrganization: false, paidInstitution: small };

  it("is quiet when the email matches and the work stays at or below the paid size", () => {
    expect(planWatchReasons({ ...base, email: "jane@smalltownbank.com", requestedInstitutions: [small, peer] })).toEqual([]);
  });

  it("flags an email from another domain", () => {
    expect(planWatchReasons({ ...base, email: "jane@bigregional.com", requestedInstitutions: [] })).toEqual([
      "Email is @bigregional.com, but Small Town Bank's website is smalltownbank.com",
    ]);
  });

  it("flags Pro work on a bank in a larger tier", () => {
    expect(planWatchReasons({ ...base, email: "jane@smalltownbank.com", requestedInstitutions: [big] })).toEqual([
      "Ran Pro work on larger institutions than the plan covers: Big Regional Bank ($4.1B)",
    ]);
  });

  it("flags a size band the buyer picked", () => {
    const unknown = { ...small, assetsThousands: null };
    expect(
      planWatchReasons({ ...base, paidInstitution: unknown, tierPickedByBuyer: true, email: "jane@smalltownbank.com", requestedInstitutions: [] }),
    ).toEqual(['No asset size on file for Small Town Bank; the buyer picked "Under $500M in assets"']);
  });

  it("never flags the consultant plan, which may cover any bank", () => {
    expect(
      planWatchReasons({ ...base, otherOrganization: true, email: "a@gmail.com", requestedInstitutions: [big] }),
    ).toEqual([]);
  });
});
