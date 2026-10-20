import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configDefaults } from "vitest/config";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

const root = join(__dirname, "..", "..");

/** Vitest's default include, `**\/*.{test,spec}.?(c|m)[jt]s?(x)`, which vitest.config.ts keeps. */
const COLLECTED = /\.(test|spec)\.(c|m)?[jt]sx?$/;

/** Imports or requires Node's own test runner (`node:test`), which Vitest cannot bundle. */
function importsNodeTest(source: string): boolean {
  return /(from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']node:test["']/.test(source);
}

describe("files Vitest collects (2026-10-09-backlog-node-test-discovery)", () => {
  it("keeps Vitest's default include, which the scan below mirrors", () => {
    expect(configDefaults.include).toEqual(["**/*.{test,spec}.?(c|m)[jt]s?(x)"]);
    // vitest.config.ts sets no include of its own (or one equal to the default).
    const include = (vitestConfig as { test?: { include?: string[] } }).test?.include;
    expect(include ?? configDefaults.include).toEqual(configDefaults.include);
  });

  it("collects no node:test suite: a Node-runner check is named *.node-check.mjs", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((file) => COLLECTED.test(file) && !file.includes("node_modules/") && !file.startsWith(".claude/"));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((file) => importsNodeTest(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("recognises each way a file can load node:test", () => {
    // Built at run time, so this file's own source never names the module in an import.
    const mod = ["node", "test"].join(":");
    expect(importsNodeTest(`import test from "${mod}";`)).toBe(true);
    expect(importsNodeTest(`import { describe } from '${mod}';`)).toBe(true);
    expect(importsNodeTest(`import "${mod}";`)).toBe(true);
    expect(importsNodeTest(`const { it } = require("${mod}");`)).toBe(true);
    expect(importsNodeTest(`await import("${mod}");`)).toBe(true);
    expect(importsNodeTest(`import { it } from "vitest"; // not ${mod}`)).toBe(false);
  });
});
