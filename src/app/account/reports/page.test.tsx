import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  loadLibrary: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/account-reports", () => ({ loadOwnReportLibrary: mocks.loadLibrary }));
vi.mock("@/components/utility/utility-shell", () => ({
  UtilityShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  UtilityHeading: ({ title, lede }: { title: React.ReactNode; lede?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{lede}</p>
    </header>
  ),
}));

import AccountReportsPage from "./page";

describe("/account/reports (#1999)", () => {
  beforeEach(() => {
    mocks.loadLibrary.mockReset();
    mocks.user = { id: 7, role: "viewer", subscription_status: "canceled" };
  });

  it("should_show_cancelled_user_their_own_reports_with_download_links", async () => {
    mocks.loadLibrary.mockResolvedValue({
      jobs: [{ id: "job-1", reportType: "peer_brief", completedAt: "2026-09-01T00:00:00Z", downloadHref: "/api/reports/job-1/download" }],
      saved: [{ id: "rep-1", title: "Q3 peer pricing", reportType: "peer", createdAt: "2026-08-01T00:00:00Z" }],
    });
    render(await AccountReportsPage());

    expect(mocks.loadLibrary).toHaveBeenCalledWith(7);
    expect(screen.getByText("Q3 peer pricing")).toBeTruthy();
    expect(screen.getByText("Peer brief")).toBeTruthy();
    const jobLink = screen.getByRole("link", { name: "Download PDF" });
    expect(jobLink.getAttribute("href")).toBe("/api/reports/job-1/download");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy();
  });

  it("should_offer_no_start_or_rerun_controls", async () => {
    mocks.loadLibrary.mockResolvedValue({
      jobs: [],
      saved: [{ id: "rep-1", title: "Q3 peer pricing", reportType: "peer", createdAt: null }],
    });
    const { container } = render(await AccountReportsPage());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/re-run|regenerate/i);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Download PDF"]);
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs.some((href) => href?.startsWith("/pro/reports"))).toBe(false);
  });

  it("should_show_an_empty_state_when_the_account_has_no_reports", async () => {
    mocks.loadLibrary.mockResolvedValue({ jobs: [], saved: [] });
    render(await AccountReportsPage());
    expect(screen.getByText(/You don.t have any reports yet/)).toBeTruthy();
  });

  it("should_send_a_signed_out_visitor_to_login", async () => {
    mocks.user = null;
    await expect(AccountReportsPage()).rejects.toThrow("redirect:/login?from=%2Faccount%2Freports");
    expect(mocks.loadLibrary).not.toHaveBeenCalled();
  });
});
