// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepFeeFocus, ProfileFeeFocus, readFeeFocus } from "./fee-focus-scroll";
import { FeeAudienceTabs } from "./fee-audience-tabs";
import { ShowAll } from "./show-all";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const scroll = vi.fn();

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return { length: this.closest("[hidden]") ? 0 : 1 } as DOMRectList;
  });
});

afterEach(() => {
  cleanup();
  scroll.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function schedule() {
  return render(
    <ProfileFeeFocus>
      <ShowAll total={2} shown={1}>
        <FeeAudienceTabs initial="personal" tabs={[
          { key: "personal", label: "Personal", panel: <div data-fee-category="nsf">Personal NSF</div> },
          { key: "business", label: "Business", panel: <div data-fee-category="overdraft">Business overdraft</div> },
        ]} />
      </ShowAll>
    </ProfileFeeFocus>,
  );
}

describe("canonical profile fee focus", () => {
  it("expands the shared schedule, selects a business-only fee, highlights it and scrolls", async () => {
    window.history.replaceState(null, "", "/institution/82?fee=overdraft#fee-overdraft");
    schedule();
    const row = screen.getByText("Business overdraft");
    await waitFor(() => expect(row.id).toBe("fee-overdraft"));
    expect(row.hasAttribute("data-profile-fee-focus")).toBe(true);
    expect(row.closest("[data-all]")?.getAttribute("data-all")).toBe("true");
    expect(screen.getByRole("tab", { name: "Business" }).getAttribute("aria-selected")).toBe("true");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("keeps focus on the schedule without stealing an explicit peer anchor", async () => {
    window.history.replaceState(null, "", "/institution/82?fee=overdraft&peers=state#peers");
    schedule();
    await waitFor(() => expect(screen.getByText("Business overdraft").id).toBe("fee-overdraft"));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does not expand an unknown fee", () => {
    window.history.replaceState(null, "", "/institution/82?fee=unknown");
    schedule();
    expect(screen.getByRole("button", { name: "Show all 2 fees" })).toBeTruthy();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("uses only supported fee categories and retains distinct peer state", () => {
    expect(readFeeFocus("overdraft")).toBe("overdraft");
    expect(readFeeFocus("<script>")).toBeNull();
    expect(keepFeeFocus("/institution/82?peers=state&pview=chart#peers", "overdraft"))
      .toBe("/institution/82?peers=state&pview=chart&fee=overdraft#peers");
    expect(keepFeeFocus("/institution/82?fee=nsf#peers", "overdraft")).toBe("/institution/82?fee=nsf#peers");
  });
});
