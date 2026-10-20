import { describe, expect, it } from "vitest";
import { REPORT_REQUEST_HREF, reportRequestHref } from "./report-request-href";
import { reportFormHref } from "@/app/for-institutions/report-form-href";
import { REPORT_REQUEST_PATH } from "@/lib/email/lead-capture";

describe("report request links (#1171)", () => {
  it("open the one form on /reports, on the institution report", () => {
    expect(REPORT_REQUEST_HREF).toBe("/reports?report=institution#request");
    expect(REPORT_REQUEST_PATH).toBe(REPORT_REQUEST_HREF);
    expect(reportRequestHref()).toBe(REPORT_REQUEST_HREF);
  });

  it("carry the context a button has and drop empty values", () => {
    expect(reportRequestHref({ institution: "860", name: "Bank & Trust", src: "profile", empty: "" })).toBe(
      "/reports?report=institution&institution=860&name=Bank+%26+Trust&src=profile#request",
    );
  });

  it("keep a report type the link names", () => {
    expect(reportRequestHref({ report: "national", src: "x" })).toBe("/reports?report=national&src=x#request");
    expect(reportFormHref({ report: "peer", institution: "323" })).toBe(
      "/reports?report=peer&institution=323&src=for-institutions#request",
    );
  });
});
