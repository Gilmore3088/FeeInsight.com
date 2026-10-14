import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SampleReportForm } from "./sample-report-form";
import { WalkthroughForm } from "./walkthrough-form";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/marketing-touch", () => ({ readFirstTouch: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ok() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
}

describe("homepage walkthrough form", () => {
  it("stores a contact request with name, institution and email, never a newsletter signup", async () => {
    const fetcher = ok();
    vi.stubGlobal("fetch", fetcher);
    render(<WalkthroughForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pat Lee" } });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "First Example Bank" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "pat@example.org" } });
    fireEvent.submit(screen.getByRole("form", { name: "Request a free walkthrough" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Request received.");
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("/api/leads");
    const payload = JSON.parse(request.body);
    expect(payload).toMatchObject({
      source: "contact_walkthrough",
      name: "Pat Lee",
      company: "First Example Bank",
      email: "pat@example.org",
    });
    expect(payload.use_case).toContain("no newsletter opt-in");
  });

  it("keeps the form and shows the server's error when storage fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Please try again" }), { status: 500 })));
    render(<WalkthroughForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pat Lee" } });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "First Example Bank" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "pat@example.org" } });
    fireEvent.submit(screen.getByRole("form", { name: "Request a free walkthrough" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.getByRole("button", { name: "Request a free walkthrough" })).toBeEnabled();
  });
});

describe("homepage sample report form", () => {
  it("reveals the sample PDF only after the server accepts the request", async () => {
    const fetcher = ok();
    vi.stubGlobal("fetch", fetcher);
    render(<SampleReportForm />);
    expect(screen.queryByRole("link", { name: "Download the sample PDF" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "pat@example.org" } });
    fireEvent.submit(screen.getByRole("form", { name: "Download the sample report" }));
    expect(await screen.findByRole("link", { name: "Download the sample PDF" })).toHaveAttribute(
      "href",
      "/reports/competitive-fee-position-sample.pdf",
    );
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.source).toBe("contact_sample");
    expect(payload.email).toBe("pat@example.org");
  });

  it("withholds the download when storage fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Please try again" }), { status: 500 })));
    render(<SampleReportForm />);
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "pat@example.org" } });
    fireEvent.submit(screen.getByRole("form", { name: "Download the sample report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.queryByRole("link", { name: "Download the sample PDF" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download sample report" })).toBeEnabled();
  });
});
