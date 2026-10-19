import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/components/hamilton/intelligence/InstitutionBriefing", () => ({ InstitutionBriefing: () => null }));
vi.mock("@/components/hamilton/intelligence/IntelligenceWorkspace", () => ({ IntelligenceWorkspace: () => null, MarketContext: () => null }));

import OverviewPage from "./page";
import { InstitutionBriefing } from "@/components/hamilton/intelligence/InstitutionBriefing";
import { IntelligenceWorkspace, MarketContext } from "@/components/hamilton/intelligence/IntelligenceWorkspace";

type Child = { type: unknown; props: Record<string, unknown> };
const kids = (el: { props: { children: unknown } }) => (el.props.children as Child[]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 7 });
});

describe("Overview (#2042)", () => {
  it("opens on the research institution's briefing, with its state's market below", async () => {
    mocks.resolve.mockResolvedValue({ institution: { id: 2945, stateCode: "FL" } });
    const page = await OverviewPage({ searchParams: Promise.resolve({ instId: "2945" }) });
    const [briefing, market] = kids(page as never);
    expect(briefing.type).toBe(InstitutionBriefing);
    expect(await (briefing.props.searchParams as Promise<unknown>)).toEqual({ instId: "2945" });
    expect((market.props.children as Child).type).toBe(MarketContext);
    expect((market.props.children as Child).props.stateCode).toBe("FL");
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: "2945", persistUrlSelection: false });
  });

  it("is the market overview when a market is chosen or no institution is on file", async () => {
    const market = await OverviewPage({ searchParams: Promise.resolve({ research: "x" }) });
    expect((market as Child).type).toBe(IntelligenceWorkspace);
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({ institution: null });
    expect(((await OverviewPage({ searchParams: Promise.resolve({}) })) as Child).type).toBe(IntelligenceWorkspace);
    mocks.resolve.mockRejectedValue(new Error("db"));
    expect(((await OverviewPage({ searchParams: Promise.resolve({}) })) as Child).type).toBe(IntelligenceWorkspace);
  });
});
