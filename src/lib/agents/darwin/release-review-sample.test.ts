// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.hoisted(() => vi.fn());
const review = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
const control = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: start }));
vi.mock("@/lib/automation-control", () => ({ getAutomationControl: async () => ({ enabled: control.enabled }) }));
vi.mock("./release-review", () => ({
  DARWIN_RELEASE_REVIEW_STRATEGY: { strategy: "verify.release_review", version: 17 },
  RELEASE_REVIEW_FEES_PER_CALL: 25,
  runDarwinReleaseReview: review,
}));
vi.mock("./release-held", () => ({ DARWIN_RELEASE_STRATEGY: { strategy: "verify.release", version: 4 } }));

import { PROVIDER_STEP_KEYS } from "@/lib/agents/types";
import {
  SAMPLE_CALLS, SAMPLE_MAX_RUNS, SAMPLE_SOURCE, SAMPLE_STEP_KEY,
  releaseReviewSampleSummary, runReleaseReviewSample, scheduleReleaseReviewSample,
} from "./release-review-sample";

function db(state: { active: boolean; runs: number; left: number }) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("$");
    if (text.includes("status IN")) return state.active ? [{ id: 77 }] : [];
    if (text.includes("AS runs")) return [{ runs: state.runs }];
    if (text.includes("AS left")) return [{ left: state.left }];
    return [];
  }) as never;
}

describe("scheduleReleaseReviewSample", () => {
  beforeEach(() => {
    control.enabled = true;
    start.mockReset();
    start.mockResolvedValue({ reused: false, run: { id: 88 } });
  });

  it("never queues a second run while one is active", async () => {
    expect(await scheduleReleaseReviewSample(db({ active: true, runs: 0, left: 80 }))).toEqual({ scheduled: false, runId: 77, reason: "active" });
    expect(start).not.toHaveBeenCalled();
  });

  it("stops once nothing is left or the run cap is reached, and while the provider stop is on", async () => {
    expect(await scheduleReleaseReviewSample(db({ active: false, runs: 1, left: 0 }))).toMatchObject({ scheduled: false, reason: "done" });
    expect(await scheduleReleaseReviewSample(db({ active: false, runs: SAMPLE_MAX_RUNS, left: 80 }))).toMatchObject({ scheduled: false, reason: "capped" });
    control.enabled = false;
    expect(await scheduleReleaseReviewSample(db({ active: false, runs: 0, left: 80 }))).toMatchObject({ scheduled: false, reason: "provider_stop" });
    expect(start).not.toHaveBeenCalled();
  });

  it("queues one Darwin provider-step run keyed by the ten-minute bucket", async () => {
    const now = new Date("2026-11-01T22:45:00Z");
    expect(await scheduleReleaseReviewSample(db({ active: false, runs: 0, left: 83 }), now)).toEqual({ scheduled: true, runId: 88 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      agent: "darwin",
      params: { source: SAMPLE_SOURCE, batch_id: "2026-11-01" },
      idempotencyKey: `darwin:release-review-sample:2026-11-01:${Math.floor(now.getTime() / 600_000)}`,
      steps: [expect.objectContaining({ key: SAMPLE_STEP_KEY })],
    }));
    expect(PROVIDER_STEP_KEYS).toContain(SAMPLE_STEP_KEY);
  });
});

describe("runReleaseReviewSample", () => {
  it("never releases: the review always runs with acts off and capped calls", async () => {
    review.mockResolvedValue({ dryRun: false, selected: 83, processed: 83, succeeded: 80, failed: 1, costMicrousd: 90_000, calls: 4, passed: 6, released: 0, lessons: 0, results: [], deferred: 2 });
    const result = await runReleaseReviewSample({ runId: 5, stepId: 6 });
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ runId: 5, stepId: 6, calls: SAMPLE_CALLS, acts: false }));
    expect(releaseReviewSampleSummary(result)).toBe("Release-review sample: 6 of 80 reviewed fees passed, 1 failed, 2 deferred, none released; $0.09 over 4 calls.");
  });
});
