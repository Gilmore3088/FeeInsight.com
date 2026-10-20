import { describe, expect, it } from "vitest";
import { checkoutFailure } from "./checkout-failure";

describe("checkoutFailure", () => {
  it("keeps Stripe's error type, code, status and request id", () => {
    const error = Object.assign(new Error("No such price: 'price_x'"), {
      type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 400, requestId: "req_123",
    });
    expect(checkoutFailure(error)).toEqual({
      name: "Error", type: "StripeInvalidRequestError", code: "resource_missing",
      statusCode: "400", requestId: "req_123", message: "No such price: 'price_x'",
    });
  });

  it("keeps a database error code and caps long messages", () => {
    const error = Object.assign(new Error("x".repeat(500)), { code: "57014" });
    const fields = checkoutFailure(error);
    expect(fields.code).toBe("57014");
    expect(fields.message).toHaveLength(300);
  });

  it("describes a thrown non-object", () => {
    expect(checkoutFailure("boom")).toEqual({ error: "boom" });
  });
});
