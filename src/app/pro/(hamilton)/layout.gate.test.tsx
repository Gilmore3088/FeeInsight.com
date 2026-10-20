import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), premium: vi.fn(), headers: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium, isPaymentLapsed: () => false, PAST_DUE_GRACE_DAYS: 7 }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/components/hamilton/layout/HamiltonShell", () => ({ HamiltonShell: () => null }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: vi.fn() }));
vi.mock("@/lib/hamilton/artifact-context-store", () => ({ getHamiltonArtifactInstitutionId: vi.fn() }));
import HamiltonLayout from "./layout";
import { landingResearchHref } from "@/lib/hamilton/landing-research-handoff";

beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue(null); mocks.premium.mockReturnValue(false); mocks.sql.mockResolvedValue([]); });
it.each(["compare", "board_report"] as const)("preserves %s research when the nested layout gate redirects first", async task => {
  const path = landingResearchHref({ version: 1, task, scope: { kind: "state", stateCode: "DC" }, charter: "credit_union", categories: ["money_order"] });
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": path }));
  const inner = HamiltonLayout({ children: null }).props.children;
  await expect(inner.type(inner.props)).rejects.toThrow(`/login?from=${encodeURIComponent(path)}`);
  mocks.user.mockResolvedValue({ id: 7, stripe_customer_id: null });
  await expect(inner.type(inner.props)).rejects.toThrow(`/subscribe?from=${encodeURIComponent(path)}&reason=pro_required`);
});
it("does not accept an external return destination", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "https://example.com" }));
  const inner = HamiltonLayout({ children: null }).props.children;
  await expect(inner.type(inner.props)).rejects.toThrow("/login?from=%2Fpro%2Fhamilton");
});
it("sends a seat member whose team owner's payment lapsed to the team-billing page (#1999)", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/hamilton" }));
  mocks.user.mockResolvedValue({ id: 7, stripe_customer_id: null, subscription_status: "none" });
  mocks.sql.mockResolvedValue([{ owner_name: "Dana Owner", owner_email: "dana@bank.example", team_name: "First Bank" }]);
  const inner = HamiltonLayout({ children: null }).props.children;
  await expect(inner.type(inner.props)).rejects.toThrow("/account/team-billing");
});
