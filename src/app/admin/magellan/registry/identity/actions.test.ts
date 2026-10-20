import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission, User } from "@/lib/auth";

const fixture = vi.hoisted(() => ({
  user: null as User | null,
  requireAuth: vi.fn(),
  withTransaction: vi.fn(),
  apply: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAuth: fixture.requireAuth.mockImplementation(async (permission?: Permission) => {
      if (!fixture.user || (permission && !actual.hasPermission(fixture.user, permission))) {
        throw new Error("operator access denied");
      }
      return fixture.user;
    }),
  };
});
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: fixture.withTransaction }));
vi.mock("@/lib/agents/magellan/registry/identity", () => ({ applyIdentityDecision: fixture.apply, IDENTITY_REVIEW_BULK_LIMIT: 50 }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: fixture.redirect }));

import {
  acceptIdentityLinkAction,
  bulkDecideIdentityLinksAction,
  rejectIdentityLinkAction,
  resetIdentityLinkAction,
} from "./actions";

const TX = { tx: true };

function user(role: User["role"]): User {
  return { id: 7, role, username: "synthetic-reviewer" } as User;
}

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = (await run.then(() => null, (e: unknown) => e)) as { to?: string } | null;
  expect(error?.to).toBeDefined();
  return decodeURIComponent(error!.to!.replace(/\+/g, " "));
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.user = user("analyst");
  fixture.withTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(TX));
  fixture.apply.mockImplementation(async (_tx: unknown, input: { linkId: number; decision: string; institutionId: number | null }) => ({
    linkId: input.linkId,
    linkType: "cfpb_company",
    externalKey: `K${input.linkId}`,
    before: { institutionId: 1, status: "needs_review" },
    after: { institutionId: input.institutionId ?? 1, status: input.decision === "accept" ? "accepted" : "rejected" },
  }));
});

describe("identity link review actions", () => {
  it("refuses signed-out, free, Pro and approve-less callers before any write", async () => {
    const actions = [
      () => acceptIdentityLinkAction(form([["linkId", "41"]])),
      () => rejectIdentityLinkAction(form([["linkId", "41"]])),
      () => resetIdentityLinkAction(form([["linkId", "41"]])),
      () => bulkDecideIdentityLinksAction(form([["decision", "accept"], ["linkId", "41"]])),
    ];
    for (const identity of [null, user("viewer"), user("premium")]) {
      fixture.user = identity;
      for (const run of actions) await expect(run()).rejects.toThrow("operator access denied");
    }
    expect(fixture.requireAuth).toHaveBeenCalledWith("approve");
    expect(fixture.withTransaction).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("accepts and re-points one link in a transaction as the signed-in reviewer, then revalidates both institutions", async () => {
    const to = await redirectOf(
      acceptIdentityLinkAction(form([["linkId", "41"], ["institutionId", "5"], ["back", "/admin/magellan/registry/identity?type=sec_cik&pick=41"]])),
    );
    expect(fixture.withTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.apply).toHaveBeenCalledWith(TX, {
      linkId: 41,
      decision: "accept",
      institutionId: 5,
      note: null,
      reviewer: { id: 7, username: "synthetic-reviewer" },
    });
    for (const path of ["/admin/magellan/registry/identity", "/admin/magellan/registry", "/institution/1", "/institution/5", "/admin/institution/5"]) {
      expect(fixture.revalidatePath).toHaveBeenCalledWith(path);
    }
    expect(to).toBe("/admin/magellan/registry/identity?type=sec_cik&msg=Accepted 1 link.");
  });

  it("rejects with a note and resets without one; a reset never carries an institution", async () => {
    await redirectOf(rejectIdentityLinkAction(form([["linkId", "41"], ["institutionId", "9"], ["note", "  Different bank  "]])));
    expect(fixture.apply).toHaveBeenLastCalledWith(TX, expect.objectContaining({ decision: "reject", note: "Different bank", institutionId: null }));
    await redirectOf(resetIdentityLinkAction(form([["linkId", "41"]])));
    expect(fixture.apply).toHaveBeenLastCalledWith(TX, expect.objectContaining({ decision: "reset", note: null, institutionId: null }));
  });

  it("decides up to 50 ticked links in one transaction and refuses more", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => ["linkId", String(i + 1)] as [string, string]);
    const to = await redirectOf(bulkDecideIdentityLinksAction(form([["decision", "reject"], ...ids])));
    expect(fixture.withTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.apply).toHaveBeenCalledTimes(50);
    expect(to).toContain("Rejected 50 links.");

    vi.clearAllMocks();
    const tooMany = await redirectOf(bulkDecideIdentityLinksAction(form([["decision", "accept"], ...ids, ["linkId", "51"]])));
    expect(tooMany).toContain("at most 50 links");
    expect(fixture.withTransaction).not.toHaveBeenCalled();
  });

  it("writes nothing for malformed input and never redirects off the review page", async () => {
    for (const data of [form([["linkId", "abc"]]), form([["linkId", "-3"]]), form([])]) {
      expect(await redirectOf(acceptIdentityLinkAction(data))).toContain("Nothing saved");
    }
    expect(await redirectOf(bulkDecideIdentityLinksAction(form([["decision", "delete"], ["linkId", "1"]])))).toContain("Nothing saved");
    expect(fixture.withTransaction).not.toHaveBeenCalled();
    const offsite = await redirectOf(acceptIdentityLinkAction(form([["linkId", "41"], ["back", "https://evil.example/"]])));
    expect(offsite.startsWith("/admin/magellan/registry/identity?msg=")).toBe(true);
  });

  it("reports a failed transaction without revalidating", async () => {
    fixture.withTransaction.mockRejectedValueOnce(new Error("Choose an institution before accepting this link."));
    const to = await redirectOf(acceptIdentityLinkAction(form([["linkId", "41"]])));
    expect(to).toContain("Nothing saved: Choose an institution");
    expect(fixture.revalidatePath).not.toHaveBeenCalled();
  });
});
