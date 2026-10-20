// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));

import { loadOwnReportLibrary } from "./account-reports";

type Row = Record<string, unknown> & { user_id: number };

/** A stand-in for the SQL tag that holds rows for several users and filters on the bound user id. */
function fakeDb(tables: { report_jobs: Row[]; hamilton_reports: Row[] }) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    const table = text.includes("FROM report_jobs") ? tables.report_jobs : tables.hamilton_reports;
    return table.filter((row) => row.user_id === values[0]);
  });
  return { db: db as never, calls };
}

const tables = {
  report_jobs: [
    { user_id: 7, id: "job-mine", report_type: "peer_brief", completed_at: "2026-09-01T00:00:00Z" },
    { user_id: 8, id: "job-theirs", report_type: "peer_brief", completed_at: "2026-09-02T00:00:00Z" },
  ],
  hamilton_reports: [
    { user_id: 7, id: "rep-mine", title: "My peer report", report_type: "peer", created_at: "2026-08-01T00:00:00Z" },
    { user_id: 8, id: "rep-theirs", title: "Their report", report_type: "peer", created_at: "2026-08-02T00:00:00Z" },
  ],
};

describe("loadOwnReportLibrary (#1999)", () => {
  it("should_list_cancelled_users_own_jobs_and_saved_reports_with_download_links", async () => {
    const { db } = fakeDb(tables);
    const library = await loadOwnReportLibrary(7, db);
    expect(library.jobs).toEqual([
      {
        id: "job-mine",
        reportType: "peer_brief",
        completedAt: "2026-09-01T00:00:00Z",
        downloadHref: "/api/reports/job-mine/download",
      },
    ]);
    expect(library.saved.map((report) => report.id)).toEqual(["rep-mine"]);
  });

  it("should_never_return_another_users_reports", async () => {
    const { db, calls } = fakeDb(tables);
    const library = await loadOwnReportLibrary(7, db);
    const ids = [...library.jobs, ...library.saved].map((item) => item.id);
    expect(ids).not.toContain("job-theirs");
    expect(ids).not.toContain("rep-theirs");
    for (const call of calls) {
      expect(call.text).toMatch(/WHERE user_id = \?/);
      expect(call.values[0]).toBe(7);
    }
  });

  it("should_only_list_complete_jobs_with_a_stored_file", async () => {
    const { db, calls } = fakeDb(tables);
    await loadOwnReportLibrary(7, db);
    const jobQuery = calls.find((call) => call.text.includes("FROM report_jobs"));
    expect(jobQuery?.text).toContain("status = 'complete'");
    expect(jobQuery?.text).toContain("artifact_key IS NOT NULL");
  });

  it("should_keep_one_list_when_the_other_read_fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes("FROM report_jobs")) throw new Error("db down");
      return [{ user_id: 7, id: "rep-mine", title: "My peer report", report_type: "peer", created_at: null }];
    });
    const library = await loadOwnReportLibrary(7, db as never);
    expect(library.jobs).toEqual([]);
    expect(library.saved.map((report) => report.id)).toEqual(["rep-mine"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
