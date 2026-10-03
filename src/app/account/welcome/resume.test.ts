import { describe, expect, it } from "vitest";
import { shouldResumeAfterCheckout } from "./resume";

describe("shouldResumeAfterCheckout", () => {
  it.each([
    ["/pro/reports?instId=2945", true],
    ["/workspace-invite", true],
    ["/institution/3", true],
    ["/account", true],
    ["/account/welcome", false],
    ["/account/welcome?success=true", false],
    [null, false],
    ["https://evil.example", false],
  ])("%s -> %s", (destination, expected) => {
    expect(shouldResumeAfterCheckout(destination as string | null)).toBe(expected);
  });
});
