import { afterEach, describe, expect, it, vi } from "vitest";

const trackMock = vi.fn();
vi.mock("@vercel/analytics", () => ({ track: (...args: unknown[]) => trackMock(...args) }));

import { trackEvent } from "./analytics";

describe("trackEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    trackMock.mockReset();
  });

  it("does nothing on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(() => trackEvent("create_account")).not.toThrow();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("sends the event and its props to Vercel Analytics in the browser", () => {
    vi.stubGlobal("window", {});
    trackEvent("request_report", { plan: "report" });
    expect(trackMock).toHaveBeenCalledWith("request_report", { plan: "report" });
  });

  it("never throws when Vercel Analytics does", () => {
    vi.stubGlobal("window", {});
    trackMock.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => trackEvent("checkout_complete")).not.toThrow();
  });
});
