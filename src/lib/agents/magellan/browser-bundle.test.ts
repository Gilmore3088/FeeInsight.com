// @vitest-environment node
import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";

/**
 * Production ships only what file tracing finds plus `outputFileTracingIncludes`; tests see all
 * of node_modules. playwright-core loads browsers.json by a computed path tracing cannot follow,
 * so on 2026-10-27..29 all 117 renders failed on prod with "Cannot find module
 * .../playwright-core/browsers.json" while every test passed. This checks the agent routes ship
 * the whole package and Chromium's binary.
 */
describe("browser files shipped with the agent routes", () => {
  const root = path.resolve(__dirname, "../../../..");
  const includes = nextConfig.outputFileTracingIncludes?.["/api/admin/**"] ?? [];
  const shipped = (file: string) => includes.some((pattern) => path.matchesGlob(file, pattern));

  it("include playwright-core's browsers.json, package.json and bundles", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "node_modules/playwright-core/package.json"), "utf8")) as { main?: string };
    for (const file of ["browsers.json", "package.json", pkg.main ?? "index.js", "lib/coreBundle.js", "lib/utilsBundle.js", "lib/serverRegistry.js"]) {
      expect(existsSync(path.join(root, "node_modules/playwright-core", file)), `${file} exists`).toBe(true);
      expect(shipped(`./node_modules/playwright-core/${file.replace(/^\.\//, "")}`), `${file} is not in outputFileTracingIncludes`).toBe(true);
    }
  });

  it("include the slim Chromium binary", () => {
    expect(shipped("./node_modules/@sparticuz/chromium/bin/chromium.br")).toBe(true);
  });
});
