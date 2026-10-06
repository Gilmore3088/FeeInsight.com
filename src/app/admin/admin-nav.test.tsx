// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminNav, AdminNavInline, AdminRoomTabs } from "./admin-nav";

const navigationState = vi.hoisted(() => ({
  pathname: "/admin/states",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  navigationState.pathname = "/admin/states";
});

describe("AdminRoomTabs", () => {
  it("lists the six rooms and marks the one you are in", () => {
    render(<AdminRoomTabs badges={{ knoxPending: 4 }} />);
    const nav = screen.getByRole("navigation", { name: "Admin rooms" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent?.replace(/\d+/g, ""))).toEqual([
      "Today", "Agents", "Data", "Customers", "Publishing", "Controls",
    ]);
    expect(within(nav).getByRole("link", { name: /Agents/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Agents/ })).toHaveTextContent("4");
  });
});

describe("AdminNav", () => {
  it("shows only the current room's screens", () => {
    render(<AdminNav badges={{ trustPending: 3 }} />);
    expect(screen.getByText("State lanes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /State lanes/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Leads")).not.toBeInTheDocument();
  });

  it("follows you into another room", () => {
    navigationState.pathname = "/admin/quality";
    render(<AdminNav badges={{ trustPending: 3 }} />);
    expect(screen.getByRole("link", { name: /Trust review/ })).toHaveTextContent("3");
    expect(screen.queryByText("State lanes")).not.toBeInTheDocument();
  });
});

describe("AdminNavInline", () => {
  it("uses the same screens on a phone", () => {
    render(<AdminNavInline />);
    expect(screen.getByRole("link", { name: /State lanes/ })).toHaveAttribute("href", "/admin/states");
  });

  it("hides when the room has a single screen", () => {
    navigationState.pathname = "/admin";
    const { container } = render(<AdminNavInline />);
    expect(container).toBeEmptyDOMElement();
  });
});
