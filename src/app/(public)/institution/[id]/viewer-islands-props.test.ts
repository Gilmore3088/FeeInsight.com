import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The cached profile is a server component and the viewer islands are client components.
// React cannot send a function across that boundary, so a function prop renders the error page.
describe("profile-page props to viewer islands", () => {
  it("passes no inline function as a JSX prop", () => {
    const source = readFileSync(join(__dirname, "profile-page.tsx"), "utf8");
    expect(source).not.toMatch(/=\{\s*(async\s*)?\([^)]*\)\s*=>/);
  });
});
