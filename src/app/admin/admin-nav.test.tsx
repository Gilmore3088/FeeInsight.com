// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminNav, AdminRoomMenu, AdminRoomScreens, AdminRoomTabs } from "./admin-nav";

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
  it("lists the seven rooms and marks the one you are in", () => {
    render(<AdminRoomTabs badges={{ trustPending: 4 }} />);
    const nav = screen.getByRole("navigation", { name: "Admin rooms" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent?.replace(/\d+/g, ""))).toEqual([
      "Today", "Pipeline", "Your work", "Data", "Hamilton", "Growth", "Settings",
    ]);
    expect(within(nav).getByRole("link", { name: /Pipeline/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Your work/ })).toHaveTextContent("4");
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
    expect(within(closed!).getByRole("link", { name: /Lineage/ })).toBeInTheDocument();
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

describe("AdminRoomMenu", () => {
  it("names the room and opens the list of rooms on a room's own page", () => {
    navigationState.pathname = "/admin/agents";
    render(<AdminRoomMenu badges={{ trustPending: 2 }} />);
    expect(screen.queryByRole("navigation", { name: "Choose a room" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pipeline/ }));
    const list = screen.getByRole("navigation", { name: "Choose a room" });
    expect(within(list).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/admin", "/admin/agents", "/admin/work", "/admin/data", "/admin/customers", "/admin/growth", "/admin/controls",
    ]);
    expect(within(list).getByRole("link", { name: /Pipeline/ })).toHaveAttribute("aria-current", "page");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Choose a room" })).not.toBeInTheDocument();
  });

  it("is the way back to the room on a screen inside it", () => {
    render(<AdminRoomMenu />);
    expect(screen.getByRole("link", { name: /Pipeline/ })).toHaveAttribute("href", "/admin/agents");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("AdminRoomScreens", () => {
  it("lists the room's screens as cards, leaving agents to their own cards", () => {
    navigationState.pathname = "/admin/agents";
    render(<AdminRoomScreens />);
    expect(screen.getByRole("link", { name: /State lanes/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lineage/ })).toHaveAttribute("href", "/admin/agents/lineage");
    expect(screen.queryByRole("link", { name: /^Knox/ })).not.toBeInTheDocument();
  });

  it("shows nothing off a room's landing page", () => {
    const { container } = render(<AdminRoomScreens />);
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
