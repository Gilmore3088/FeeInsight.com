// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MethodRow } from "@/lib/data-store/method-scorecard";

const { loadScorecard, requireAuth } = vi.hoisted(() => ({ loadScorecard: vi.fn(), requireAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/app/admin/room-hub", () => ({ Unreadable: ({ what }: { what: string }) => <p>{what} could not be read.</p> }));
vi.mock("@/lib/data-store/method-scorecard", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/data-store/method-scorecard")>(),
  getMethodScorecard: loadScorecard,
}));

import LearningPage from "../learning/page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function method(row: Partial<MethodRow>): MethodRow {
  return { stage: "read", strategy: "read.pdf_text", version: 3, attempts: 0, ok: 0, nothing: 0, held: 0, nextStep: 0, failed: 0, outcomes: {}, costUsd: 0, score: null, ...row };
}

describe("Learning reporting", () => {
  it("shows held inputs and document-access failures with exact outcomes instead of implying broken verification or readers", async () => {
    loadScorecard.mockResolvedValue({ readAt: "2026-10-09T15:00:00Z", rows: [
      method({ stage: "publish", strategy: "publish.guard_requeue", version: 1, attempts: 1859, ok: 19, held: 1840, outcomes: { ok: 19, rejected: 1840 } }),
      method({ strategy: "read.html", version: 1, attempts: 27, failed: 27, outcomes: { http_403: 20, http_404: 7 } }),
      method({ strategy: "read.pdf_text", attempts: 10, ok: 2, nextStep: 8, outcomes: { ok: 2, scanned_pdf: 8 } }),
      method({ strategy: "read.table_rows", version: 2, attempts: 100, ok: 100, outcomes: { ok: 100 } }),
    ] });
    render(await LearningPage());
    expect(requireAuth).toHaveBeenCalledWith("view");
    const guard = screen.getByText("Guard requeue").closest("li")!;
    expect(within(guard).getByText("held / flagged", { exact: false })).toBeTruthy();
    expect(within(guard).getByText("Rejected by checks: 1,840")).toBeTruthy();
    expect(guard.textContent).not.toContain("failed");
    expect(screen.getByText("HTML document access")).toBeTruthy();
    expect(screen.getByText("Access denied (401 / 403): 20")).toBeTruthy();
    expect(screen.getByText("Scanned PDF (needs OCR): 8")).toBeTruthy();
    expect(screen.getByText(/documents with no rows do not log this method/)).toBeTruthy();
    expect(screen.getByText(/changed content or a new version can be tried again/)).toBeTruthy();
    expect(screen.getByText(/Temporary network and website errors can be retried/)).toBeTruthy();
  });

  it("reports verdict accuracy and the batch bar separately, including holdout results and small costs", async () => {
    loadScorecard.mockResolvedValue({ readAt: "2026-10-09T15:00:00Z", rows: [
      method({ stage: "verify", strategy: "verify.verdict_score", version: 1, attempts: 14, held: 14, outcomes: { evidence_mismatch: 14 },
        score: { correct: 173, decided: 240, holdoutCorrect: 34, holdoutDecided: 50, chunks: 14, passedChunks: 0 } }),
      method({ stage: "verify", strategy: "verify.release_review", version: 17, attempts: 802, ok: 233, held: 569, costUsd: 0.63, outcomes: { ok: 233, rejected: 569 } }),
    ] });
    render(await LearningPage());
    const score = screen.getByText("Verdict score").closest("li")!;
    expect(within(score).getByText("72% correct")).toBeTruthy();
    expect(within(score).getByText("173 of 240 decided verdicts")).toBeTruthy();
    expect(within(score).getByText("95% bar: 0 of 14 scored batches passed")).toBeTruthy();
    expect(within(score).getByText("Holdout: 68% correct (34 of 50)")).toBeTruthy();
    expect(within(score).getByText("Below 95% accuracy bar: 14")).toBeTruthy();
    expect(score.textContent).not.toContain("failed");
    expect(screen.getByText(/\$0.63 spent · <\$0.01 per result \/ passed check/)).toBeTruthy();
  });
});
