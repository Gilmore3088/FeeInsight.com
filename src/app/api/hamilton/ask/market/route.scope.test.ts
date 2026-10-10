import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), premium: vi.fn(), resolve: vi.fn(), answer: vi.fn(), geography: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/lib/hamilton/local-market-answer", () => ({ getLocalMarketAnswer: mocks.answer }));
vi.mock("@/lib/hamilton/landing-geographic-research", () => ({ loadLandingGeographicResearch: mocks.geography }));
// Route-policy middleware has separate tests; these cases exercise the actual handler.
vi.mock("@/lib/api-hardening/route-wrapper", () => ({
  withApiRoutePolicy: (_id: string, _method: string, handler: (request: Request) => Promise<Response>) => handler,
}));

import { POST } from "./route";
import { DEFAULT_LOCAL_MARKET_CATEGORIES, homepageLocalMarketRequest } from "@/lib/hamilton/local-market-request";

const request = (body: unknown) => new Request("https://example.test/api/hamilton/ask/market", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  // Reset implementations and once-queues as well as call history between scenarios.
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 7 });
  mocks.premium.mockReturnValue(true);
  mocks.resolve.mockResolvedValue({ institution: { id: 101 } });
  // This boundary returns a fixed result; argument assertions below verify scope transport.
  mocks.answer.mockResolvedValue({ institutionId: 101, categories: ["paper_statement", "money_order"] });
  mocks.geography.mockResolvedValue({ scope: { kind: "state", stateCode: "WA" }, charter: "credit_union", comparisons: [] });
});

describe("governed geographic research at the same authenticated market route", () => {
  const selected = {
    version: 1, task: "compare",
    scope: { kind: "state", stateCode: "WA" },
    charter: "credit_union",
    categories: ["paper_statement", "money_order"],
  };

  it("passes explicit state, charter and categories to the governed reader without account inference or paid AI", async () => {
    const response = await POST(request({ research: selected }));
    expect(response.status).toBe(200);
    expect((await response.json()).scope).toEqual({ kind: "state", stateCode: "WA" });
    expect(mocks.geography).toHaveBeenCalledWith(selected);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("accepts national comparison with the caller's category subset", async () => {
    const national = { ...selected, scope: { kind: "national" }, charter: "bank", categories: ["stop_payment"] };
    const response = await POST(request({ research: national }));
    expect(response.status).toBe(200);
    expect(mocks.geography).toHaveBeenCalledWith(national);
  });

  it("preserves local subject, charter and categories without workspace fallback", async () => {
    const local = { ...selected, scope: { kind: "local", institutionId: 101 } };
    const response = await POST(request({ research: local }));
    expect(response.status).toBe(200);
    expect(mocks.answer).toHaveBeenCalledWith(101, { categories: selected.categories, charter: selected.charter });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.geography).not.toHaveBeenCalled();
    expect((await response.json()).charter).toBe(selected.charter);
  });

  it.each([
    { research: { ...selected, scope: { kind: "state", stateCode: "XX" } } },
    { research: { ...selected, task: "board_report" } },

    { research: selected, institutionId: 101 },
    { research: selected, categories: ["overdraft"] },
    { research: null },
  ])("rejects mismatched, unsupported or mixed scope without executing it: %#", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.geography).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("does not let signed-out and non-premium visitors read geographic research", async () => {
    mocks.premium.mockReturnValue(false);
    expect((await POST(request({ research: selected }))).status).toBe(401);
    expect(mocks.geography).not.toHaveBeenCalled();
  });

  it("returns a safe failure when the governed reader throws; never falls back to local or AI", async () => {
    mocks.geography.mockRejectedValue(new Error("synthetic source outage"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(request({ research: selected }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Hamilton could not load the selected market just now." });
      expect(mocks.answer).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });
});

describe("local-market scope at the authenticated route boundary", () => {
  it("carries the homepage selection through the actual handler", async () => {
    const body = homepageLocalMarketRequest(101, ["paper_statement", "money_order"]);
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ institutionId: 101, categories: body.categories });
    expect(mocks.answer).toHaveBeenCalledWith(101, { categories: body.categories });
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: 101, persistUrlSelection: false });
  });

  it("preserves existing institution-only requests", async () => {
    expect((await POST(request({ institutionId: "101" }))).status).toBe(200);
    expect(mocks.answer).toHaveBeenCalledWith(101, { categories: [...DEFAULT_LOCAL_MARKET_CATEGORIES] });
  });

  it("allows the authenticated default only when no explicit subject was given", async () => {
    expect((await POST(request({ categories: ["cashiers_check"] }))).status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: null, persistUrlSelection: false });
  });

  it("refuses a different resolved institution instead of borrowing the user's default", async () => {
    mocks.resolve.mockResolvedValue({ institution: { id: 202 } });
    const response = await POST(request({ institutionId: 101, categories: ["paper_statement"] }));
    expect(response.status).toBe(400);
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it.each([null, [], { categories: [] }, { institutionId: "101junk" }, { state: "WA" }, { accountInstitutionId: 202 }].map((body) => ({ body })))
    ("rejects malformed or unsupported scope without resolving or querying: $body", async ({ body }) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.answer).not.toHaveBeenCalled();
    });

  it("rejects unreadable JSON, not a default request", async () => {
    const response = await POST(new Request("https://example.test", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each(["signed-out", "non-premium"])("keeps %s requests unauthorized", async (kind) => {
    if (kind === "signed-out") mocks.user.mockResolvedValue(null);
    else mocks.premium.mockReturnValue(false);
    expect((await POST(request({ institutionId: 101 }))).status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("returns a missing-subject error without falling through to analysis", async () => {
    mocks.resolve.mockResolvedValue({ institution: null, error: "Choose an institution first." });
    expect((await POST(request({}))).status).toBe(400);
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("keeps a missing branch market distinct from a successful empty result", async () => {
    mocks.answer.mockReset().mockResolvedValueOnce(null);
    const response = await POST(request({ institutionId: 101 }));
    expect(mocks.answer).toHaveBeenCalledTimes(1);
    expect(mocks.answer).toHaveBeenCalledWith(101, { categories: [...DEFAULT_LOCAL_MARKET_CATEGORIES] });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No branch market is on file for this institution yet." });
  });

  it("does not mistake a located market with no fee data for an absent market", async () => {
    const emptyMarket = { institutionId: 101, categories: ["cashiers_check"], competitors: [], you: { fees: {} } };
    mocks.answer.mockReset().mockResolvedValueOnce(emptyMarket);
    const response = await POST(request({ institutionId: 101, categories: ["cashiers_check"] }));
    expect(mocks.answer).toHaveBeenCalledWith(101, { categories: ["cashiers_check"] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyMarket);
  });

  it("returns a recoverable error when a dependency fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.answer.mockRejectedValue(new Error("synthetic failure"));
    try {
      const response = await POST(request({ institutionId: 101 }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Hamilton could not load the selected market just now." });
    } finally { log.mockRestore(); }
  });
});
