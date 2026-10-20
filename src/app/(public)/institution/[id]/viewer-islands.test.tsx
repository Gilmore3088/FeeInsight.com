import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toFinancialPoint } from "./financial-history";
import type { InstitutionFinancialHistoryRow } from "@/lib/data-store/financial";
import type { ProFinancialProfileData } from "./financial-profile-data";

const viewer = vi.hoisted(() => ({
  session: null as { signedIn: boolean; isPro: boolean } | null,
  loadProfile: vi.fn(),
}));

vi.mock("@/components/use-session-chrome", () => ({ useSessionChrome: () => viewer.session }));
vi.mock("./viewer-actions", () => ({
  loadProFinancialProfile: viewer.loadProfile,
  loadAlertSubscription: vi.fn(),
}));
vi.mock("./fee-alert-control", () => ({ FeeAlertControl: () => null }));
// This component is now dynamically reachable from a client island. Any accidental
// runtime import of the SQL reader by presentation code must fail this import test.
vi.mock("@/lib/data-store/connection", () => {
  throw new Error("SQL must never be imported by the financial profile client");
});

import { ProFinancialProfile } from "./viewer-islands";

const input = { institutionId: 82, institutionName: "WaFd Bank", charterLabel: "Bank" };
const point = toFinancialPoint({
  report_date: "2026-06-30", source: "fdic", total_assets: 1_100_000, net_income: 2_200, service_charge_income: 1_100, roa: 1.1,
} as InstitutionFinancialHistoryRow);
const profile = (institutionId = 82): ProFinancialProfileData => ({
  institutionId,
  points: [point],
  peers: null,
  insights: { growth: [], ranks: [], flags: [], peerCount: null, peerQuarter: null },
  regulatoryWatch: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  viewer.session = { signedIn: true, isPro: true };
  viewer.loadProfile.mockReset().mockResolvedValue(profile());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Pro financial profile client island", () => {
  it("loads and renders the real chart component from the plain action data", async () => {
    render(<ProFinancialProfile {...input} />);
    expect(await screen.findByRole("region", { name: "Financial profile" })).toBeInTheDocument();
    expect(screen.getByText("Total assets")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Time range" })).toBeInTheDocument();
    expect(screen.getByText("$1.1B")).toBeInTheDocument();
    expect(viewer.loadProfile).toHaveBeenCalledWith(input);
  });

  it("does not load Pro data or render charts for signed-out and free readers", () => {
    for (const session of [null, { signedIn: true, isPro: false }]) {
      viewer.session = session;
      const { unmount } = render(<ProFinancialProfile {...input} />);
      expect(screen.queryByRole("region", { name: "Financial profile" })).toBeNull();
      unmount();
    }
    expect(viewer.loadProfile).not.toHaveBeenCalled();
  });

  it("leaves the public profile intact when the Pro action rejects", async () => {
    viewer.loadProfile.mockRejectedValue(new Error("profile unavailable"));
    render(<><h1>WaFd Bank</h1><ProFinancialProfile {...input} /></>);
    await waitFor(() => expect(viewer.loadProfile).toHaveBeenCalledOnce());
    expect(screen.getByRole("heading", { name: "WaFd Bank" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Financial profile" })).toBeNull();
  });

  it("hides the previous institution's data while navigation loads its replacement", async () => {
    const next = deferred<ProFinancialProfileData>();
    viewer.loadProfile.mockResolvedValueOnce(profile()).mockReturnValueOnce(next.promise);
    const { rerender } = render(<ProFinancialProfile {...input} />);
    await screen.findByRole("region", { name: "Financial profile" });
    rerender(<ProFinancialProfile {...input} institutionId={281} institutionName="Other Bank" />);
    expect(screen.queryByRole("region", { name: "Financial profile" })).toBeNull();
    await act(async () => { next.resolve(profile(281)); });
    expect(screen.getByRole("region", { name: "Financial profile" })).toBeInTheDocument();
  });

  it("ignores an old institution's response that finishes after navigation", async () => {
    const old = deferred<ProFinancialProfileData>();
    const next = deferred<ProFinancialProfileData>();
    viewer.loadProfile.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { rerender } = render(<ProFinancialProfile {...input} />);
    rerender(<ProFinancialProfile {...input} institutionId={281} institutionName="Other Bank" />);
    await act(async () => { next.resolve(profile(281)); });
    expect(screen.getByRole("region", { name: "Financial profile" })).toBeInTheDocument();
    await act(async () => { old.resolve(profile()); });
    expect(screen.getByRole("region", { name: "Financial profile" })).toBeInTheDocument();
  });
});
