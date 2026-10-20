import { describe, expect, it, vi } from "vitest";

import {
  CALL_REPORT_SUMMARY_TRIGGER_SOURCES,
  diffSummaryGroups,
  runRegistryCallReportSummaries,
  type CallReportSummaryGroup,
} from "./call-report-summaries";
import { PRIORITY_REGISTRY_SOURCES } from "@/lib/agents/registry-scheduler";
import { isProviderStep, pauseScopeForStep } from "@/lib/agents/types";
import type { RegistryDb } from "./partitions";

const group = (source: string, reportYear: number, filingCount: number, filingsHash: string): CallReportSummaryGroup =>
  ({ source, reportYear, filingCount, filingsHash });

describe("call-report summary groups", () => {
  it("rebuilds new and changed regulator-years and drops the ones whose filings are gone", () => {
    const filings = [group("fdic", 2025, 10, "1"), group("ncua", 2025, 10, "2"), group("ncua", 2026, 4, "3")];
    const stored = [group("fdic", 2025, 10, "1"), group("ncua", 2025, 10, "9"), group("fdic", 2009, 3, "4")];
    const { changed, removed } = diffSummaryGroups(filings, stored);
    expect(changed.map((g) => `${g.source} ${g.reportYear}`)).toEqual(["ncua 2025", "ncua 2026"]);
    expect(removed.map((g) => `${g.source} ${g.reportYear}`)).toEqual(["fdic 2009"]);
  });

  it("treats a changed count as a change even when the hash collides", () => {
    const { changed } = diffSummaryGroups([group("fdic", 2025, 11, "1")], [group("fdic", 2025, 10, "1")]);
    expect(changed).toHaveLength(1);
  });

  it("reads but writes nothing on a dry run", async () => {
    const unsafe = vi.fn(async (text: string) =>
      text.includes("FROM institution_financial_records")
        ? [{ source: "ncua", report_year: 2026, filing_count: 9000, filings_hash: "5" }]
        : []);
    const tag = vi.fn(async () => []);
    const db = Object.assign(tag, { unsafe, begin: vi.fn() }) as unknown as RegistryDb;
    const result = await runRegistryCallReportSummaries({ db, dryRun: true });
    expect(result).toMatchObject({ dryRun: true, groupsChanged: ["ncua 2026"], filings: 9000, rowsWritten: 0 });
    expect(unsafe.mock.calls.map(([text]) => String(text)).every((text) => /^\s*SELECT/.test(text))).toBe(true);
    expect(tag).not.toHaveBeenCalled();
  });

  it("is a deterministic, pipeline-gated step that runs right after the loads that change filings", () => {
    expect(isProviderStep("registry-call-report-summaries")).toBe(false);
    expect(pauseScopeForStep("registry-call-report-summaries")).toBe("pipeline");
    expect([...CALL_REPORT_SUMMARY_TRIGGER_SOURCES].sort()).toEqual(["fdic-financials", "fdic-universe", "ncua-financials"]);
    expect(PRIORITY_REGISTRY_SOURCES).toContain("call-report-summaries");
  });
});
