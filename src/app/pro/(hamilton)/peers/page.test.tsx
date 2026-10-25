import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeeFingerprint } from "@/lib/hamilton/fee-fingerprint";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  context: vi.fn(),
  fingerprint: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.context }));
vi.mock("@/lib/hamilton/fee-fingerprint", () => ({ loadFeeFingerprint: mocks.fingerprint }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
}));

import PeersPage from "./page";

const fingerprint = (saved: boolean): FeeFingerprint => ({
  institutionName: "Capital City Bank",
  peerLabel: saved ? "Team peers" : "Banks, $1B to $10B in assets",
  saved,
  minPeers: 10,
  source: "Fees on each institution's own published schedule",
  strips: [
    {
      feeCategory: "stop_payment",
      feeName: "Stop Payment",
      status: "not_published",
      current: null,
      currentLabel: null,
      peerCount: 0,
      peerAmounts: [],
      band: null,
      percentile: null,
      namedPeers: [],
      period: null,
    },
  ],
});

const render = async (params: { instId?: string } = { instId: "323" }) =>
  renderToStaticMarkup(await PeersPage({ searchParams: Promise.resolve(params) }));

describe("Peers page", () => {
  beforeEach(() => {
    mocks.user.mockResolvedValue({ id: 7 });
    mocks.context.mockResolvedValue({ institution: { id: 323, name: "Capital City Bank" } });
    mocks.fingerprint.mockReset();
  });

  it("sends a signed-out reader to log in and back", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("REDIRECT:/login?from=%2Fpro%2Fpeers%3FinstId%3D323");
  });

  it("names the saved peer set every screen uses and reads the fingerprint against it", async () => {
    mocks.fingerprint.mockResolvedValue(fingerprint(true));
    const html = await render();
    expect(mocks.fingerprint).toHaveBeenCalledWith({ userId: 7, institutionId: 323 });
    expect(html).toContain("Every Hamilton screen compares Capital City Bank with Team peers, your saved peer group.");
    expect(html).toContain("Change the peer group");
    expect(html).toContain("Missing");
  });

  it("offers to save a peer set when none is saved", async () => {
    mocks.fingerprint.mockResolvedValue(fingerprint(false));
    const html = await render();
    expect(html).toContain("the peer group Hamilton picks");
    expect(html).toContain("Save a peer group");
    expect(html).toContain("/pro/settings?instId=323#peer-sets");
  });

  it("says so when the fingerprint can't load", async () => {
    mocks.fingerprint.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = await render();
    expect(html).toContain("couldn&#x27;t load just now");
  });

  it("asks for an institution when none is chosen", async () => {
    mocks.context.mockResolvedValue({ institution: null });
    const html = await render({});
    expect(html).toContain("Choose a research institution");
    expect(mocks.fingerprint).not.toHaveBeenCalled();
  });
});
