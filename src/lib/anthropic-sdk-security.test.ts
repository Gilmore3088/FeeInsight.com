// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SDK = typeof import("@anthropic-ai/sdk");
type Memory = typeof import("@anthropic-ai/sdk/tools/memory/node");
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@anthropic-ai/sdk"));
const roots: string[] = [];
const params = {
  model: "claude-haiku-4-5-20251001", max_tokens: 32,
  messages: [{ role: "user" as const, content: "fixture only" }],
  tools: [{ name: "lookup_fee", input_schema: { type: "object" as const, properties: { fee: { type: "number" } } } }],
};
const message = {
  id: "msg_fixture", type: "message", role: "assistant", model: params.model,
  content: [{ type: "text", text: '{"fee":0}' }, { type: "tool_use", id: "tool_fixture", name: "lookup_fee", input: { fee: 0 } }],
  stop_reason: "tool_use", stop_sequence: null, stop_details: null,
  usage: { input_tokens: 17, output_tokens: 9, cache_read_input_tokens: 3,
    cache_creation_input_tokens: 5, server_tool_use: { web_search_requests: 1 } },
};
const options = { apiKey: "fixture-not-real", authToken: null, baseURL: "https://fixture.invalid", maxRetries: 0 };
const jsonHeaders = { "content-type": "application/json", "request-id": "req_fixture" };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "feeinsight-sdk-memory-test.")); roots.push(root);
  await mkdir(join(root, "memories_sibling"));
  await writeFile(join(root, "memories_sibling", "marker.txt"), "owned synthetic marker");
  return root;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected global network request"); });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.each(["cjs", "esm"] as const)("actual installed Anthropic SDK %s", (mode) => {
  const sdk = (): Promise<SDK> => mode === "cjs" ? Promise.resolve(require("@anthropic-ai/sdk"))
    : import(pathToFileURL(join(packageRoot, "index.mjs")).href);
  const memory = (): Promise<Memory> => mode === "cjs" ? Promise.resolve(require("@anthropic-ai/sdk/tools/memory/node"))
    : import(pathToFileURL(join(packageRoot, "tools/memory/node.mjs")).href);

  it("rejects both reads and writes to a sibling sharing the memory directory prefix", async () => {
    const root = await fixture();
    const tool = await (await memory()).BetaLocalFilesystemMemoryTool.init(root);
    await expect(tool.view({ command: "view", path: "/memories/../memories_sibling/marker.txt" })).rejects.toThrow(/escape/);
    await expect(tool.create({ command: "create", path: "/memories/../memories_sibling/new.txt", file_text: "never written" })).rejects.toThrow(/escape/);
    await expect(readFile(join(root, "memories_sibling/new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects reads and writes through a symlink into that sibling", async () => {
    const root = await fixture();
    const tool = await (await memory()).BetaLocalFilesystemMemoryTool.init(root);
    await symlink(join(root, "memories_sibling"), join(root, "memories/link"), "dir");
    await expect(tool.view({ command: "view", path: "/memories/link/marker.txt" })).rejects.toThrow(/escape.*symlink/);
    await expect(tool.create({ command: "create", path: "/memories/link/new.txt", file_text: "never written" })).rejects.toThrow(/escape.*symlink/);
    await expect(readFile(join(root, "memories_sibling/new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates private files and directories, including atomic replacement, under umask 000", async () => {
    const root = await fixture();
    const entry = join(packageRoot, `tools/memory/node.${mode === "esm" ? "mjs" : "js"}`);
    const load = mode === "cjs" ? `require(${JSON.stringify(entry)})` : `await import(${JSON.stringify(pathToFileURL(entry).href)})`;
    // Keep permissive umask confined to this child; no application environment or network.
    const script = `const fs=require('node:fs/promises'); const path=require('node:path');
      (async()=>{process.umask(0); const {BetaLocalFilesystemMemoryTool}= ${load};
      const root=${JSON.stringify(root)}; const tool=await BetaLocalFilesystemMemoryTool.init(root);
      await tool.create({command:'create',path:'/memories/nested/zero.txt',file_text:'zero=0\\nline2'});
      const mode=async(p)=>(await fs.stat(path.join(root,p))).mode&511;
      const created={root:await mode('memories'),nested:await mode('memories/nested'),file:await mode('memories/nested/zero.txt')};
      await tool.str_replace({command:'str_replace',path:'/memories/nested/zero.txt',old_str:'zero=0',new_str:'zero=1'});
      const rewritten=await mode('memories/nested/zero.txt');
      await tool.rename({command:'rename',old_path:'/memories/nested/zero.txt',new_path:'/memories/renamed/zero.txt'});
      const renamedDirectory=await mode('memories/renamed');
      const text=await tool.view({command:'view',path:'/memories/renamed/zero.txt'});
      await tool.delete({command:'delete',path:'/memories/renamed/zero.txt'});
      const removed=await fs.access(path.join(root,'memories/renamed/zero.txt')).then(()=>false,()=>true);
      console.log(JSON.stringify({created,rewritten,renamedDirectory,text,removed}));
      })().catch(error=>{console.error(error);process.exitCode=1;});`;
    const executable = mode === "esm" ? script.replace("const fs=require('node:fs/promises'); const path=require('node:path');",
      "import fs from 'node:fs/promises'; import path from 'node:path';") : script;
    const result = spawnSync(process.execPath, [...(mode === "esm" ? ["--input-type=module"] : []), "-e", executable],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 32 * 1024 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ created: { root: 0o700, nested: 0o700, file: 0o600 },
      rewritten: 0o600, renamedDirectory: 0o700, removed: true, text: expect.stringContaining("zero=1") });
  });

  it("preserves Messages bodies, text/tool zero, usage, status and request identity", async () => {
    const { default: Client } = await sdk();
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://fixture.invalid/v1/messages");
      expect(init.method).toBe("POST"); expect(JSON.parse(init.body)).toEqual(params);
      const headers = new Headers(init.headers);
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("x-api-key")).toBe(options.apiKey); expect(headers.has("authorization")).toBe(false);
      return new Response(JSON.stringify(message), { headers: jsonHeaders });
    });
    const client = new Client({ ...options, fetch });
    const result = await client.messages.create(params, { timeout: 1234 }).withResponse();
    expect(result.data).toEqual(message); expect(result.request_id).toBe("req_fixture"); expect(result.response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce(); expect(client.timeout).toBe(600_000);
    expect(new Client({ ...options, maxRetries: undefined, fetch }).maxRetries).toBe(2);
  });

  it.each([[400, "BadRequestError"], [401, "AuthenticationError"], [403, "PermissionDeniedError"], [404, "NotFoundError"],
    [409, "ConflictError"], [422, "UnprocessableEntityError"], [429, "RateLimitError"], [500, "InternalServerError"]] as const)
  ("preserves %s error class, status, body and request identity", async (status, name) => {
    const { default: Client } = await sdk();
    const body = { type: "error", error: { type: "invalid_request_error", message: "fixture failure" } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: jsonHeaders }));
    const client = new Client({ ...options, fetch });
    const error = await client.messages.create(params).catch((caught: Error) => caught);
    expect(error.constructor.name).toBe(name);
    expect(error).toMatchObject({ status, requestID: "req_fixture", error: body,
      message: expect.stringContaining("fixture failure") });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does no fetch for an already cancelled request", async () => {
    const { default: Client, APIUserAbortError } = await sdk(); const controller = new AbortController(); controller.abort();
    const fetch = vi.fn(async () => { throw new Error("unexpected request"); });
    await expect(new Client({ ...options, fetch }).messages.create(params, { signal: controller.signal }))
      .rejects.toBeInstanceOf(APIUserAbortError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["caller", "timeout"] as const)("propagates %s cancellation to a stalled injected fetch", async (cause) => {
    const { default: Client, APIUserAbortError, APIConnectionTimeoutError } = await sdk(); const controller = new AbortController();
    let started!: () => void; const waiting = new Promise<void>((resolve) => { started = resolve; }); let aborted = false;
    const fetch = vi.fn(async (_url, init) => { started(); return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => { aborted = true; reject(new DOMException("fixture aborted", "AbortError")); }, { once: true });
    }); });
    const promise = Promise.resolve(new Client({ ...options, fetch }).messages.create(params,
      { signal: controller.signal, timeout: cause === "timeout" ? 20 : 2000 }));
    const result = expect(promise).rejects.toBeInstanceOf(cause === "timeout" ? APIConnectionTimeoutError : APIUserAbortError);
    await waiting; if (cause === "caller") controller.abort(); await result;
    expect(aborted).toBe(true); expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves adjacent raw SSE event iteration", async () => {
    const { default: Client } = await sdk();
    const events = [{ type: "message_start", message: { ...message, content: [], stop_reason: null } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" }];
    const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const client = new Client({ ...options, fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }) });
    const stream = await client.messages.create({ ...params, stream: true }); const received = [];
    for await (const event of stream) received.push(event);
    expect(received).toEqual(events);
  });
});
