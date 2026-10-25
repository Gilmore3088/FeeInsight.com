import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));

import { EmergencyStopActiveError } from "@/lib/automation-control";
import { IncompleteProviderResponseError, ProviderResponseBudgetError } from "@/lib/ai-response-budget";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { HAMILTON_READER_DAILY_CAP_MESSAGE, HamiltonTaskBudgetError } from "./task-budget";
import { classifyHamiltonFault, HAMILTON_RETRY_POLICY, MalformedProviderOutputError, runWithHamiltonRetry } from "./task-faults";

const wrapped = (cause: unknown) => new Error("Hamilton section generation failed [type=answer]: x", { cause });

describe("Hamilton task faults (#1921)", () => {
  it("classifies each fault, through the section wrapper's cause", () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(new Error("Overloaded"), { status: 529 }), "provider_error"],
      [Object.assign(new Error("rate limited"), { status: 429 }), "provider_error"],
      [Object.assign(new Error("Connection error."), { name: "APIConnectionError" }), "provider_error"],
      [new ProviderResponseBudgetError("deadline"), "timeout"],
      [new ProviderResponseBudgetError("idle"), "timeout"],
      [Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }), "timeout"],
      [new MalformedProviderOutputError("Hamilton returned empty response for section type 'answer'"), "malformed_output"],
      [new SyntaxError("Unexpected token"), "malformed_output"],
      [new ProviderResponseBudgetError("json_bytes"), "malformed_output"],
      [new IncompleteProviderResponseError("max_tokens"), "incomplete"],
      [Object.assign(new Error("You have reached your specified API usage limits"), { status: 400 }), "provider_paused"],
      [Object.assign(new Error("payment required"), { status: 402 }), "provider_paused"],
      [new HamiltonTaskBudgetError("reader_daily", "costMicrousd", 10, 10, "report"), "budget"],
      [new ProviderBudgetBlockedError("budget_daily_exhausted", "Daily cap route:api.reports.generate"), "budget"],
      [new EmergencyStopActiveError({ enabled: false, reason: null, changedBy: "x", changedAt: "", revision: 1 }, "hamilton"), "stopped"],
      [new ProviderResponseBudgetError("cancelled"), "cancelled"],
      [new Error("something else"), "unknown"],
    ];
    for (const [error, kind] of cases) {
      expect(classifyHamiltonFault(error).kind, String(error)).toBe(kind);
      expect(classifyHamiltonFault(wrapped(error)).kind, `wrapped ${String(error)}`).toBe(kind);
    }
  });

  it("retries only what a retry can fix, and never more than once", () => {
    expect(HAMILTON_RETRY_POLICY).toEqual({
      provider_error: 1, timeout: 1, malformed_output: 1,
      incomplete: 0, provider_paused: 0, budget: 0, stopped: 0, cancelled: 0, unknown: 0,
    });
    for (const retries of Object.values(HAMILTON_RETRY_POLICY)) expect(retries).toBeLessThanOrEqual(1);
  });

  it("gives readers plain messages that name no internal step", () => {
    expect(classifyHamiltonFault(new HamiltonTaskBudgetError("reader_daily", "calls", 1, 1, "ask")).readerMessage).toBe(HAMILTON_READER_DAILY_CAP_MESSAGE);
    expect(classifyHamiltonFault(Object.assign(new Error("usage limit"), { status: 400 })).readerMessage).toBe(HAMILTON_PAUSED_MESSAGE);
    for (const error of [new Error("x"), new ProviderResponseBudgetError("deadline"), new MalformedProviderOutputError("y")]) {
      const message = classifyHamiltonFault(error).readerMessage;
      expect(message).not.toMatch(/Knox|Darwin|Magellan|Rosetta|Atlas|Gutenberg|Hoovie|Deming|\u2014/);
    }
  });

  it("runs a step once on success, twice on a retryable fault, once on a final one", async () => {
    const ok = vi.fn(async () => "done");
    expect(await runWithHamiltonRetry(ok)).toMatchObject({ ok: true, value: "done", attempts: [{ attempt: 1, fault: null }] });

    const flaky = vi.fn().mockRejectedValueOnce(new ProviderResponseBudgetError("deadline")).mockResolvedValueOnce("second");
    expect(await runWithHamiltonRetry(flaky)).toMatchObject({ ok: true, value: "second", attempts: [{ fault: "timeout" }, { fault: null }] });

    const down = vi.fn().mockRejectedValue(Object.assign(new Error("Overloaded"), { status: 529 }));
    const failed = await runWithHamiltonRetry(down);
    expect(failed).toMatchObject({ ok: false, fault: { kind: "provider_error" } });
    expect(down).toHaveBeenCalledTimes(2);

    const capped = vi.fn().mockRejectedValue(new HamiltonTaskBudgetError("task", "calls", 6, 6, "ask"));
    expect(await runWithHamiltonRetry(capped)).toMatchObject({ ok: false, fault: { kind: "budget", retryable: false } });
    expect(capped).toHaveBeenCalledTimes(1);
  });
});
