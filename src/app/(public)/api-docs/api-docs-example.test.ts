import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO } from "./api-docs-example";

const page = readFileSync(join(process.cwd(), "src/app/(public)/api-docs/page.tsx"), "utf8");

describe("API docs worked example (#1953)", () => {
  it("names only the demo cast, never another real bank", () => {
    expect(DEMO.name).toBe("Capital City Bank");
    expect(page).not.toMatch(/Gateway Bank|Mendota Heights|2466|Frost/);
  });

  it("labels every example response as illustrative, not live data", () => {
    expect(page).toContain("Example response · illustrative values, not live data");
  });
});
