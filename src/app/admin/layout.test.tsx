import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn(), counts: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: auth.getCurrentUser }));
vi.mock("@/lib/admin-queries", () => ({ getSourceSubmissionCounts: auth.counts }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
// A hostile request must not turn this historical marker into authentication.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-bfi-admin-login-route": "1", "x-pathname": "/admin/login" }),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/brand/components", () => ({ Logo: () => null }));
vi.mock("./logout-button", () => ({ LogoutButton: () => null }));
vi.mock("./admin-nav", () => ({
  AdminBadgesProvider: ({ children }: { children: ReactNode }) => children,
  AdminRoomMenu: () => null,
  AdminRoomTabs: () => null,
  AdminSidebar: () => null,
}));
vi.mock("@/components/command-palette", () => ({
  CommandPalette: () => null,
  CommandPaletteIconTrigger: () => null,
  CommandPaletteTrigger: () => null,
}));
vi.mock("@/components/dark-mode-toggle", () => ({ DarkModeToggle: () => null }));

import AdminLayout from "./layout";

async function renderLayout() {
  const element = AdminLayout({ children: "operator-only-content" });
  const inner = element.type as (props: { children: ReactNode }) => Promise<ReactNode>;
  return inner(element.props);
}

describe("admin layout authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentUser.mockResolvedValue(null);
    auth.counts.mockResolvedValue({ pending: 0 });
  });

  it("validates the session despite forged login-route headers", async () => {
    await expect(renderLayout()).rejects.toThrow("redirect:/admin/login");
    expect(auth.getCurrentUser).toHaveBeenCalledOnce();
    expect(auth.counts).not.toHaveBeenCalled();
  });

  it.each(["viewer", "premium"])("denies %s before reading operator data", async (role) => {
    auth.getCurrentUser.mockResolvedValue({ id: 1, role });
    await expect(renderLayout()).rejects.toThrow("redirect:/account");
    expect(auth.counts).not.toHaveBeenCalled();
  });

  it("fails closed when session lookup fails", async () => {
    auth.getCurrentUser.mockRejectedValue(new Error("session unavailable"));
    await expect(renderLayout()).rejects.toThrow("redirect:/admin/login");
    expect(auth.counts).not.toHaveBeenCalled();
  });

  it.each(["admin", "analyst"])("lets a validated %s render the console", async (role) => {
    auth.getCurrentUser.mockResolvedValue({ id: 1, role, display_name: "Operator" });
    const output = await renderLayout();
    expect(renderToStaticMarkup(output)).toContain("operator-only-content");
    expect(auth.counts).toHaveBeenCalledOnce();
  });
});
