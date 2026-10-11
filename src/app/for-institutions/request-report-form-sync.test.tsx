import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The form reads `?report=` through useSearchParams; this stands in for the App Router's URL.
let currentQuery = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentQuery),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/for-institutions",
}));

import { RequestReportForm, reportTypeFromParams } from "./request-report-form";

function checkedReport(): string | null {
  const checked = screen.getAllByRole("radio").find((radio) => (radio as HTMLInputElement).checked);
  return checked ? (checked as HTMLInputElement).value : null;
}

describe("reportTypeFromParams", () => {
  it("takes the report a link names, over the institution it names", () => {
    expect(reportTypeFromParams(new URLSearchParams("report=national&name=First+Bank"))).toBe("national");
    expect(reportTypeFromParams(new URLSearchParams("report=institution"))).toBe("institution");
    expect(reportTypeFromParams(new URLSearchParams("name=First+Bank"))).toBe("institution");
    expect(reportTypeFromParams(new URLSearchParams(""))).toBe("national");
    expect(reportTypeFromParams(new URLSearchParams("report=bogus"))).toBe("national");
  });
});

describe("RequestReportForm report selection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ email: null }), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    currentQuery = "";
  });

  it("switches an already-mounted form from the institution report to the national one when ?report= changes", async () => {
    currentQuery = "report=institution";
    const { rerender } = render(<RequestReportForm contactEmail="hello@example.com" />);
    await waitFor(() => expect(checkedReport()).toBe("institution"));

    // A free CTA is a client-side navigation to ?report=national on the same page.
    currentQuery = "report=national";
    await act(async () => {
      rerender(<RequestReportForm contactEmail="hello@example.com" />);
    });
    await waitFor(() => expect(checkedReport()).toBe("national"));

    // And a paid CTA after it switches back.
    currentQuery = "report=institution";
    await act(async () => {
      rerender(<RequestReportForm contactEmail="hello@example.com" />);
    });
    await waitFor(() => expect(checkedReport()).toBe("institution"));
  });

  it("writes a hand-picked report into the URL so a later CTA naming the other one changes it", async () => {
    window.history.replaceState(null, "", "/for-institutions?report=national");
    currentQuery = "report=national";
    render(<RequestReportForm contactEmail="hello@example.com" />);
    await waitFor(() => expect(checkedReport()).toBe("national"));

    const institution = screen.getAllByRole("radio").find((radio) => (radio as HTMLInputElement).value === "institution")!;
    await act(async () => {
      institution.click();
    });
    expect(checkedReport()).toBe("institution");
    expect(new URL(window.location.href).searchParams.get("report")).toBe("institution");
  });
});
