import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

import { ReportFormLink } from "./report-form-link";
import { reportFormHref } from "./report-form-href";

describe("ReportFormLink", () => {
  it("opens the form on the institution report when the page has no query", () => {
    params = new URLSearchParams();
    render(<ReportFormLink className="x">Request</ReportFormLink>);
    expect(screen.getByRole("link", { name: "Request" }).getAttribute("href")).toBe(
      "/reports?report=institution&src=for-institutions#request",
    );
  });

  it("carries an older link's bank, report type and src through to the form", () => {
    params = new URLSearchParams("institution=323&report=peer&src=email");
    render(<ReportFormLink className="x">Request</ReportFormLink>);
    expect(screen.getByRole("link", { name: "Request" }).getAttribute("href")).toBe(
      reportFormHref({ institution: "323", report: "peer", src: "email" }),
    );
  });
});
