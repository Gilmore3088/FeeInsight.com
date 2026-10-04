import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("Stripe webhook grace-window bookkeeping", () => {
  it("records the first failure time and never resets an existing one", () => {
    expect(source).toMatch(/subscription_status = 'past_due',\s+past_due_since = COALESCE\(past_due_since, NOW\(\)\)/);
  });

  it("clears the grace start when a subscription becomes active or is canceled", () => {
    expect(source).toMatch(/subscription_status = 'active',\s+past_due_since = NULL/);
    expect(source).toMatch(/WHEN \$\{status\} = 'past_due' THEN COALESCE\(past_due_since, NOW\(\)\)\s+ELSE NULL/);
    expect(source).toMatch(/subscription_status = 'canceled', past_due_since = NULL/);
  });
});
