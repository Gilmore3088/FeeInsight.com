// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("folds less-used screens under More, opened when you are on one", () => {
    navigationState.pathname = "/admin/agents";
    const { unmount } = render(<AdminNav />);
    const closed = screen.getByText("More (7)").closest("details");
    expect(closed).not.toHaveAttribute("open");
    expect(within(closed!).getByRole("link", { name: /Scoreboard/ })).toBeInTheDocument();
    unmount();

    navigationState.pathname = "/admin/states";
    render(<AdminNav />);
    expect(screen.getByText("More (7)").closest("details")).toHaveAttribute("open");
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

  it("keeps less-used screens behind a More chip until you tap it", () => {
    navigationState.pathname = "/admin/agents";
    render(<AdminNavInline />);
    expect(screen.getByRole("link", { name: /Knox/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Lineage/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More (7)" }));
    expect(screen.getByRole("link", { name: /Lineage/ })).toHaveAttribute("href", "/admin/agents/lineage");
    expect(screen.getByRole("button", { name: "Fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("hides when the room has a single screen", () => {
    navigationState.pathname = "/admin";
    const { container } = render(<AdminNavInline />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("room sub-layouts", () => {
  it("add no navigation of their own, so a phone shows one menu", async () => {
    const { default: AgentsLayout } = await import("./agents/layout");
    const { default: HamiltonLayout } = await import("./hamilton/layout");
    navigationState.pathname = "/admin/agents/health";
    const { container } = render(
      <>
        <AgentsLayout><p>agents page</p></AgentsLayout>
        <HamiltonLayout><p>hamilton page</p></HamiltonLayout>
      </>,
    );
    expect(container.querySelectorAll("nav")).toHaveLength(0);
    expect(screen.getByText("agents page")).toBeTruthy();
  });
});
