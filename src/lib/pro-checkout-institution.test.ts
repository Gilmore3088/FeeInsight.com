import { describe, expect, it, vi } from "vitest";
import type { sql as sqlClient } from "@/lib/data-store/connection";
import { anchorPaidInstitution, chosenProInstitutionId, PRE_CHECKOUT_INTENT } from "./pro-checkout-institution";

vi.mock("@/lib/pro-institution-link", () => ({ linkVerifiedInstitutions: vi.fn(async () => []) }));

type Db = typeof sqlClient;

function fakeDb(result: unknown | ((query: string) => unknown)) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      calls.push({ query, values });
      if (typeof result === "function") return (result as (query: string) => unknown)(query);
      return result;
    },
    { json: (value: unknown) => value },
  );
  return { db: db as unknown as Db, calls };
}

describe("chosenProInstitutionId (#1958)", () => {
  it("reads a signed-in user whose id arrives as text, and returns a numeric institution id", async () => {
    const { db, calls } = fakeDb([{ institution_id: "2945" }]);
    expect(await chosenProInstitutionId(db, "26")).toBe(2945);
    expect(calls).toHaveLength(1);
    // The membership, then the open link request, then the saved bank, all for user 26.
    expect(calls[0].values).toEqual([26, 26, 26]);
    const query = calls[0].query;
    expect(query.indexOf("institution_workspace_memberships")).toBeLessThan(query.indexOf("institution_claims"));
    expect(query.indexOf("institution_claims")).toBeLessThan(query.indexOf("hamilton_workspace_contexts"));
    expect(query).toContain("review_status IN ('pending', 'needs_info')");
  });

  it("returns null when nothing is chosen, the id is unusable, or the read fails", async () => {
    expect(await chosenProInstitutionId(fakeDb([{ institution_id: null }]).db, 26)).toBeNull();
    expect(await chosenProInstitutionId(fakeDb([]).db, 26)).toBeNull();
    const unused = fakeDb([{ institution_id: 1 }]);
    expect(await chosenProInstitutionId(unused.db, "not-a-user")).toBeNull();
    expect(unused.calls).toHaveLength(0);
    expect(await chosenProInstitutionId(fakeDb(() => { throw new Error("down"); }).db, 26)).toBeNull();
  });
});

describe("anchorPaidInstitution", () => {
  it("replaces only a bank picked before paying with the bank paid for", async () => {
    const { db, calls } = fakeDb([]);
    await anchorPaidInstitution(db, { userId: 26, institutionId: 2945, note: "Filed at Pro checkout (cs_1)." });
    const context = calls.find((call) => call.query.includes("hamilton_workspace_contexts"))!;
    expect(context.query).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(context.query).toContain("WHERE hamilton_workspace_contexts.last_intent = ?");
    expect(context.query).toContain("'pro_checkout'");
    expect(context.values).toEqual([26, 2945, PRE_CHECKOUT_INTENT]);
  });
});
