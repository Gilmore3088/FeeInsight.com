// @vitest-environment node
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";

/**
 * Production ships only the files `outputFileTracingIncludes` lists for the agent routes,
 * while tests see all of node_modules. On 2026-10-05 the list held only the `*lstm*` core
 * builds, tesseract.js asked for `tesseract-core-relaxedsimd`, and every scanned PDF failed
 * in production while the e2e test passed. This checks every core build tesseract.js can
 * require against the list.
 */
describe("OCR files shipped with the agent routes", () => {
  const root = path.resolve(__dirname, "../../../..");
  const includes = nextConfig.outputFileTracingIncludes?.["/api/admin/**"] ?? [];

  it("include every tesseract core build getCore can require", () => {
    const getCore = readFileSync(
      path.join(root, "node_modules/tesseract.js/src/worker-script/node/getCore.js"),
      "utf8",
    );
    const required = [...getCore.matchAll(/require\('tesseract\.js-core\/([^']+)'\)/g)].map((match) => match[1]);
    expect(required.length).toBeGreaterThan(0);
    for (const name of required) {
      const file = `./node_modules/tesseract.js-core/${name}.js`;
      const shipped = includes.some((pattern) => path.matchesGlob(file, pattern));
      expect(shipped, `${file} is not in outputFileTracingIncludes`).toBe(true);
    }
  });

  it("include the English model", () => {
    expect(includes).toContain("./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**");
  });
});
