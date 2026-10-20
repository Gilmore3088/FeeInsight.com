// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type Server, type RequestListener, type RequestOptions } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import type { AddressInfo, Socket } from "node:net";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { createFeeSourceFetch, feeSourceFetch, isPublicFeeSourceAddress } from "./fee-source-fetch";

type Dependencies = NonNullable<Parameters<typeof createFeeSourceFetch>[0]>;
const publicAddresses = [{ address: "93.184.215.14", family: 4 }, { address: "2606:4700::1111", family: 6 }];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(listener: RequestListener, tls = false, trustCertificate = true) {
  const server = tls ? createHttpsServer({ key, cert }, listener) : createServer(listener);
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const connections: Array<{ url: string; pinned: LookupAddress[]; options: RequestOptions }> = [];
  // Only this injected fixture adapter remaps an already-validated destination
  // to our ephemeral server. The production client has no private-address bypass.
  const request: Dependencies["request"] = (url, options, callback) => {
    const lookup = options.lookup!;
    const nativeOptions = {
      ...options, port, headers: { ...options.headers, host: url.host }, ...(tls && trustCertificate ? { ca: cert } : {}),
      lookup(host, lookupOptions, done) {
        lookup(host, { ...lookupOptions, all: true }, (error, answer) => {
          if (error) { done(error, "", 4); return; }
          connections.push({ url: url.href, pinned: answer as LookupAddress[], options });
          const owned = { address: "127.0.0.1", family: 4 };
          if (lookupOptions.all) done(null, [owned]);
          else done(null, owned.address, owned.family);
        });
      },
    } satisfies RequestOptions;
    return (tls ? httpsRequest : httpRequest)(url, nativeOptions, callback);
  };
  return { server, connections, sockets, request, client: (extra: Dependencies = {}) => createFeeSourceFetch({ resolve: async () => publicAddresses, request, ...extra }) };
}

describe("fee-source destination policy", () => {
  it.each([
    "0.0.0.0", "0.0.0.1", "10.2.3.4", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.2.1",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.9", "192.0.2.1", "192.168.1.1",
    "192.31.196.1", "192.52.193.1", "192.88.99.1", "192.175.48.1", "198.18.1.1", "198.19.255.255",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "::127.0.0.1", "64:ff9b::a00:1", "64:ff9b:1::1",
    "100::1", "100:0:0:1::1", "2001::1", "2001:2::1", "2001:20::1", "2001:db8::1", "2002:7f00:1::",
    "2620:4f:8000::1", "3fff::1", "5f00::1", "fc00::1", "fd12::1", "fe80::1", "fec0::1", "ff02::1",
    "fe80::1%en0", "2606:4700::1111%en0", "not-an-ip", "127.1", "0x7f000001",
  ])("refuses non-public/special address %s", (address) => expect(isPublicFeeSourceAddress(address)).toBe(false));

  it.each(["1.1.1.1", "8.8.8.8", "93.184.215.14", "100.128.0.1", "172.32.0.1", "192.169.0.1", "223.255.255.254", "2001:4860:4860::8888", "2606:4700::1111"])("allows ordinary public address %s", (address) => expect(isPublicFeeSourceAddress(address)).toBe(true));

  it.each([
    "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://%31%32%37.0.0.1/",
    "http://[::ffff:127.0.0.1]/", "http://[::1]/", "http://[2001:db8::1]/",
    "ftp://bank.example/", "file:///etc/passwd", "https://user:pass@bank.example/", "http://bank.example:8080/", "https://bank.example:80/",
    "http://[fe80::1%25eth0]/", "not a url",
  ])("refuses URL before any connection: %s", async (url) => {
    const request = vi.fn();
    const resolve = vi.fn(async () => publicAddresses);
    await expect(createFeeSourceFetch({ request, resolve })(url)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    [], [{ address: "10.0.0.1", family: 4 }], [...publicAddresses, { address: "::1", family: 6 }],
    [...publicAddresses, { address: "169.254.169.254", family: 4 }], [{ address: "8.8.8.8", family: 6 }],
    [{ address: "garbage", family: 4 }], Array.from({ length: 129 }, () => publicAddresses[0]),
  ])("rejects empty, mixed, malformed and excessive DNS answers", async (...addresses) => {
    const request = vi.fn();
    await expect(createFeeSourceFetch({ request, resolve: async () => addresses })("https://bank.example/fees")).rejects.toMatchObject({ code: "blocked_address" });
    expect(request).not.toHaveBeenCalled();
  });

  it("pins all connection lookups to copied vetted answers, with no re-resolution", async () => {
    const f = await fixture((_req, res) => res.end("fees"));
    const answers = publicAddresses.map((a) => ({ ...a }));
    const resolve = vi.fn(async () => answers);
    const request: Dependencies["request"] = (url, options, callback) => {
      answers[0].address = "127.0.0.1"; // a post-validation mutation cannot rebind the socket
      for (const family of [4, 6, 0]) options.lookup!(url.hostname, { family, all: true }, (error, selected) => {
        expect(error).toBeNull();
        expect(selected).toEqual(publicAddresses.filter((a) => !family || a.family === family));
      });
      options.lookup!("another.example", {}, (error) => expect(error).toBeInstanceOf(Error));
      return f.request!(url, options, callback);
    };
    const response = await f.client({ resolve, request })("http://bank.example:80/fees#fragment");
    expect(await response.text()).toBe("fees");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(f.connections[0].pinned).toEqual(publicAddresses);
    expect(f.connections[0].options).toMatchObject({ agent: false, autoSelectFamily: true, maxHeaderSize: 16384 });
    expect(response.url).toBe("http://bank.example/fees");
  });
});

describe("fee-source redirects and provenance", () => {
  it("reads official HTML/PDF through a relative redirect, preserving validators and final metadata", async () => {
    const received: Array<{ host?: string; etag?: string; modified?: string }> = [];
    const f = await fixture((req, res) => {
      received.push({ host: req.headers.host, etag: req.headers["if-none-match"] as string, modified: req.headers["if-modified-since"] as string });
      if (req.url === "/fees") { res.writeHead(302, { location: "/fees.pdf" }); res.end("redirect"); return; }
      res.writeHead(200, { "content-type": "application/pdf", etag: '"v2"', "last-modified": "Mon, 19 Oct 2026 10:00:00 GMT" });
      res.end("%PDF-1.7 fees $35");
    });
    const response = await f.client()("http://bank.example/fees", { headers: { Host: "attacker.example", "If-None-Match": '"v1"', "If-Modified-Since": "Sun, 18 Oct 2026 10:00:00 GMT" } });
    expect(response.url).toBe("http://bank.example/fees.pdf");
    expect(response.redirected).toBe(true);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("etag")).toBe('"v2"');
    const copy = response.clone();
    expect(copy.url).toBe(response.url);
    expect(copy.redirected).toBe(true);
    expect(await copy.text()).toBe("%PDF-1.7 fees $35");
    expect(await response.text()).toBe("%PDF-1.7 fees $35");
    expect(received).toEqual(Array.from({ length: 2 }, () => ({ host: "bank.example", etag: '"v1"', modified: "Sun, 18 Oct 2026 10:00:00 GMT" })));
  });

  it.each([301, 302, 303, 307, 308])("strips credentials and validators on cross-origin %s redirects", async (status) => {
    const received: Array<Record<string, unknown>> = [];
    const f = await fixture((req, res) => {
      received.push(req.headers);
      if (req.url === "/fees") { res.writeHead(status, { location: "http://cdn.example/fees.html" }); res.end(); }
      else { res.setHeader("content-type", "text/html"); res.end("<h1>Consumer fees</h1>"); }
    });
    const response = await f.client()("http://bank.example/fees", { headers: {
      authorization: "Bearer test-only", cookie: "fixture=yes", cookie2: "fixture2=yes", "proxy-authorization": "Basic test-only",
      "if-none-match": '"v1"', "if-modified-since": "yesterday", "user-agent": "FeeInsightBot", accept: "text/html",
    } });
    expect(response.url).toBe("http://cdn.example/fees.html");
    expect(received[0].authorization).toBe("Bearer test-only");
    expect(received[0]["proxy-authorization"]).toBeUndefined();
    for (const h of ["authorization", "cookie", "cookie2", "proxy-authorization", "if-none-match", "if-modified-since"]) expect(received[1][h]).toBeUndefined();
    expect(received[1]).toMatchObject({ host: "cdn.example", "user-agent": "FeeInsightBot", accept: "text/html" });
  });

  it.each(["http://127.0.0.1/", "http://[::ffff:10.0.0.1]/", "http://2130706433/", "http://bank.example:8080/", "http://user:pass@bank.example/", "file:///etc/passwd"])("refuses redirected destination %s before a second connection", async (location) => {
    const f = await fixture((_req, res) => { res.writeHead(302, { location }); res.end(); });
    await expect(f.client()("http://bank.example/fees")).rejects.toThrow();
    expect(f.connections).toHaveLength(1);
  });

  it("re-resolves same-host redirects and refuses rebinding/mixed answers", async () => {
    const f = await fixture((_req, res) => { res.writeHead(302, { location: "/other" }); res.end(); });
    const resolve = vi.fn().mockResolvedValueOnce(publicAddresses).mockResolvedValueOnce([...publicAddresses, { address: "10.0.0.1", family: 4 }]);
    await expect(f.client({ resolve })("http://bank.example/fees")).rejects.toMatchObject({ code: "blocked_address" });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(f.connections).toHaveLength(1);
  });

  it("caps redirect loops, never downloads their endless bodies, and supports manual/error modes", async () => {
    const f = await fixture((_req, res) => {
      res.writeHead(302, { location: "/again", "content-encoding": "gzip" });
      res.write("malformed compressed redirect body".repeat(1024)); // never ends; must be discarded, not decoded
    });
    await expect(f.client({ maxRedirects: 2 })("http://bank.example/fees")).rejects.toMatchObject({ code: "redirect_limit" });
    expect(f.connections).toHaveLength(3);
    await vi.waitFor(() => expect(f.sockets.size).toBe(0));
    await expect(f.client()("http://bank.example/fees", { redirect: "error" })).rejects.toThrow("redirect refused");
    // A manual redirect body is still a bounded response: use a finished fixture.
    const manual = await fixture((_req, res) => { res.writeHead(302, { location: "/other" }); res.end("manual"); });
    const response = await manual.client()("http://bank.example/fees", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.redirected).toBe(false);
    expect(await response.text()).toBe("manual");
    expect(manual.connections).toHaveLength(1);
  });

  it.each([204, 205, 304])("preserves bodyless HTTP %s responses", async (status) => {
    const f = await fixture((_req, res) => { res.writeHead(status, { etag: '"same"' }); res.end(); });
    const response = await f.client()("http://bank.example/fees", { headers: { "if-none-match": '"same"' } });
    expect(response.status).toBe(status);
    expect(response.headers.get("etag")).toBe('"same"');
    expect(response.body).toBeNull();
  });

  it("supports HEAD and cancellation of a completed bounded Response body", async () => {
    const methods: string[] = [];
    const f = await fixture((req, res) => { methods.push(req.method!); res.end("fees"); });
    const head = await f.client()("http://bank.example/fees", { method: "HEAD" });
    expect(head.body).toBeNull();
    const get = await f.client()("http://bank.example/fees");
    await get.body!.cancel();
    expect(get.bodyUsed).toBe(true);
    expect(methods).toEqual(["HEAD", "GET"]);
  });

  it("verifies TLS against original hostname and sends original Host/SNI", async () => {
    const seen: Array<{ host?: string; sni?: string }> = [];
    const f = await fixture((req, res) => {
      seen.push({ host: req.headers.host, sni: (req.socket as import("node:tls").TLSSocket).servername || undefined });
      res.end("TLS fees");
    }, true);
    const response = await f.client()("https://bank.example/fees");
    expect(await response.text()).toBe("TLS fees");
    expect(seen).toEqual([{ host: "bank.example", sni: "bank.example" }]);
    await expect(f.client()("https://wrong.example/fees")).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    const untrusted = await fixture((_req, res) => res.end("untrusted TLS"), true, false);
    await expect(untrusted.client()("https://bank.example/fees")).rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
  });
});

describe("fee-source resource limits", () => {
  it.each(["gzip", "deflate", "br"])("decodes %s and retains source headers", async (encoding) => {
    const compress = encoding === "gzip" ? gzipSync : encoding === "deflate" ? deflateSync : brotliCompressSync;
    const bytes = compress("<h1>Consumer fee schedule $35</h1>");
    const f = await fixture((_req, res) => { res.writeHead(200, { "content-encoding": encoding, "content-length": bytes.length }); res.end(bytes); });
    const response = await f.client()("http://bank.example/fees");
    expect(await response.text()).toBe("<h1>Consumer fee schedule $35</h1>");
    expect(response.headers.get("content-encoding")).toBe(encoding);
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
  });

  it.each(["declared", "chunked", "decompressed"])("caps %s body bytes and closes the socket", async (mode) => {
    const f = await fixture((_req, res) => {
      if (mode === "declared") res.writeHead(200, { "content-length": 1024 });
      if (mode === "decompressed") { res.setHeader("content-encoding", "gzip"); res.end(gzipSync("x".repeat(1024))); }
      else { res.write("x".repeat(65)); res.end("x".repeat(65)); }
    });
    await expect(f.client({ maxBytes: 100 })("http://bank.example/fees")).rejects.toMatchObject({ code: "too_large" });
    await vi.waitFor(() => expect(f.sockets.size).toBe(0));
  });

  it.each(["deflate", "br"])("caps %s expansion after decoding", async (encoding) => {
    const bytes = (encoding === "br" ? brotliCompressSync : deflateSync)("x".repeat(4096));
    const f = await fixture((_req, res) => { res.setHeader("content-encoding", encoding); res.end(bytes); });
    await expect(f.client({ maxBytes: 100 })("http://bank.example/fees")).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects malformed/unsupported compressed bodies and truncated responses", async () => {
    for (const encoding of ["gzip", "compress"]) {
      const f = await fixture((_req, res) => { res.setHeader("content-encoding", encoding); res.end("not compressed"); });
      await expect(f.client()("http://bank.example/fees")).rejects.toThrow();
    }
    const f = await fixture((_req, res) => { res.writeHead(200, { "content-length": 100 }); res.flushHeaders(); res.write("short"); res.destroy(); });
    await expect(f.client()("http://bank.example/fees")).rejects.toThrow();
  });

  it("caps compressed wire bytes even when the decoded body is small", async () => {
    const gzip = gzipSync("fees");
    const header = Buffer.from(gzip.subarray(0, 10));
    header[3] |= 4; // valid gzip FEXTRA metadata, not part of the decoded text
    const encoded = Buffer.concat([header, Buffer.from([0, 2]), Buffer.alloc(512), gzip.subarray(10)]);
    const f = await fixture((_req, res) => { res.setHeader("content-encoding", "gzip"); res.end(encoded); });
    await expect(f.client({ maxBytes: 100 })("http://bank.example/fees")).rejects.toMatchObject({ code: "too_large" });
  });

  it("caps response headers before consuming a body", async () => {
    const f = await fixture((_req, res) => { res.setHeader("x-too-large", "x".repeat(17 * 1024)); res.end("fees"); });
    await expect(f.client()("http://bank.example/fees")).rejects.toMatchObject({ code: "HPE_HEADER_OVERFLOW" });
  });

  it("bounds DNS waits and does not connect after a late resolution", async () => {
    let release!: (a: LookupAddress[]) => void;
    const resolve = () => new Promise<LookupAddress[]>((r) => { release = r; });
    const request = vi.fn();
    await expect(createFeeSourceFetch({ resolve, request, timeoutMs: 20 })("http://bank.example/fees")).rejects.toMatchObject({ name: "TimeoutError" });
    release(publicAddresses);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["headers", "body", "decompression"])("bounds stalled %s and honors caller cancellation", async (mode) => {
    const f = await fixture((_req, res) => {
      if (mode === "decompression") { res.setHeader("content-encoding", "gzip"); res.write(gzipSync("partial").subarray(0, 12)); }
      else if (mode === "body") { res.writeHead(200); res.flushHeaders(); res.write("partial"); }
    });
    await expect(f.client({ timeoutMs: 30 })("http://bank.example/fees")).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.waitFor(() => expect(f.sockets.size).toBe(0));
    const controller = new AbortController();
    const pending = f.client()("http://bank.example/fees", { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(f.sockets.size).toBe(0));
  });

  it("uses one deadline across redirects", async () => {
    const f = await fixture((_req, res) => { setTimeout(() => { res.writeHead(302, { location: "/again" }); res.end(); }, 20); });
    await expect(f.client({ timeoutMs: 55 })("http://bank.example/fees")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(f.connections.length).toBeLessThanOrEqual(3);
  });

  it("does not resolve/connect for already-cancelled or unsupported requests", async () => {
    const resolve = vi.fn(async () => publicAddresses);
    const request = vi.fn();
    const client = createFeeSourceFetch({ resolve, request });
    await expect(client("http://bank.example/fees", { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    await expect(client("http://bank.example/fees", { method: "POST", body: "x" })).rejects.toThrow("GET/HEAD");
    await expect(client(new Request("http://bank.example/fees"))).rejects.toThrow("GET/HEAD");
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(feeSourceFetch).toBeTypeOf("function");
  });
});

// Public test-only key and self-signed certificate for our owned loopback TLS
// fixture. Never installed as an application CA or used by the default transport.
const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCvy1KMo8k5Loc1
uYs8G3jVLL1ZpebkZYB5nUFhOD+lMcSG4Spd2UdDXST42acjdmuRUmZLMxwehqgW
BTDlLOD/kcpRl60cGpfufMJVjK/l5XQKwbVKFsADVnqunc6bOq8phs8ZtS2PFIwv
XrX1rOmER5Z41SUvgbFNlmhWDdLcBkbFee9f1djwT3JmXXBQD3hDt2HTkz9anwOa
83r57jSJCKmLl0l6PcvwDiw00Mbv/p0rx99KFa++K+AS2wjPUnpHyO1XWbTkLNxu
hs0BdeC5trrpKN4zNH/fRJNIOvSTav0Ny5HHsB6NTiFLJl7v2MyYzbZ8jEaJsLp9
4ccHdrujAgMBAAECggEAEm+XS6qNmtKXWXoI8RfMd0bG4NT2PvOqIpbsWV7FxfRP
MPoCMG9t+tGU5AgncB+mLkpe8fn9M/JZRF3s/8vSGNtYRXBLtkvPrTImS0SC2fBT
WCFyer+iCXeTTCa+mSbxYcCCjaajjYLRJNKg8I/euYGsdSWdTbsjNgjVDllKyMou
+ct0skq1RVb/dk+hyQQ6s6+eVHoyyMK7LL5wqr5AxMvv3SDPh3GFNPlkvLZi2TiG
WjQgRJMO7qeBaY9qYVF8cwl5daYlQxwogrnOW9YMcsnPSHnVyUdMwHYEXHqbx73T
y+1/V8J+9CWI6xXEw35VDyACc4kOHsstJTOnsNaD6QKBgQDrr2eZqo75P92AwhGf
NNBXEaph6vNLiG2qn+bLFWZdYEqeyj1U/guukY1BVUwPnDWuVBsjWQTLcpyeTOlg
dwuiUjQpZIYOeJUSpw/FyrPj6djVDpyO1WtoZQYGUyKE5pmHT2Xs81QR8YvOuWY1
CwjtG4mBWq+niXt440gyNKiAjQKBgQC+8l9rD2ZmtWOS6SAfTShFN3oYmZqUPwwQ
xyQsvQ00IFXfzoyMqvBsdrqpUGj7ulAB2UIwiVuNtMRB2GNDhs2v5inifJTkUMvp
QeJ7sv/OqzS36tIZ/KRAyydjtM7TfAn7LB3IsGKA8ds9DftRXbZ8sVXg5WQHCbHs
xyeu89+Y7wKBgBBKdYzHn05XPcZSo8kva185V1+hT+PesEXk+5z6A7NcnovPSuH/
FWuhn/PuI23IzGUaZy3QT2aIq469njwOvn0f1X8u9Z02dIdviMWRN1H/rf88HVI6
Kkxy/zGcuXwaPG5/7HmucBc1bQaDBi+QbbOF/cE1NYMNG73FaA4gWa1ZAoGAU9XK
exDp3tJpA4mDZvrTYYB4BPD743bC72LfyRy//VDtIzRmlSRAJv8B+XCqh0tH8WfY
HcNRBSiGunotKuq2yDH/1cbpAE1RGfqpW7I9ihm1LcLVuD8qRqBrjOVHoabmIvc9
pG188iw+G9JVs2W3x4t8rx9ICacCDXlrPO8qDtUCgYEAtEILdrVmfk7LnBLz2wsz
A+q9a1J4VhA+UwgK2duwaiAZRZTOOZTSPUWfDVOCi1dGlcUaHfLKJY+KW4ecT5DA
IFOwheovI74hjScHxiliyNZgZlOls7bTQ9UPuvT7H3pRZrCeKhhUhJc12Z8FKGy7
i+vSAr/aTbTLOvb2gb86jT4=
-----END PRIVATE KEY-----
`;
const cert = `-----BEGIN CERTIFICATE-----
MIIDKjCCAhKgAwIBAgIUQUBoe49FNCHeZ4Tsv3ugpPfUh9gwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMYmFuay5leGFtcGxlMCAXDTI2MTAxOTA3MzkxNVoYDzIx
MjYwOTI1MDczOTE1WjAXMRUwEwYDVQQDDAxiYW5rLmV4YW1wbGUwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCvy1KMo8k5Loc1uYs8G3jVLL1ZpebkZYB5
nUFhOD+lMcSG4Spd2UdDXST42acjdmuRUmZLMxwehqgWBTDlLOD/kcpRl60cGpfu
fMJVjK/l5XQKwbVKFsADVnqunc6bOq8phs8ZtS2PFIwvXrX1rOmER5Z41SUvgbFN
lmhWDdLcBkbFee9f1djwT3JmXXBQD3hDt2HTkz9anwOa83r57jSJCKmLl0l6Pcvw
Diw00Mbv/p0rx99KFa++K+AS2wjPUnpHyO1XWbTkLNxuhs0BdeC5trrpKN4zNH/f
RJNIOvSTav0Ny5HHsB6NTiFLJl7v2MyYzbZ8jEaJsLp94ccHdrujAgMBAAGjbDBq
MB0GA1UdDgQWBBSKCvj/hNK7wWuZEOlfcSLpJbcXbjAfBgNVHSMEGDAWgBSKCvj/
hNK7wWuZEOlfcSLpJbcXbjAPBgNVHRMBAf8EBTADAQH/MBcGA1UdEQQQMA6CDGJh
bmsuZXhhbXBsZTANBgkqhkiG9w0BAQsFAAOCAQEAZ0+xkVj9d7cfNAU5qrNQU2TA
HtJxhQe2YP1YG2P5V2uaaAAu4/gj+jghjR8p9jFE9XIGQXdaToTOq+mlqM7HEXTM
33DERaHs6iXSpVEP5+0+Z+3nFXBAk0yENZhuoYiubsoDcPwrDWFQYgAVoMEcIaOJ
3wSv/+aSuU/W2jgdafwqE0GeHsuU3B70jysn+WuZ27VWSqc/PRB31BEvvrT61VLK
QEkVx3WMwz/V71NwL/jxuy7JDCoxamqpEdBLOzDBHN5aPnm8+ICgz8TpieXXmuQB
d/jXirPKsWEQYaP6pQpUM1tDc5GCE6esyOoYQ6++Gt1BtU88McEUmbtVZqyWvg==
-----END CERTIFICATE-----
`;
