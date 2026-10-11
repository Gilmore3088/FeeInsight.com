// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as publicApi from "./index";
import * as primitives from "./primitives";
import { renderMonthlyPulseReport } from "./templates/monthly-pulse";

describe("report-template dependency boundary", () => {
  it("preserves every public rendering primitive by identity", () => {
    for (const [name, value] of Object.entries(primitives)) {
      expect(publicApi[name as keyof typeof publicApi], name).toBe(value);
    }
    expect(publicApi.renderMonthlyPulseReport).toBe(renderMonthlyPulseReport);
  });

  it("keeps template implementations below the public export barrel", () => {
    const directory = resolve(__dirname, "templates");
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.includes(".test."))) {
      const source = readFileSync(resolve(directory, file), "utf8");
      expect(source, file).not.toMatch(/(?:from\s*|import\s*\()["'](?:\.\.(?:\/index)?|@\/lib\/report-templates(?:\/index)?)["']/);
    }
    expect(readFileSync(resolve(__dirname, "primitives.ts"), "utf8")).not.toMatch(/from\s*["']\.\/templates\//);
  });
});
