import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuth: (permission: string) => mocks.requireAuth(permission),
  hasPermission: (user: { role: string }, permission: string) => permission !== "edit" || user.role === "admin",
}));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/fee-correction-audit", () => ({ listFeeAuditEntries: mocks.list }));
vi.mock("./retry-refresh-button", () => ({ RetryRefreshButton: ({ runId }: { runId: number }) => <button>Retry refresh {runId}</button> }));

import FeeCorrectionsAuditPage from "./page";

// H03-T10 (#978): the audit view needs `operate`; a refresh retry is offered only with `edit` and
// only where the status shows a failure. Earlier versions stay listed.

const failedRefresh = {
  needsRetry: true,
  surfaces: [
    { surface: "fee_list", label: "Live fee list", state: "reached", detail: "The fee list shows this value." },
    { surface: "national_index", label: "National index", state: "failed", detail: "The rebuild failed." },
  ],
};
const entry = (over: Record<string, unknown>) => ({
  key: "correction:1", action: "correct", at: "2026-10-16T12:00:00.000Z", institutionId: 7, institutionName: "First Example Bank",
  feeName: "Stop Payment Fee", before: { canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amount: 25, frequency: null, conditions: null },
  after: { canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amount: 35, frequency: null, conditions: null },
  reason: "Amount read from the wrong row", actorName: "James", sourceDocumentId: 900, sourceExcerpt: "Stop Payment Fee | $35.00",
  sourceLocation: "Page 1, row 2", runId: 41, previousFeePublishedId: 500, feePublishedId: 501, version: 1,
  publication: "Superseded by a later version", refresh: failedRefresh, savedOutputs: { analyses: 2, reports: 0, briefings: 0 },
  ...over,
});

async function render(role: string, search: Record<string, string> = {}) {
  mocks.requireAuth.mockResolvedValue({ id: 1, role });
  return renderToStaticMarkup(await FeeCorrectionsAuditPage({ searchParams: Promise.resolve(search) }));
}

describe("fee corrections audit page", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    mocks.list.mockReset().mockResolvedValue([
      entry({ key: "correction:2", action: "reverse", version: 2, publication: "Current version, live", refresh: { needsRetry: false, surfaces: [] } }),
      entry({}),
    ]);
  });

  it("requires_operator_access_and_shows_who_what_why_evidence_and_status", async () => {
    const html = await render("analyst");
    expect(mocks.requireAuth).toHaveBeenCalledWith("operate");
    expect(html).toContain("Reversal");
    expect(html).toContain("Superseded by a later version");
    expect(html).toContain("Amount read from the wrong row");
    expect(html).toContain("Stop Payment Fee | $35.00");
    expect(html).toContain("run #41");
    expect(html).toContain("2 saved answers");
    expect(html).toContain('href="/admin/institution/7"');
    expect(html).not.toContain("Retry refresh");
  });

  it("should_offer_a_retry_to_an_admin_only_where_the_refresh_failed", async () => {
    const html = await render("admin");
    expect(html.match(/Retry refresh/g)).toHaveLength(1);
    expect(html).toContain("Retry refresh 41");
  });

  it("should_pass_a_valid_institution_filter_and_ignore_a_bad_one", async () => {
    await render("analyst", { institution: "7" });
    expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), { institutionId: 7 });
    await render("analyst", { institution: "x" });
    expect(mocks.list).toHaveBeenLastCalledWith(expect.anything(), { institutionId: null });
  });

  it("should_say_so_when_the_history_cannot_be_read", async () => {
    mocks.list.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await render("analyst")).toContain("could not be read");
  });
});
