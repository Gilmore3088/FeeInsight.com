import { describe, expect, it } from "vitest";
import { emailMatchesWebsite, isPersonalEmail, linkVerifiedInstitutions, personalEmailCheckoutError } from "./pro-institution-link";

// Invented addresses and banks for tests only.
describe("isPersonalEmail", () => {
  it("flags personal mailbox providers and unusable addresses", () => {
    expect(isPersonalEmail("pat@gmail.com")).toBe(true);
    expect(isPersonalEmail("Pat@Outlook.com")).toBe(true);
    expect(isPersonalEmail("not-an-email")).toBe(true);
    expect(isPersonalEmail(null)).toBe(true);
    expect(isPersonalEmail("pat@yahoo.co.uk")).toBe(true);
    expect(isPersonalEmail("pat@hotmail.fr")).toBe(true);
  });

  it("accepts a work address", () => {
    expect(isPersonalEmail("pat@firstexamplebank.com")).toBe(false);
  });
});

describe("emailMatchesWebsite", () => {
  it("matches the bank's own host, with or without www", () => {
    expect(emailMatchesWebsite("Pat@FirstExampleBank.com", "https://www.firstexamplebank.com/personal")).toBe(true);
    expect(emailMatchesWebsite("pat@firstexamplebank.com", "firstexamplebank.com")).toBe(true);
  });

  it("never matches across a shared vendor or parent host", () => {
    // A site hosted at a vendor proves nothing about an address at the vendor.
    expect(emailMatchesWebsite("pat@cuvendor.com", "https://examplefcu.cuvendor.com")).toBe(false);
    expect(emailMatchesWebsite("pat@mail.firstexamplebank.com", "https://www.firstexamplebank.com")).toBe(false);
    expect(emailMatchesWebsite("pat@yahoo.co.uk", "https://yahoo.co.uk")).toBe(false);
  });

  it("does not match another domain, a missing website or a personal address", () => {
    expect(emailMatchesWebsite("pat@otherbank.com", "https://firstexamplebank.com")).toBe(false);
    expect(emailMatchesWebsite("pat@firstexamplebank.com", null)).toBe(false);
    expect(emailMatchesWebsite("pat@gmail.com", "https://gmail.com")).toBe(false);
  });
});

describe("personalEmailCheckoutError", () => {
  it("asks for the work address and names the contact", () => {
    expect(personalEmailCheckoutError("hello@example.com")).toBe(
      "Pro for a bank or credit union needs your work email, so we can link your institution. Create an account with your work address, or email hello@example.com.",
    );
  });
});

type Row = Record<string, unknown>;

function fakeDb(candidates: Row[]) {
  const issued: string[] = [];
  const db = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    issued.push(text);
    if (text.includes("FROM institution_claims c")) return Promise.resolve(candidates);
    if (text.includes("UPDATE institution_claims")) return Promise.resolve([{ id: 1 }]);
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof linkVerifiedInstitutions>[0] & { json: (v: unknown) => unknown };
  (db as { json: (v: unknown) => unknown }).json = (v) => v;
  return { db, issued };
}

describe("linkVerifiedInstitutions", () => {
  it("only reads requests whose owner confirmed their email", async () => {
    const { db, issued } = fakeDb([]);
    expect(await linkVerifiedInstitutions(db, 7)).toEqual([]);
    expect(issued[0]).toContain("u.email_confirmed_at IS NOT NULL");
    expect(issued).toHaveLength(1);
  });

  it("grants the owner seat when the confirmed email matches the bank's website", async () => {
    const { db, issued } = fakeDb([
      { claim_id: 11, institution_id: 8109, review_status: "pending", email: "pat@firstexamplebank.com", website_url: "https://www.firstexamplebank.com" },
    ]);
    expect(await linkVerifiedInstitutions(db, 7)).toEqual([8109]);
    expect(issued.join("\n")).toContain("resolution = 'verified_claim'");
    expect(issued.join("\n")).toContain("INSERT INTO institution_workspace_memberships");
  });

  it("leaves a mismatched request open for the admin check", async () => {
    const { db, issued } = fakeDb([
      { claim_id: 12, institution_id: 8110, review_status: "pending", email: "pat@otherbank.com", website_url: "https://firstexamplebank.com" },
    ]);
    expect(await linkVerifiedInstitutions(db, 7)).toEqual([]);
    expect(issued.join("\n")).not.toContain("INSERT INTO institution_workspace_memberships");
    expect(issued.join("\n")).not.toContain("UPDATE institution_claims");
  });
});
