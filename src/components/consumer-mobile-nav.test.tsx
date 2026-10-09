import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/guides/overdraft-fees" }));
let session: { signedIn: boolean; isPro?: boolean; isStaff?: boolean } = { signedIn: false };
vi.mock("./use-session-chrome", () => ({ useSessionChrome: () => session }));

import { ConsumerMobileNav, isActivePath } from "./consumer-mobile-nav";

describe("ConsumerMobileNav", () => {
  it("opens as a modal dialog, marks the current section and closes on Escape", async () => {
    render(<ConsumerMobileNav />);
    const opener = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Menu" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Guides" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Search banks, fees and guides/ })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("gives Pro readers the account menu's pages on a phone", async () => {
    session = { signedIn: true, isPro: true, isStaff: false };
    try {
      render(<ConsumerMobileNav />);
      fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
      await screen.findByRole("dialog", { name: "Menu" });
      for (const name of ["My bank and data", "All changes", "Institutions", "Fee categories", "Account and billing"]) {
        expect(screen.getByRole("link", { name })).toBeInTheDocument();
      }
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    } finally {
      session = { signedIn: false };
    }
  });

  it("matches a section and its subpages, not lookalike paths", () => {
    expect(isActivePath("/guides/overdraft-fees", "/guides")).toBe(true);
    expect(isActivePath("/guidesx", "/guides")).toBe(false);
    expect(isActivePath("/for-institutions", "/for-institutions#report")).toBe(true);
  });
});
