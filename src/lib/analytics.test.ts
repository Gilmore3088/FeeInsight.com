import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";
import { PLAUSIBLE_QUEUE_SHIM, trackEvent } from "./analytics";

const trackMock = track as unknown as ReturnType<typeof vi.fn>;

describe("trackEvent", () => {
  afterEach(() => {
    delete (window as Window & { plausible?: unknown }).plausible;
    trackMock.mockReset();
  });

  it("sends every event to Vercel Analytics, with or without Plausible", () => {
    trackEvent("request_report_click", { placement: "pricing_report" });
    expect(trackMock).toHaveBeenCalledWith("request_report_click", { placement: "pricing_report" });
  });

  it("still reaches Plausible when Vercel Analytics throws", () => {
    trackMock.mockImplementation(() => {
      throw new Error("blocked");
    });
    const plausible = vi.fn();
    window.plausible = plausible;
    trackEvent("create_account");
    expect(plausible).toHaveBeenCalledWith("create_account", undefined);
  });

  it("is a no-op when Plausible is not loaded", () => {
    expect(() => trackEvent("create_account")).not.toThrow();
  });

  it("forwards the event and props to Plausible when present", () => {
    const plausible = vi.fn();
    window.plausible = plausible;
    trackEvent("request_report", { plan: "report" });
    expect(plausible).toHaveBeenCalledWith("request_report", { props: { plan: "report" } });
  });

  it("queues events through the inline shim before the script loads", () => {
    // Same code the root layout injects when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set.
    new Function(PLAUSIBLE_QUEUE_SHIM)();
    expect(typeof window.plausible).toBe("function");

    trackEvent("request_report", { src: "profile" });
    trackEvent("newsletter_signup");

    const queue = window.plausible?.q ?? [];
    expect(queue).toHaveLength(2);
    expect(Array.from(queue[0] as ArrayLike<unknown>)).toEqual([
      "request_report",
      { props: { src: "profile" } },
    ]);
    expect(Array.from(queue[1] as ArrayLike<unknown>)).toEqual(["newsletter_signup", undefined]);
  });

  it("does not replace a real Plausible function with the shim", () => {
    const plausible = vi.fn();
    window.plausible = plausible;
    new Function(PLAUSIBLE_QUEUE_SHIM)();
    trackEvent("checkout_start");
    expect(plausible).toHaveBeenCalledWith("checkout_start", undefined);
  });

  it("swallows Plausible errors", () => {
    window.plausible = () => {
      throw new Error("boom");
    };
    expect(() => trackEvent("newsletter_signup")).not.toThrow();
  });
});
