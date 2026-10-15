// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1271: assembleAndRender's own guard. Its 'assembling' write applies only to an open job;
 * when it does not apply (a cancel came first), it stops before any assembler read or paid
 * Hamilton call.
 */
const m = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; values: unknown[] }>,
  open: true,
}));

vi.mock("@/lib/data-store/connection", () => ({
  getSql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    m.calls.push({ text, values });
    if (text.includes("SET status = 'assembling'")) return m.open ? [{ id: values[0] }] : [];
    return [];
  },
}));
vi.mock("@/lib/hamilton/generate", () => ({ generateSection: vi.fn(), generateGlobalThesis: vi.fn() }));
vi.mock("@/lib/report-assemblers/monthly-pulse", () => ({ assembleMonthlyPulse: vi.fn() }));
vi.mock("@/lib/report-assemblers/national-quarterly", () => ({
  assembleNationalQuarterly: vi.fn(),
  buildThesisSummary: vi.fn(),
}));

import { generateGlobalThesis, generateSection } from "@/lib/hamilton/generate";
import { assembleMonthlyPulse } from "@/lib/report-assemblers/monthly-pulse";
import { assembleNationalQuarterly } from "@/lib/report-assemblers/national-quarterly";
import { assembleAndRender } from "./assemble-and-render";

beforeEach(() => {
  m.calls.length = 0;
  m.open = true;
  vi.mocked(generateSection).mockReset();
  vi.mocked(generateGlobalThesis).mockReset();
  vi.mocked(assembleMonthlyPulse).mockReset();
  vi.mocked(assembleNationalQuarterly).mockReset();
});

describe("assembleAndRender's assembling guard (#1271)", () => {
  it("guards the assembling write by the open statuses", async () => {
    vi.mocked(assembleMonthlyPulse).mockRejectedValue(new Error("stop after the guard"));
    await expect(assembleAndRender("monthly_pulse", {}, "job-1")).rejects.toThrow(/stop after the guard/);
    const write = m.calls.find((call) => call.text.includes("SET status = 'assembling'"));
    expect(write?.text).toMatch(/AND status IN \('pending','assembling','rendering'\) RETURNING id/);
    expect(assembleMonthlyPulse).toHaveBeenCalled();
  });

  it("stops before any assembler read or paid Hamilton call when the job was cancelled first", async () => {
    m.open = false;
    for (const type of ["monthly_pulse", "national_index"] as const) {
      await expect(assembleAndRender(type, {}, "job-2")).rejects.toThrow(
        "Report job job-2 is no longer open, so it was not assembled.",
      );
    }
    expect(assembleMonthlyPulse).not.toHaveBeenCalled();
    expect(assembleNationalQuarterly).not.toHaveBeenCalled();
    expect(generateGlobalThesis).not.toHaveBeenCalled();
    expect(generateSection).not.toHaveBeenCalled();
    // The cancel is left in place: no 'failed' write follows.
    expect(m.calls.some((call) => call.text.includes("status = 'failed'"))).toBe(false);
  });
});
