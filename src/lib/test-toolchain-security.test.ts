// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { interceptorPlugin } from "@vitest/mocker/node";
import { isFileLoadingAllowed, resolveConfig, transformWithOxc } from "vite";
import { rolldown } from "rolldown";

const consumer = createRequire(import.meta.url);
let fixture: string;
let project: string;
beforeAll(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Toolchain fixtures forbid network"); })));
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), "feeinsight-test-toolchain."));
  project = join(fixture, "project");
  await mkdir(project);
  await writeFile(join(project, "allowed.js"), "export const zero = 0;");
  await writeFile(join(project, ".env"), "OWNED_SYNTHETIC_DENIED_MARKER");
  await writeFile(join(fixture, "outside.js"), "OWNED_SYNTHETIC_OUTSIDE_MARKER");
});
afterEach(async () => { await rm(fixture, { recursive: true, force: false }); });

async function config() {
  return resolveConfig({ configFile: false, envFile: false, root: project, logLevel: "silent",
    server: { fs: { strict: true, allow: [project], deny: ["**/.env"] } } }, "serve");
}
type MockEvent = { type: string; raw: string; id: string; url: string; redirect: string };
type HarnessPlugin = {
  configureServer(server: unknown): void;
  load: { handler(id: string): Promise<string | undefined> };
};
async function mockHarness(options?: { registerWebSocketEvents?: boolean }) {
  const listeners = new Map<string, (event: MockEvent) => void>();
  const sent: unknown[][] = [];
  const plugin = (interceptorPlugin as unknown as (options?: object) => HarnessPlugin)(options);
  plugin.configureServer({ config: await config(), ws: {
    on: (event: string, callback: (event: MockEvent) => void) => listeners.set(event, callback),
    send: (...args: unknown[]) => sent.push(args),
  } });
  return { plugin, listeners, sent };
}
async function redirectedSource(redirect: string) {
  const h = await mockHarness();
  h.listeners.get("vitest:interceptor:register")!({ type: "redirect", raw: "./owned", id: "owned-id", url: "/owned", redirect });
  return { source: await h.plugin.load.handler("owned-id"), acknowledgements: h.sent.length };
}

/** Read the actual Vite bundle; no rewritten implementation stands in for its guards. */
async function bundledSource() {
  const entry = consumer.resolve("vite");
  return readFile(join(entry, "../chunks/node.js"), "utf8");
}
async function windowsDenyGuard() {
  const source = await bundledSource();
  const start = source.indexOf("function isFileLoadingAllowed(");
  const end = source.indexOf("function checkLoadingAccess(", start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  // Platform/allowlist dependencies are deterministic adapters, not Windows filesystem proof.
  const context = { isWindows: true, windowsDriveRE: /^[A-Z]:/i,
    isFileInTargetPath: (root: string, path: string) => root === path || path.startsWith(`${root}/`) };
  vm.runInNewContext(`${source.slice(start, end)};globalThis.actualGuard=isFileLoadingAllowed;`, context, { timeout: 1000 });
  const guard = (context as typeof context & { actualGuard: (config: object, path: string) => boolean }).actualGuard;
  const c = { server: { fs: { strict: true, allow: ["C:/owned"] } }, safeModulePaths: new Set(),
    fsDenyGlob: (path: string) => path.endsWith("/.env") };
  return (path: string) => guard(c, path);
}
async function windowsEditor() {
  const source = await bundledSource();
  const start = source.indexOf("var require_launch_editor = ");
  const end = source.indexOf("//#endregion", start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  const fileChecks: string[] = [], errors: unknown[][] = [];
  const context = {
    __commonJSMin: (factory: (exports: object, module: { exports: unknown }) => void) => {
      const commonModule = { exports: {} }; factory({}, commonModule); return () => commonModule.exports;
    },
    __require: (name: string) => {
      if (name === "fs") return { existsSync: (path: string) => { fileChecks.push(path); return false; } };
      if (name === "os") return { release: () => "" };
      if (name === "path") return win32;
      // Any editor/process attempt fails; no adapter ever opens a real UNC path.
      if (name === "child_process") return new Proxy({}, { get() { throw new Error("Unexpected editor process"); } });
      throw new Error(`Unexpected bundled require: ${name}`);
    },
    require_picocolors: () => ({ red: (s: string) => s }),
    require_guess: () => () => { throw new Error("Unexpected editor detection"); },
    require_get_args: () => () => { throw new Error("Unexpected editor arguments"); },
    process: { platform: "win32", env: {} }, console: { log: () => {} },
  };
  vm.runInNewContext(`${source.slice(start, end)};globalThis.actualEditor=require_launch_editor();`, context, { timeout: 1000 });
  const editor = (context as typeof context & { actualEditor: (path: string, editor: undefined, onError: (...args: unknown[]) => void) => void }).actualEditor;
  return { fileChecks, errors, run: (path: string) => editor(path, undefined, (...args) => errors.push(args)) };
}

describe("actual test-toolchain file boundaries", () => {
  it("refuses a redirect outside the allowlist before its real load hook reads it", async () => {
    expect(await redirectedSource("x:../outside.js")).toEqual({ source: undefined, acknowledgements: 1 });
  });
  it("refuses an in-root denied file through the same registration/load path", async () => {
    expect(await redirectedSource("x:/.env")).toEqual({ source: undefined, acknowledgements: 1 });
  });
  it("retains an allowed redirect and its zero-valued module source", async () => {
    expect(await redirectedSource("x:/allowed.js")).toEqual({ source: "export const zero = 0;", acknowledgements: 1 });
  });
  it("respects disabling the standalone WebSocket registration path", async () => {
    expect((await mockHarness({ registerWebSocketEvents: false })).listeners.size).toBe(0);
  });
  it("rejects the Windows ADS spelling in the actual bundled deny-check", async () => {
    expect((await windowsDenyGuard())("C:/owned/.env::$DATA")).toBe(false);
  });
  it("rejects Windows short-name spellings in the actual bundled deny-check", async () => {
    expect((await windowsDenyGuard())("C:/owned/SECRET~1")).toBe(false);
  });
  it("preserves ordinary Windows drive paths and ordinary deny matches", async () => {
    const guard = await windowsDenyGuard();
    expect(guard("C:/owned/zero.js")).toBe(true); expect(guard("C:/owned/.env")).toBe(false);
  });
  it("rejects UNC before the actual bundled editor reaches any filesystem adapter", async () => {
    const editor = await windowsEditor(); editor.run(String.raw`\\synthetic.invalid\share\marker.txt`);
    expect(editor.fileChecks).toEqual([]);
    expect(editor.errors.some(e => String(e[1]).includes("UNC paths"))).toBe(true);
  });
  it("preserves the ordinary bundled editor path without spawning or opening it", async () => {
    const editor = await windowsEditor(); editor.run(String.raw`C:\owned\ordinary.txt`);
    expect(editor.fileChecks).toEqual([String.raw`C:\owned\ordinary.txt`]); expect(editor.errors).toEqual([]);
  });
  it("uses the installed Vite public guard for ordinary/denied/outside/ADS paths", async () => {
    const c = await config();
    expect(isFileLoadingAllowed(c, join(project, "allowed.js"))).toBe(true);
    for (const path of [join(project, ".env"), join(project, ".env::$DATA"), join(fixture, "outside.js")])
      expect(isFileLoadingAllowed(c, path)).toBe(false);
  });
  it("uses the installed native transformer without losing zero", async () => {
    const result = await transformWithOxc("export const zero: number = 0;", "owned.ts");
    expect(result.code).toMatch(/zero\s*=\s*0/); expect(result.code).not.toContain(": number");
  });
  it("uses the actual matching Rolldown native wrapper with an owned virtual module", async () => {
    const bundle = await rolldown({ input: "owned-only", plugins: [{ name: "owned-only",
      resolveId: (id) => id === "owned-only" ? "\0owned-only" : null,
      load: (id) => id === "\0owned-only" ? "export const zero = 0;" : null,
    }] });
    try {
      const result = await bundle.generate({ format: "es" });
      expect(result.output.some(file => file.type === "chunk" && /zero\s*=\s*0/.test(file.code))).toBe(true);
    } finally { await bundle.close(); }
  });
});
