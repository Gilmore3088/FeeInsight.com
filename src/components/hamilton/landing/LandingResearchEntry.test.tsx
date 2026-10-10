import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), premium: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(url); }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./LandingResearchResults", () => ({ LandingResearchResults: () => null }));
vi.mock("./LandingReportConfirmation", () => ({ LandingReportConfirmation: () => null }));
import { LandingResearchEntry } from "./LandingResearchEntry";
import { landingResearchHref } from "@/lib/hamilton/landing-research-handoff";
const selection = { version: 1, task: "compare", scope: { kind: "state", stateCode: "DC" }, charter: "credit_union", categories: ["money_order"] };
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 7 }); mocks.premium.mockReturnValue(true); });
describe("authenticated landing consumer", () => {
  it.each(["compare", "board_report"] as const)("preserves complete %s selection across login and subscription", async task => {
    const s = { ...selection, task }; const raw = JSON.stringify(s); const from = encodeURIComponent(landingResearchHref(s));
    mocks.user.mockResolvedValue(null);
    await expect(LandingResearchEntry({ raw, task })).rejects.toThrow(`/login?from=${from}`);
    mocks.user.mockResolvedValue({ id: 7 }); mocks.premium.mockReturnValue(false);
    await expect(LandingResearchEntry({ raw, task })).rejects.toThrow(`/subscribe?from=${from}&reason=pro_required`);
  });
  it("passes the validated selection to the existing results panel", async () => {
    const node = await LandingResearchEntry({ raw: JSON.stringify(selection), task: "compare" });
    expect(node.props.selection).toEqual(selection);
  });
  it.each(["{", JSON.stringify({ ...selection, scope: { kind: "state", stateCode: "XX" } })])("fails closed on invalid links", async raw => {
    expect((await LandingResearchEntry({ raw, task: "compare" })).props.role).toBe("alert");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("does not relabel a saved artifact with a landing selection", async () => {
    expect((await LandingResearchEntry({ raw: JSON.stringify(selection), task: "compare", conflictingArtifact: true })).props.role).toBe("alert");
  });
});
