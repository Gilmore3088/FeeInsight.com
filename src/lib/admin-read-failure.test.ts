import { describe, expect, it, vi } from "vitest";
import { errorCode, logReadFailure } from "./admin-read-failure";

describe("errorCode", () => {
  it("prefers a code, then a type, then a non-generic name", () => {
    expect(errorCode({ code: "42703" })).toBe("42703");
    expect(errorCode({ type: "StripeInvalidRequestError" })).toBe("StripeInvalidRequestError");
    expect(errorCode(new TypeError("x"))).toBe("TypeError");
    expect(errorCode(new Error("x"))).toBe("unknown");
    expect(errorCode(null)).toBe("unknown");
  });
});

describe("logReadFailure", () => {
  it("logs the section, code and the same reference it returns", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = logReadFailure("Plan watch list", { code: "resource_missing" });
    expect(failure.code).toBe("resource_missing");
    expect(failure.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(String(spy.mock.calls[0][0])).toContain(failure.ref);
    expect(String(spy.mock.calls[0][0])).toContain("Plan watch list");
    spy.mockRestore();
  });
});
