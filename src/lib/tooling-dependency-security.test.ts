// @vitest-environment node
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
// Load leaves through the actual unchanged consumers, including any nested resolution.
const ajvRequire = createRequire(require.resolve("ajv"));
const uri = ajvRequire("fast-uri") as typeof import("fast-uri");
const eslintRequire = createRequire(require.resolve("eslint"));
const entryRequire = createRequire(eslintRequire.resolve("file-entry-cache"));
const cacheRequire = createRequire(entryRequire.resolve("flat-cache"));
type Flatted = typeof import("flatted");
type Humanfs = typeof import("@humanfs/node");
const flattedCjs = cacheRequire("flatted") as Flatted;
const flattedEsm = import(pathToFileURL(join(dirname(cacheRequire.resolve("flatted/package.json")), "esm/index.js")).href) as Promise<Flatted>;
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "feeinsight-tooling-test.")); roots.push(root); return root;
}
let humanfsModule: Promise<Humanfs> | undefined;
function humanfs(): Promise<Humanfs> {
  if (!humanfsModule) {
    // humanfs has import-only exports. Resolve natively from ESLint's actual helper,
    // rather than using unsupported CJS resolution or a different root installation.
    const parent = pathToFileURL(join(dirname(require.resolve("eslint")), "eslint/eslint-helpers.js")).href;
    const result = spawnSync(process.execPath, ["--experimental-import-meta-resolve", "--input-type=module", "-e",
      `console.log(import.meta.resolve('@humanfs/node',${JSON.stringify(parent)}));`],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    humanfsModule = import(result.stdout.trim());
  }
  return humanfsModule;
}

beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("Unexpected tooling network request"); }); });
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("actual Ajv URI dependency", () => {
  it("normalizes a percent-encoded uppercase host even without a scheme", () => {
    expect(uri.parse("//%41.com").host).toBe("a.com");
    expect(uri.normalize("//%41.com")).toBe(uri.normalize("//a.com"));
    expect(uri.equal("//%41.com", "//a.com")).toBe(true);
  });

  it("retains ordinary URI parse/serialize and reference resolution", () => {
    const address = "https://example.com/a?fee=0#source";
    expect(uri.parse(address)).toMatchObject({ scheme: "https", host: "example.com", path: "/a", query: "fee=0", fragment: "source" });
    expect(uri.serialize(uri.parse(address))).toBe(address);
    expect(uri.resolve("https://example.com/a/b", "../c")).toBe("https://example.com/c");
    expect(uri.normalize("https://[::1]/path")).toBe("https://[::1]/path");
  });
});

describe.each(["cjs", "esm"] as const)("actual cache flatted %s dependency", (mode) => {
  const library = () => mode === "cjs" ? Promise.resolve(flattedCjs) : flattedEsm;
  it("does not return a live inherited array prototype for a non-index reference", async () => {
    const parsed = (await library()).parse('[{"x":"__proto__"}]');
    expect(parsed.x).not.toBe(Array.prototype);
    // No global prototype mutation is needed to demonstrate the old reference leak.
    expect(parsed.x).toBeUndefined();
  });

  it("parses a bounded deep reference chain without recursive stack exhaustion", async () => {
    const text = JSON.stringify(Array.from({ length: 6000 }, (_, index) =>
      index === 5999 ? { value: 0 } : { next: String(index + 1) }));
    let node = (await library()).parse(text), count = 1;
    while (node.next) { node = node.next; count += 1; }
    expect(count).toBe(6000); expect(node.value).toBe(0);
  });

  it("preserves cyclic/shared identity, zero, Unicode, reviver and replacer", async () => {
    const lib = await library(), shared = { fee: 0, text: "fee €" };
    const input: { left: typeof shared; right: typeof shared; self?: unknown } = { left: shared, right: shared }; input.self = input;
    const output = lib.parse(lib.stringify(input));
    expect(output.left).toBe(output.right); expect(output.self).toBe(output); expect(output.left).toEqual(shared);
    expect(lib.parse(lib.stringify({ a: 0, b: 2 }), (key, value) => key === "b" ? value + 1 : value)).toEqual({ a: 0, b: 3 });
    expect(lib.parse(lib.stringify({ a: 0, b: 2 }, (key, value) => key === "b" ? undefined : value))).toEqual({ a: 0 });
  });
});

describe("actual ESLint humanfs dependency", () => {
  async function source() {
    const root = await fixture(); await mkdir(join(root, "src/nested"), { recursive: true });
    await writeFile(join(root, "outside-marker.txt"), "owned synthetic marker");
    await writeFile(join(root, "src/nested/zero.txt"), "zero=0");
    await symlink(join(root, "outside-marker.txt"), join(root, "src/link.txt"));
    return root;
  }
  it("copies a symlink as a link instead of materializing outside file bytes", async () => {
    const root = await source(), hfs = new (await humanfs()).NodeHfs();
    await hfs.copy(join(root, "src/link.txt"), join(root, "single-link.txt"));
    expect((await lstat(join(root, "single-link.txt"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(root, "single-link.txt"))).toBe(join(root, "outside-marker.txt"));
    // Link preservation is not a sandbox: opening the copied link still follows it.
    expect(await readFile(join(root, "single-link.txt"), "utf8")).toBe("owned synthetic marker");
  });

  it("retains symlink identity during recursive copy and keeps ordinary zero-valued content", async () => {
    const root = await source(), hfs = new (await humanfs()).NodeHfs();
    await hfs.copyAll(join(root, "src"), join(root, "dst"));
    expect((await lstat(join(root, "dst/link.txt"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(root, "dst/link.txt"))).toBe(join(root, "outside-marker.txt"));
    expect(await readFile(join(root, "dst/nested/zero.txt"), "utf8")).toBe("zero=0");
  });

  it("keeps normal copy/overwrite, directory detection and walk usable", async () => {
    const root = await source(), hfs = new (await humanfs()).NodeHfs();
    await writeFile(join(root, "regular.txt"), "before");
    await hfs.copy(join(root, "src/nested/zero.txt"), join(root, "regular.txt"));
    expect(await readFile(join(root, "regular.txt"), "utf8")).toBe("zero=0");
    expect(await hfs.isDirectory(join(root, "src"))).toBe(true);
    const paths = []; for await (const entry of hfs.walk(join(root, "src"))) paths.push(entry.path);
    expect(paths).toContain("nested/zero.txt");
  });
});

describe("actual unchanged parent tool APIs", () => {
  it("preserves Ajv reference resolution and numeric zero/type/minimum validation", () => {
    const Ajv = require("ajv") as typeof import("ajv").default;
    const ajv = new Ajv({ strict: true });
    ajv.addSchema({ $id: "https://schema.fixture.invalid/value.json", type: "object", required: ["fee"],
      properties: { fee: { type: "number", minimum: 0 } }, additionalProperties: false });
    const validate = ajv.compile({ $ref: "https://schema.fixture.invalid/value.json" });
    expect(validate({ fee: 0 })).toBe(true); expect(validate({ fee: -1 })).toBe(false);
    expect(validate({ fee: "0" })).toBe(false); expect(validate({ fee: 0, extra: true })).toBe(false);
  });

  it("keeps the actual ESLint cache parent able to persist cycles, shared values and zero", async () => {
    const root = await fixture(); const Cache = entryRequire("flat-cache");
    const cache = Cache.load("cache", root), shared = { fee: 0 };
    const value: { a: typeof shared; b: typeof shared; self?: unknown } = { a: shared, b: shared }; value.self = value;
    cache.setKey("value", value); cache.save(true);
    const output = Cache.load("cache", root).getKey("value");
    expect(output.self).toBe(output); expect(output.a).toBe(output.b); expect(output.a.fee).toBe(0);
  });

  it("preserves cold and cached ESLint glob enumeration with an explicit owned config", async () => {
    const root = await fixture(); await mkdir(join(root, "src")); await writeFile(join(root, "src/fixture.js"), "const unused = 0;\n");
    const { ESLint } = require("eslint") as typeof import("eslint");
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true,
      overrideConfig: [{ files: ["**/*.js"], languageOptions: { ecmaVersion: 2022 }, rules: { "no-unused-vars": "error" } }],
      cache: true, cacheLocation: join(root, ".eslintcache") });
    const pick = (rows: Awaited<ReturnType<typeof eslint.lintFiles>>) => rows.map((row) => ({
      errorCount: row.errorCount, warningCount: row.warningCount, messages: row.messages,
    }));
    const first = pick(await eslint.lintFiles(["src/*.js"])), second = pick(await eslint.lintFiles(["src/*.js"]));
    expect(second).toEqual(first); expect(first[0].errorCount).toBe(1);
    expect(first[0].messages[0].ruleId).toBe("no-unused-vars");
  });
});
