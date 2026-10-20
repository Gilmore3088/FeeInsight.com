import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FreeReportRequest } from "./free-report-request";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));
vi.mock("@/app/for-institutions/request-report-form", () => ({
  RequestReportForm: ({ offer }: { offer: string }) => <form aria-label={`form-${offer}`} />,
}));

describe("FreeReportRequest (/reports)", () => {
  it("stays out of the page unless a link asks for a free report", () => {
    params = new URLSearchParams();
    const { container } = render(<FreeReportRequest contactEmail="x@y.z" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the free form for a national or district link", () => {
    for (const report of ["national", "district"]) {
      params = new URLSearchParams({ report });
      const { unmount } = render(<FreeReportRequest contactEmail="x@y.z" />);
      expect(screen.getByRole("form", { name: "form-free" })).toBeTruthy();
      unmount();
    }
    params = new URLSearchParams({ report: "institution" });
    const { container } = render(<FreeReportRequest contactEmail="x@y.z" />);
    expect(container.innerHTML).toBe("");
  });
});
