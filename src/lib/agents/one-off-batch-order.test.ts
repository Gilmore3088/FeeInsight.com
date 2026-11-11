// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));

import { ONE_OFF_PAID_BATCH_SOURCES } from "./run-store";
import { REKEY_SOURCE } from "./deming/answer-key-rekey";
import { SAMPLE_SOURCE } from "./darwin/release-review-sample";
import { SECOND_READER_SOURCE } from "./knox/second-reader";

describe("ONE_OFF_PAID_BATCH_SOURCES", () => {
  it("names each one-off paid batch's own run source, so the tick ranks it ahead of lanes", () => {
    expect([...ONE_OFF_PAID_BATCH_SOURCES].sort()).toEqual([SAMPLE_SOURCE, REKEY_SOURCE, SECOND_READER_SOURCE].sort());
  });
});
