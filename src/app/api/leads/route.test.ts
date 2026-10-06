import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn(),
}));

vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));

vi.mock("@/lib/api-hardening/rate-limit", () => ({
  isRateLimited: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@/lib/email/report-request", () => ({
  sendReportRequestNotifications: vi.fn(),
  sendContactRequestNotifications: vi.fn(),
}));

vi.mock("@/lib/email/benchmark-report", () => ({
  sendBenchmarkReportNotifications: vi.fn(),
}));

vi.mock("@/lib/custom-report/quote-check", () => ({
  checkInstitutionReport: vi.fn(() => Promise.resolve({ status: "unmatched", reason: "No match." })),
  describeQuoteCheck: vi.fn(() => "Report check: No match."),
}));

vi.mock("@/lib/email/lead-capture", () => ({
  sendLeadCaptureNotifications: vi.fn(),
}));

vi.mock("@/lib/email/resend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/resend")>()),
  sendResendEmail: vi.fn(() => Promise.resolve({ status: "sent", providerId: "alert_1" })),
}));

import { sql } from "@/lib/data-store/connection";
import { sendLeadCaptureNotifications } from "@/lib/email/lead-capture";
import { sendBenchmarkReportNotifications } from "@/lib/email/benchmark-report";
import {
  sendContactRequestNotifications,
  sendReportRequestNotifications,
} from "@/lib/email/report-request";
import { POST } from "./route";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const reportNotifyMock = sendReportRequestNotifications as unknown as ReturnType<typeof vi.fn>;
const contactNotifyMock = sendContactRequestNotifications as unknown as ReturnType<typeof vi.fn>;
const captureNotifyMock = sendLeadCaptureNotifications as unknown as ReturnType<typeof vi.fn>;
const benchmarkNotifyMock = sendBenchmarkReportNotifications as unknown as ReturnType<typeof vi.fn>;
const SENT = { status: "sent", providerId: "em_1" };

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Reassemble a tagged-template call into readable SQL with its bound values. */
function issued(callIndex: number): { text: string; values: unknown[] } {
  const [strings, ...values] = sqlMock.mock.calls[callIndex] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join("?").replace(/\s+/g, " "), values };
}

describe("POST /api/leads", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    reportNotifyMock.mockReset();
    contactNotifyMock.mockReset();
    reportNotifyMock.mockResolvedValue({ notification: SENT, confirmation: SENT });
    contactNotifyMock.mockResolvedValue({ notification: SENT, confirmation: SENT });
    captureNotifyMock.mockReset();
    captureNotifyMock.mockResolvedValue({ notification: SENT, confirmation: SENT });
    benchmarkNotifyMock.mockReset();
    benchmarkNotifyMock.mockResolvedValue({ notification: SENT, confirmation: SENT });
  });

  describe("free benchmark reports", () => {
    it("sends the district report link from an email alone", async () => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 50 }]);
      const res = await post({ email: "vp@bank.example", source: "report_district", district: "12", src: "for-institutions" });
      expect(res.status).toBe(200);
      const insert = issued(1);
      expect(insert.text).toContain("INSERT INTO leads");
      expect(insert.values[4]).toBe("benchmark-report; scope=district-12; src=for-institutions");
      expect(benchmarkNotifyMock).toHaveBeenCalledWith({
        email: "vp@bank.example",
        scope: { kind: "district", district: 12 },
        src: "for-institutions",
      });
      expect(reportNotifyMock).not.toHaveBeenCalled();
    });

    it("sends the national report with no district", async () => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 51 }]);
      await post({ email: "vp@bank.example", source: "report_national" });
      expect(benchmarkNotifyMock).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: "national" } }));
    });

    it("rejects a district report without a real district", async () => {
      const res = await post({ email: "vp@bank.example", source: "report_district", district: "13" });
      expect(res.status).toBe(400);
      expect(sqlMock).not.toHaveBeenCalled();
      expect(benchmarkNotifyMock).not.toHaveBeenCalled();
    });

    it("folds a returning lead's free report into their row instead of a new request", async () => {
      sqlMock.mockResolvedValueOnce([{ id: 15 }]).mockResolvedValue([]);
      await post({ email: "vp@bank.example", source: "report_national" });
      expect(issued(1).text).toContain("UPDATE leads SET");
      expect(issued(2).text).toContain("UPDATE leads SET use_case = use_case || '; ' || ?");
    });
  });

  it("inserts a new lead with its source", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await post({ name: "Newsletter signup", email: "a@b.co", source: "newsletter" });
    expect(res.status).toBe(200);
    const insert = issued(1);
    expect(insert.text).toContain("INSERT INTO leads");
    expect(insert.values).toEqual(["Newsletter signup", "a@b.co", null, null, null, "newsletter"]);
  });

  it("does not overwrite an existing qualified lead on newsletter signup", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
    const res = await post({ name: "Newsletter signup", email: "cmo@bank.com", source: "newsletter" });
    expect(res.status).toBe(200);

    const update = issued(1);
    expect(update.text).toContain("UPDATE leads SET");
    // Newsletter placeholder never becomes the name candidate.
    expect(update.text).toContain("WHEN name IS NULL OR name = '' OR name = ?");
    expect(update.text).toContain("THEN COALESCE(?, name) ELSE name END");
    expect(update.values[0]).toBe("Newsletter signup");
    expect(update.values[1]).toBeNull();
    // Company/role/use_case only fill NULLs.
    expect(update.text).toContain("company = COALESCE(company, ?)");
    expect(update.text).toContain("role = COALESCE(role, ?)");
    expect(update.text).toContain("use_case = COALESCE(use_case, ?)");
    expect(update.text).not.toMatch(/SET name = \?/);
    expect(update.text).not.toContain("company = ?,");
    // Source is appended, not replaced; status only set when NULL.
    expect(update.text).toContain("ELSE source || ',' || ?");
    expect(update.text).toContain("status = COALESCE(status, ?)");
    expect(update.text).not.toContain("status = 'updated'");
    expect(update.values).toContain("newsletter");
    expect(update.text).toContain("WHERE id = ?");
    expect(update.values[update.values.length - 1]).toBe(7);
  });

  it("never folds a signup into a request row for the same email", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 9, source: "report" }])
      .mockResolvedValueOnce([{ id: 10 }]);
    await post({ email: "cmo@bank.com", source: "capture_national_index" });
    const insert = issued(1);
    expect(insert.text).toContain("INSERT INTO leads");
    const texts = sqlMock.mock.calls.map((_, i) => issued(i).text);
    expect(texts.some((text) => text.startsWith("UPDATE leads"))).toBe(false);
  });

  it("updates only the newest signup row, skipping request rows", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 9, source: "report" }, { id: 7, source: "newsletter" }])
      .mockResolvedValueOnce([]);
    await post({ email: "cmo@bank.com", source: "capture_homepage" });
    const update = issued(1);
    expect(update.text).toContain("UPDATE leads SET");
    expect(update.text).toContain("WHERE id = ?");
    expect(update.values[update.values.length - 1]).toBe(7);
  });

  it("uses a real name as the fill candidate for a placeholder-only lead", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 3 }]).mockResolvedValueOnce([]);
    await post({ name: "Dana Lee", email: "dana@cu.org", company: "Example CU", source: "capture_homepage" });
    const update = issued(1);
    expect(update.values[1]).toBe("Dana Lee");
    expect(update.values).toContain("Example CU");
    expect(update.values).toContain("capture_homepage");
  });

  it("stores a report request from a known email as its own new row", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 15 }]).mockResolvedValueOnce([{ id: 42 }]);
    await post({ name: "James", email: "JLGilmore2@gmail.com", company: "First National Bank Alaska", source: "report" });
    const insert = issued(1);
    expect(insert.text).toContain("INSERT INTO leads");
    expect(insert.text).toContain("RETURNING id");
    expect(insert.values).toContain("First National Bank Alaska");
    const texts = sqlMock.mock.calls.map((_, i) => issued(i).text);
    expect(texts.some((text) => text.includes("UPDATE leads") && text.includes("lower(email)"))).toBe(false);
  });

  it("records the report data check on the new row and in James's email only", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 42 }]).mockResolvedValueOnce([]);
    reportNotifyMock.mockResolvedValueOnce(SENT);
    await post({ name: "Dana Lee", email: "dana@cu.org", company: "Example CU", source: "report" });
    const update = issued(2);
    expect(update.text).toContain("UPDATE leads SET use_case");
    expect(update.text).toContain("WHERE id = ?");
    expect(update.values).toContain("Report check: No match.");
    expect(update.values).toContain(42);
    expect(reportNotifyMock).toHaveBeenCalledWith(expect.objectContaining({ quoteCheck: "Report check: No match." }));
  });

  it("records the report data check when the driver returns the bigint id as a string", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "18" }]).mockResolvedValueOnce([]);
    reportNotifyMock.mockResolvedValueOnce(SENT);
    await post({ name: "Dana Lee", email: "dana@cu.org", company: "Example CU", source: "report" });
    const update = issued(2);
    expect(update.text).toContain("UPDATE leads SET use_case");
    expect(update.values).toContain("Report check: No match.");
    expect(update.values).toContain(18);
  });

  it("sends the footer newsletter signup the monthly-index confirmation", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await post({ name: "Newsletter signup", email: "a@b.co", source: "newsletter" });
    expect(await res.json()).toEqual({
      success: true,
      notifications: { notification: "sent", confirmation: "sent" },
    });
    expect(captureNotifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.co", placement: "national_index" }),
    );
    expect(reportNotifyMock).not.toHaveBeenCalled();
    expect(contactNotifyMock).not.toHaveBeenCalled();
  });

  it("matches an existing lead case-insensitively", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
    await post({ email: "JLGilmore2@Gmail.com", source: "capture_homepage" });
    expect(issued(0).text).toContain("WHERE lower(email) = lower(?)");
    expect(issued(1).text).toContain("UPDATE leads SET");
    expect(issued(1).text).toContain("WHERE id = ?");
  });

  it("stores institution_id and src on use_case and notifies for report requests", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await post({
      name: "Dana Lee",
      email: "dana@cu.org",
      company: "Example CU",
      role: "VP Retail",
      use_case: "competitive-fee-position-report",
      source: "report",
      institutionId: 4802,
      src: "profile",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      notifications: { notification: "sent", confirmation: "sent" },
    });

    const insert = issued(1);
    expect(insert.values).toEqual([
      "Dana Lee",
      "dana@cu.org",
      "Example CU",
      "VP Retail",
      "competitive-fee-position-report; institution_id=4802; src=profile",
      "report",
    ]);
    expect(reportNotifyMock).toHaveBeenCalledWith({
      name: "Dana Lee",
      email: "dana@cu.org",
      institution: "Example CU",
      role: "VP Retail",
      institutionId: 4802,
      src: "profile",
      quoteCheck: "Report check: No match.",
    });
  });

  it("drops malformed institutionId/src instead of storing them", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await post({
      name: "Dana Lee",
      email: "dana@cu.org",
      company: "Example CU",
      use_case: "competitive-fee-position-report",
      source: "report",
      institutionId: "4802; DROP TABLE leads",
      src: "bad src!",
    });
    expect(issued(1).values[4]).toBe("competitive-fee-position-report");
    expect(reportNotifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ institutionId: null, src: null }),
    );
  });

  it("stores the lead and reports the email status when the notifier is not configured", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const notConfigured = { status: "not_configured", reason: "RESEND_API_KEY is not configured." };
    reportNotifyMock.mockResolvedValue({ notification: notConfigured, confirmation: notConfigured });
    const res = await post({ name: "Dana Lee", email: "dana@cu.org", company: "Example CU", source: "report" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      notifications: { notification: "not_configured", confirmation: "not_configured" },
    });
    expect(issued(1).text).toContain("INSERT INTO leads");
  });

  it("logs why a lead email was not delivered, without failing the request", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const notConfigured = { status: "not_configured", reason: "RESEND_API_KEY is not configured." };
    captureNotifyMock.mockResolvedValue({ notification: notConfigured, confirmation: notConfigured });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await post({ email: "vp@bank.example", source: "capture_homepage" });
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith("[api/leads] lead email not delivered", {
      source: "capture_homepage",
      notification: "RESEND_API_KEY is not configured.",
      confirmation: "RESEND_API_KEY is not configured.",
    });
    warnSpy.mockRestore();
  });

  it("still returns success when the notifier throws unexpectedly", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    reportNotifyMock.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await post({ name: "Dana Lee", email: "dana@cu.org", company: "Example CU", source: "report" });
    errorSpy.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      notifications: { notification: "failed", confirmation: "failed" },
    });
  });

  it("notifies for contact-form submissions with the inquiry type and message", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await post({
      name: "Sam Ortiz",
      email: "sam@bank.example",
      company: "First Example Bank",
      role: "CFO",
      use_case: "Can we license the dataset?",
      source: "contact_enterprise",
    });
    expect(contactNotifyMock).toHaveBeenCalledWith({
      name: "Sam Ortiz",
      email: "sam@bank.example",
      company: "First Example Bank",
      role: "CFO",
      message: "Can we license the dataset?",
      inquiryType: "enterprise",
    });
    expect(reportNotifyMock).not.toHaveBeenCalled();
  });

  it("rejects missing name or invalid email", async () => {
    expect((await post({ email: "a@b.co" })).status).toBe(400);
    expect((await post({ name: "x", email: "nope" })).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it("accumulates sources by exact member, so a report request is not hidden by a capture source", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 9 }]).mockResolvedValueOnce([]);
    await post({ name: "Dana Lee", email: "dana@cu.org", company: "Example CU", source: "newsletter" });
    const update = issued(1);
    expect(update.text).toContain("WHEN ? = ANY(string_to_array(source, ',')) THEN source");
    expect(update.text).not.toContain("position(? in source)");
  });

  describe("contextual capture placements", () => {
    const cases = [
      {
        body: { source: "capture_institution", institutionId: 4802, institutionName: "Example CU", state: "tx" },
        useCase: "placement=institution_alerts; institution_id=4802; state=TX",
        placement: "institution_alerts",
      },
      {
        body: { source: "capture_state", state: "OH" },
        useCase: "placement=state_benchmark; state=OH",
        placement: "state_benchmark",
      },
      {
        body: { source: "capture_national_index" },
        useCase: "placement=national_index",
        placement: "national_index",
      },
      {
        body: { source: "capture_report_sample" },
        useCase: "placement=sample_report",
        placement: "sample_report",
      },
      {
        body: { source: "capture_homepage" },
        useCase: "placement=homepage",
        placement: "homepage",
      },
    ];

    it.each(cases)("stores $placement with its source and attribution", async ({ body, useCase, placement }) => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const res = await post({ email: "vp@firstbank.example", ...body });
      expect(res.status).toBe(200);
      const insert = issued(1);
      expect(insert.text).toContain("INSERT INTO leads");
      expect(insert.values).toEqual(["Newsletter signup", "vp@firstbank.example", null, null, useCase, body.source]);
      expect(captureNotifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "vp@firstbank.example", placement }),
      );
      expect(reportNotifyMock).not.toHaveBeenCalled();
    });

    it("passes institution and state context to the capture email", async () => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await post({ email: "vp@firstbank.example", ...cases[0].body });
      expect(captureNotifyMock).toHaveBeenCalledWith({
        email: "vp@firstbank.example",
        placement: "institution_alerts",
        institutionId: 4802,
        institutionName: "Example CU",
        stateCode: "TX",
      });
    });

    it("drops an unknown state code and malformed institution id", async () => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await post({ email: "vp@firstbank.example", source: "capture_state", state: "ZZ", institutionId: "1; DROP" });
      expect(issued(1).values[4]).toBe("placement=state_benchmark");
    });

    it("appends capture attribution for a returning lead without overwriting use_case", async () => {
      sqlMock.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await post({ email: "cmo@bank.com", source: "capture_state", state: "OH" });
      const update = issued(1);
      expect(update.text).toContain("use_case = COALESCE(use_case, ?)");
      expect(update.values).toContain("capture_state");
      const append = issued(2);
      expect(append.text).toContain("UPDATE leads SET use_case = use_case || '; ' || ?");
      expect(append.text).toContain("position(? in use_case) = 0");
      const attribution = "placement=state_benchmark; state=OH";
      expect(append.values).toEqual([attribution, 7, attribution]);
    });

    it("keeps a returning lead's new report request on its own row", async () => {
      sqlMock.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([{ id: 8 }]);
      await post({ name: "Pat", email: "cmo@bank.com", source: "report", company: "First Bank", use_case: "competitive-fee-position-report", institutionId: 4802 });
      const insert = issued(1);
      expect(insert.text).toContain("INSERT INTO leads");
      expect(insert.values[4]).toBe("competitive-fee-position-report; institution_id=4802");
    });

    it("marks the lead email_failed when James's notification fails", async () => {
      reportNotifyMock.mockResolvedValue({ notification: { status: "failed", error: "Resend 500" }, confirmation: SENT });
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 31 }]).mockResolvedValue([]);
      await post({ name: "Pat", email: "cmo@bank.com", source: "report", company: "First Bank" });
      const updates = sqlMock.mock.calls.map((_, i) => issued(i)).filter(({ values }) => values.includes("email_failed"));
      expect(updates).toHaveLength(1);
      // Only this request's row turns red, not earlier requests from the same email.
      expect(updates[0].text).toContain("WHERE id = ?");
      expect(updates[0].values).toEqual(["email_failed", 31]);
    });

    it.each(["capture_report_sample", "capture_homepage"])("accepts a personal email for %s", async (source) => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const res = await post({ email: "someone@gmail.com", source });
      expect(res.status).toBe(200);
      expect(issued(1).values[1]).toBe("someone@gmail.com");
    });

    it("allows personal email on non-magnet placements", async () => {
      sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const res = await post({ email: "someone@gmail.com", source: "capture_national_index" });
      expect(res.status).toBe(200);
    });

    it("rejects an invalid email on a capture placement", async () => {
      const res = await post({ email: "not-an-email", source: "capture_state", state: "OH" });
      expect(res.status).toBe(400);
      expect(sqlMock).not.toHaveBeenCalled();
    });

    it("silently drops honeypot submissions", async () => {
      const res = await post({ email: "bot@spam.example", source: "capture_state", website: "http://spam" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(sqlMock).not.toHaveBeenCalled();
      expect(captureNotifyMock).not.toHaveBeenCalled();
    });
  });
});
