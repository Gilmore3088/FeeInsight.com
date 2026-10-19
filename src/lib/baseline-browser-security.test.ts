// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import provenance from "../../vendor/baseline-browser-mapping/provenance.json";

type Library = typeof import("baseline-browser-mapping");
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const cjs = require("baseline-browser-mapping") as Library;
const esm = import(pathToFileURL(join(dirname(require.resolve("baseline-browser-mapping")), "index.js")).href) as Promise<Library>;
const core = ["chrome", "chrome_android", "edge", "firefox", "firefox_android", "safari", "safari_ios"];
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const invalid = [
  { method: "getCompatibleVersions", options: { includeDownstreamBrowsers: false, includeKaiOS: true }, message: /KaiOS/i },
  { method: "getAllVersions", options: { includeDownstreamBrowsers: false, includeKaiOS: true }, message: /KaiOS/i },
  { method: "getCompatibleVersions", options: { targetYear: 2024, widelyAvailableOnDate: "2024-01-01" }, message: /targetYear.*widelyAvailableOnDate/i },
];
const warningModes = invalid.flatMap((input) => [false, true].map((suppressWarnings) => ({
  ...input, options: { ...input.options, suppressWarnings },
})));

beforeAll(() => {
  vi.stubEnv("TZ", provenance.timezone);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(provenance.clock));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each(["cjs", "esm"] as const)("actual baseline-browser-mapping %s export", (mode) => {
  it.each(warningModes)("keeps the process alive after conflicting $method options $options", ({ method, options, message }) => {
    const load = mode === "cjs" ? "require('baseline-browser-mapping')" : "await import('baseline-browser-mapping')";
    const script = `const library=${load}; let error=null;
      try { library[${JSON.stringify(method)}](${JSON.stringify(options)}); }
      catch (caught) { error={name:caught.name,message:caught.message}; }
      const control=library.getCompatibleVersions({targetYear:2020,suppressWarnings:true});
      console.log(JSON.stringify({error,alive:control.some(row=>row.browser==='chrome'&&row.version==='87')}));`;
    const result = spawnSync(process.execPath, [...(mode === "esm" ? ["--input-type=module"] : []), "-e", script], {
      cwd: root, encoding: "utf8", timeout: 5_000, maxBuffer: 128 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout.trim());
    expect(receipt.error).toMatchObject({ name: "Error" });
    expect(receipt.error.message).toMatch(message);
    expect(receipt.alive).toBe(true);
  });

  const library = () => mode === "cjs" ? Promise.resolve(cjs) : esm;
  it("retains the historical 2020 core minimum browser versions", async () => {
    const rows = (await library()).getCompatibleVersions({ targetYear: 2020, suppressWarnings: true });
    expect(Object.fromEntries(rows.map((row) => [row.browser, row.version]))).toEqual({
      chrome: "87", chrome_android: "87", edge: "87", firefox: "83", firefox_android: "83", safari: "14", safari_ios: "14",
    });
    expect(rows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.release_date ?? ""))).toBe(true);
  });

  it("retains ordinary core and downstream browser/engine relationships", async () => {
    const lib = await library();
    const minimum = lib.getCompatibleVersions({ targetYear: 2024, suppressWarnings: true });
    expect(minimum.map((row) => row.browser).sort()).toEqual([...core].sort());
    const expanded = lib.getCompatibleVersions({ targetYear: 2024, includeDownstreamBrowsers: true, includeKaiOS: true, suppressWarnings: true });
    expect(expanded.filter((row) => core.includes(row.browser))).toEqual(minimum);
    const chrome = Number(minimum.find((row) => row.browser === "chrome")!.version);
    const firefox = Number(minimum.find((row) => row.browser === "firefox")!.version);
    const blink = expanded.filter((row) => row.engine === "Blink");
    expect(blink.length).toBeGreaterThan(0);
    expect(blink.every((row) => Number(row.engine_version) >= chrome)).toBe(true);
    expect(expanded.filter((row) => row.engine === "Gecko").every((row) => Number(row.engine_version) >= firefox)).toBe(true);
    expect(expanded.some((row) => row.browser === "opera")).toBe(true);
  });

  it.each(provenance.compatibility.scenarios)("preserves the complete fixed-clock original $name output", async ({ method, options, sha256: expected }) => {
    const lib = await library();
    const output = method === "getCompatibleVersions"
      ? lib.getCompatibleVersions(options as Parameters<Library["getCompatibleVersions"]>[0])
      : lib.getAllVersions(options as Parameters<Library["getAllVersions"]>[0]);
    expect(sha256(JSON.stringify(output))).toBe(expected);
  });

  it("keeps all-version array, object and CSV outputs usable", async () => {
    const lib = await library();
    const options = { includeDownstreamBrowsers: false, suppressWarnings: true };
    const array = lib.getAllVersions({ ...options, outputFormat: "array" });
    const object = lib.getAllVersions({ ...options, outputFormat: "object" });
    const csv = lib.getAllVersions({ ...options, outputFormat: "csv" });
    expect(Array.isArray(array)).toBe(true);
    if (!Array.isArray(array)) throw new Error("Expected browser version array");
    expect(array.length).toBeGreaterThan(100);
    const chrome = array.find((row) => row.browser === "chrome" && row.version === "130");
    expect(chrome).toMatchObject({ browser: "chrome", version: "130" });
    expect(typeof object).toBe("object");
    if (typeof object !== "object" || Array.isArray(object)) throw new Error("Expected browser version object");
    expect(object.chrome["130"]).toMatchObject({ year: chrome!.year, release_date: chrome!.release_date, wa_compatible: chrome!.wa_compatible });
    expect(typeof csv).toBe("string");
    if (typeof csv !== "string") throw new Error("Expected browser version CSV");
    expect(csv.split("\n")[0]).toContain("browser");
    expect(csv).toContain('"chrome","130",');
  });
});

it("installs the reviewed bytes for both real dependency parents without a hook or override", () => {
  const resolved = require.resolve("baseline-browser-mapping");
  for (const parent of ["next", "browserslist"]) {
    expect(createRequire(require.resolve(parent)).resolve("baseline-browser-mapping")).toBe(resolved);
  }
  const directory = join(dirname(resolved), "..");
  expect(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version).toBe(provenance.version);
  for (const file of provenance.changes) {
    const bytes = readFileSync(join(directory, file.file));
    expect(sha256(bytes)).toBe(file.patchedSha256);
    expect(bytes.toString()).not.toContain("process.exit");
  }
  for (const file of provenance.unchangedPackageFiles) {
    expect(sha256(readFileSync(join(directory, file.file)))).toBe(file.sha256);
  }
  const archive = readFileSync(join(root, "vendor/baseline-browser-mapping", provenance.archive.filename));
  expect(sha256(archive)).toBe(provenance.archive.sha256);
  expect(`sha512-${createHash("sha512").update(archive).digest("base64")}`).toBe(provenance.archive.integrity);
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(packageJson.overrides).toBeUndefined();
  expect(packageJson.scripts.postinstall).toBeUndefined();
});

it("preserves the real CLI's ordinary output and nonzero invalid-option policy", () => {
  const cli = join(dirname(require.resolve("baseline-browser-mapping")), "cli.js");
  const run = (options: string[]) => spawnSync(process.execPath, [cli, ...options], {
    cwd: root, encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  const good = run(provenance.compatibility.cli.options);
  expect(good.error).toBeUndefined();
  expect(good.status, good.stderr).toBe(0);
  expect(sha256(good.stdout)).toBe(provenance.compatibility.cli.stdoutSha256);
  const bad = run(["--target-year", "2024", "--widely-available-on-date", "2024-01-01", "--suppress-warnings"]);
  expect(bad.error).toBeUndefined();
  expect(bad.signal).toBeNull();
  expect(bad.status).toBe(1);
});

it("retains the project's resolved production browser targets", () => {
  const { getSupportedBrowsers } = require("next/dist/build/get-supported-browsers") as {
    getSupportedBrowsers: (directory: string, development: boolean) => string[];
  };
  expect(getSupportedBrowsers(root, false)).toEqual(["chrome 111", "edge 111", "firefox 111", "safari 16.4"]);
});
