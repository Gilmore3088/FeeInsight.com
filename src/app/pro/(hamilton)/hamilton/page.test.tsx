import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/components/hamilton/intelligence/CommandCenter", () => ({ CommandCenter: () => null }));
vi.mock("@/components/hamilton/intelligence/IntelligenceWorkspace", () => ({ IntelligenceWorkspace: () => null }));

import OverviewPage, { metadata } from "./page";
import { CommandCenter } from "@/components/hamilton/intelligence/CommandCenter";
import { IntelligenceWorkspace } from "@/components/hamilton/intelligence/IntelligenceWorkspace";

type Child = { type: unknown; props: Record<string, unknown> };
const kids = (el: { props: { children: unknown } }) => (el.props.children as Child[]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 7 });
});

describe("Command center landing (#1891, Hamilton redesign)", () => {
  it("opens on the institution's command center dashboard", async () => {
    mocks.resolve.mockResolvedValue({ institution: { id: 2945, name: "Harbor Ridge Test Bank", stateCode: "FL", city: "Tampa" } });
    const page = await OverviewPage({ searchParams: Promise.resolve({ instId: "2945" }) });
    const center = (page as unknown as { props: { children: Child } }).props.children;
    expect(center.type).toBe(CommandCenter);
    expect(center.props.institution).toEqual({ id: 2945, name: "Harbor Ridge Test Bank", stateCode: "FL", city: "Tampa" });
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: "2945", persistUrlSelection: false });
    expect(metadata.title).toBe("Command center");
  });

  it("is the market when a market is chosen, with no command center", async () => {
    const market = await OverviewPage({ searchParams: Promise.resolve({ research: "x" }) });
    expect((market as Child).type).toBe(IntelligenceWorkspace);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("with no institution on file, keeps a clear way to choose one above the national overview", async () => {
    for (const setup of [() => mocks.resolve.mockResolvedValue({ institution: null }), () => mocks.resolve.mockRejectedValue(new Error("db"))]) {
      setup();
      const page = await OverviewPage({ searchParams: Promise.resolve({}) });
      const [prompt, overview] = kids(page as never);
      expect(overview.type).toBe(IntelligenceWorkspace);
      const html = renderToStaticMarkup(prompt as never);
      expect(html).toContain('href="/pro/settings"');
      expect(html).toContain("Choose your institution");
    }
  });
});
