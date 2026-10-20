import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_LEAD_SOURCE, DemoRequestForm } from "./demo-request-form";

vi.mock("@/lib/marketing-touch", () => ({ readFirstTouch: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Smith" } });
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "jane@bank.com" } });
  fireEvent.change(screen.getByLabelText("Bank or credit union"), { target: { value: "Capital City Bank" } });
}

describe("DemoRequestForm", () => {
  it("posts the same demo lead the /contact demo option does, then confirms a reply", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DemoRequestForm />);
    fill();
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Request a demo" }).closest("form")!);
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/leads");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Jane Smith",
      email: "jane@bank.com",
      company: "Capital City Bank",
      use_case: "Hamilton demo, from /for-institutions",
      source: DEMO_LEAD_SOURCE,
      firstTouch: null,
    });
    expect(DEMO_LEAD_SOURCE).toBe("contact_demo");
    expect(screen.getByText("Request received")).toBeInTheDocument();
  });

  it("keeps the form and says so when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<DemoRequestForm />);
    fill();
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Request a demo" }).closest("form")!);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/didn.t send/);
    expect(screen.getByRole("button", { name: "Request a demo" })).toBeInTheDocument();
  });
});
