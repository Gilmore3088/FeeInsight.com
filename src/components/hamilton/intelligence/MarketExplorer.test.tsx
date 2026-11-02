import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/pro/intelligence", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("no database in unit tests"); } }));
vi.mock("@/app/pro/(hamilton)/reports/board-actions", () => ({ createMarketBoardBrief: vi.fn() }));

import { buildMarketExplorer, type ExplorerValue } from "@/lib/hamilton/dashboard/market-explorer";
import type { LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { assetSizeFor } from "@/lib/hamilton/asset-size";
import { ResearchExplorer } from "./ResearchExplorer";
import { IntelligenceView, type Loaded } from "./IntelligenceWorkspace";

const value = (id: number, amount: number, stateCode = "FL", extra: Partial<ExplorerValue> = {}): ExplorerValue => ({
  id, name: `Test Bank ${String(id).padStart(2, "0")}`, stateCode, assets: 400_000 + id * 1000, charter: "bank", amount, documentUrl: `https://example.test/${id}.pdf`, ...extra,
});
const values = [...Array.from({ length: 20 }, (_, i) => value(i + 1, 20 + i)), value(90, 36, "GA"), value(91, 30, "FL", { name: "Space Coast Credit Union", charter: "credit_union" })];
const selection: LandingResearchHandoff = { version: 1, task: "compare", scope: { kind: "state", stateCode: "FL" }, charter: "all", categories: ["overdraft", "nsf"] };
const base = { selection, size: "all", district: null, instId: "7" };
const subject = { id: 7, name: "Harbor Test Bank", stateCode: "FL", value: { ...value(7, 38), name: "Harbor Test Bank" } };
const empty: Loaded = { fees: null, feeMap: null, peers: null, revenue: null, tiers: null, economy: null, complaints: null, articles: null, statePosts: null };

function explorer(region: Parameters<typeof buildMarketExplorer>[0]["region"], inRegion: (v: ExplorerValue) => boolean, list = values) {
  return buildMarketExplorer({ category: "overdraft", feeName: "Overdraft", region, values: list.map((v) => (v.id === 7 ? subject.value : v)), inRegion, subject });
}

describe("ResearchExplorer", () => {
  it("leads with the market's figures and marks the subject on every exhibit", () => {
    const data = explorer({ kind: "state", stateCode: "FL", label: "Florida" }, (v) => v.stateCode === "FL");
    render(<ResearchExplorer data={data} landscape={null} base={base} size={assetSizeFor(null)} subjectState="FL" subjectDistrict={6} />);
    expect(screen.getByRole("group", { name: "Fee" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Florida", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fed district 6" })).toBeTruthy();
    expect(screen.getByText("Institutions counted")).toBeTruthy();
    expect(screen.getAllByText("Harbor Test Bank").length).toBeGreaterThan(0);
    expect(screen.getByText(/^▲ Above$/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Overdraft prices, 21 institutions/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /States by median overdraft price/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: /Overdraft at every institution in Florida/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Space Coast");
    expect(screen.getByText(/1 counted but not named/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("could not load");

    fireEvent.click(screen.getByRole("button", { name: "National" }));
    expect(new URL(push.mock.calls.at(-1)![0], "https://x").searchParams.get("instId")).toBe("7");
    fireEvent.click(screen.getByRole("button", { name: "Find Harbor Test Bank" }));
    expect(screen.getByText("Harbor Test Bank", { selector: "a" }).closest("tr")!.className).toContain("hd-subject");
  }, 30_000);

  it("says too few instead of a median, and lists states nationally", () => {
    const thin = explorer({ kind: "state", stateCode: "GA", label: "Georgia" }, (v) => v.stateCode === "GA");
    const html = renderToStaticMarkup(<ResearchExplorer data={thin} landscape={null} base={base} size={assetSizeFor(null)} subjectState="FL" subjectDistrict={6} />);
    expect(html).toContain("Too few");
    expect(html).toContain("Needs 10; 1 here");
    expect(html).toContain("Outside this filter");
    const national = explorer({ kind: "national", label: "United States" }, () => true);
    const nat = renderToStaticMarkup(<ResearchExplorer data={national} landscape={null} base={base} size={assetSizeFor(null)} subjectState="FL" subjectDistrict={6} />);
    expect(nat).toContain("By state");
    expect(nat).toContain("Harbor Test Bank vs median");
  });

  it("is the fees lens of Research, with the lens tabs and board brief kept", () => {
    const data = explorer({ kind: "state", stateCode: "FL", label: "Florida" }, (v) => v.stateCode === "FL");
    const html = renderToStaticMarkup(<IntelligenceView selection={selection} data={empty} lens="fees" overview={false} instId="7" explorer={{ data, base, subjectState: "FL", subjectDistrict: 6 }} />);
    expect(html).toContain("Overdraft across Florida");
    expect(html).toContain("Harbor Test Bank charges $38");
    expect(html).toContain("Build board brief");
    expect(html).toContain('aria-label="Research lenses"');
    expect(html).not.toContain("Space Coast");
  });
});
