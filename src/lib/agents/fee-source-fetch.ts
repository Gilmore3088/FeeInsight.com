/**
 * Node-only, bounded GET/HEAD transport for untrusted institution fee-source URLs.
 * Every socket uses a validated DNS snapshot, never a second resolver lookup. See
 * docs/project/findings/2026-10-19-safe-fee-source-fetch.md for scope/compatibility.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction, type TcpNetConnectOpts } from "node:net";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { checkServerIdentity } from "node:tls";

export const FEE_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
export const FEE_SOURCE_TIMEOUT_MS = 15_000;
export const FEE_SOURCE_MAX_REDIRECTS = 5;

// Conservatively exclude special-purpose blocks (including public protocol anycast)
// rather than maintaining exceptions irrelevant to ordinary bank/CDN websites.
// IANA IPv4/IPv6 special-purpose registries, reviewed 2026-10-19.
const specialV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) specialV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["2620:4f:8000::", 48], ["3fff::", 20],
] as const) specialV6.addSubnet(address, prefix, "ipv6");

export function isPublicFeeSourceAddress(address: string): boolean {
  // Zone identifiers, mapped/compatible IPv4, NAT64, Teredo, 6to4 and non-global
  // IPv6 must not provide an alternate spelling or tunnel to a private address.
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !specialV4.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6");
}

export class FeeSourceFetchError extends Error {
  constructor(public readonly code: "invalid_url" | "blocked_address" | "redirect_limit" | "too_large" | "unsupported_response", message: string) {
    super(message);
    this.name = "FeeSourceFetchError";
  }
}

function sourceUrl(input: string | URL): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new FeeSourceFetchError("invalid_url", "Invalid fee-source URL"); }
  // WHATWG URL parsing canonicalizes legacy decimal/octal/hex/short IPv4 first.
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.port) {
    throw new FeeSourceFetchError("invalid_url", "Fee sources require HTTP(S), default ports and no URL credentials");
  }
  url.hash = "";
  return url;
}

function hostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

type Resolve = (hostname: string) => Promise<LookupAddress[]>;
type PinnedRequestOptions = RequestOptions & Pick<TcpNetConnectOpts, "autoSelectFamily">;
type SourceRequest = (url: URL, options: PinnedRequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest;

interface FeeSourceDependencies {
  /** Trusted code/test dependency only; never populated from a source URL or request. */
  resolve?: Resolve;
  request?: SourceRequest;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

function aborted(signal: AbortSignal): never {
  throw signal.reason ?? new DOMException("Fee-source request aborted", "AbortError");
}

async function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) aborted(signal);
  let onAbort: () => void;
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("Fee-source request aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation, abort]); }
  finally { signal.removeEventListener("abort", onAbort!); }
}

async function pinnedLookup(url: URL, resolve: Resolve, signal: AbortSignal): Promise<LookupFunction> {
  const host = hostname(url);
  const literalFamily = isIP(host);
  const answers = literalFamily ? [{ address: host, family: literalFamily }] : await untilAborted(resolve(host), signal);
  if (!answers.length || answers.length > 128 || answers.some(({ address, family }) =>
    (family !== 4 && family !== 6) || isIP(address) !== family || !isPublicFeeSourceAddress(address))) {
    throw new FeeSourceFetchError("blocked_address", "Fee-source destination is not exclusively public unicast addresses");
  }
  // Copy primitive fields: no later resolver result, cache, or injected array mutation
  // can change the address set used by net.connect's family fallback.
  const snapshot = answers.map(({ address, family }) => ({ address, family }));
  return (queriedHost, options, callback) => {
    if (queriedHost !== host || signal.aborted) {
      callback(new Error("Fee-source connection no longer matches its validated destination"), "", 4);
      return;
    }
    const family = typeof options === "number" ? options : options.family;
    const matches = snapshot.filter((answer) => !family || answer.family === family);
    if (!matches.length) { callback(new Error("No validated address for requested family"), "", 4); return; }
    if (typeof options === "object" && options.all) callback(null, matches);
    else callback(null, matches[0].address, matches[0].family);
  };
}

function limitBytes(maxBytes: number): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new FeeSourceFetchError("too_large", "Fee-source document exceeds byte limit") : null, chunk);
    },
  });
}

async function bodyBytes(response: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<ArrayBuffer> {
  const declared = response.headers["content-length"];
  if (declared && Number(declared) > maxBytes) {
    response.destroy();
    throw new FeeSourceFetchError("too_large", "Fee-source content-length exceeds byte limit");
  }
  const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  const decoder = encoding === "gzip" || encoding === "x-gzip" ? createGunzip()
    : encoding === "deflate" ? createInflate()
      : encoding === "br" ? createBrotliDecompress() : null;
  if (encoding !== "identity" && !decoder) {
    response.destroy();
    throw new FeeSourceFetchError("unsupported_response", "Unsupported fee-source content encoding");
  }
  const chunks: Buffer[] = [];
  const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } });
  // Both compressed wire bytes and decoded bytes are capped; chunking or a small
  // compressed Content-Length cannot bypass the document limit.
  if (decoder) await pipeline(response, limitBytes(maxBytes), decoder, limitBytes(maxBytes), sink, { signal });
  else await pipeline(response, limitBytes(maxBytes), sink, { signal });
  return new Uint8Array(Buffer.concat(chunks)).buffer;
}

class FeeSourceResponse extends Response {
  constructor(body: BodyInit | null, init: ResponseInit, private readonly source: string, private readonly followed: boolean) { super(body, init); }
  override get url(): string { return this.source; }
  override get redirected(): boolean { return this.followed; }
  override clone(): Response {
    const copy = super.clone();
    return new FeeSourceResponse(copy.body, { status: copy.status, statusText: copy.statusText, headers: copy.headers }, this.source, this.followed);
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_HEADERS = ["authorization", "proxy-authorization", "cookie", "cookie2", "if-none-match", "if-modified-since"];

/**
 * Deliberately supports only the source readers' GET/HEAD subset of fetch. Bodies
 * are fully bounded before resolving, so callers' existing AbortSignal deadlines
 * now cover the body as well as headers. No cache, cookies, proxy or pool is used.
 */
export function createFeeSourceFetch(dependencies: FeeSourceDependencies = {}): typeof fetch {
  const resolve: Resolve = dependencies.resolve ?? ((host) => dnsLookup(host, { all: true, verbatim: true }));
  const request: SourceRequest = dependencies.request ?? ((url, options, callback) =>
    (url.protocol === "https:" ? httpsRequest : httpRequest)(url, options, callback));
  const maxBytes = dependencies.maxBytes ?? FEE_SOURCE_MAX_BYTES;
  const maxRedirects = dependencies.maxRedirects ?? FEE_SOURCE_MAX_REDIRECTS;
  const timeoutMs = dependencies.timeoutMs ?? FEE_SOURCE_TIMEOUT_MS;

  return async (input, init) => {
    if (input instanceof Request || (init?.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) || init?.body != null) {
      throw new TypeError("Fee-source fetch supports URL GET/HEAD requests only");
    }
    let url = sourceUrl(input);
    const method = init?.method?.toUpperCase() ?? "GET";
    const headers = new Headers(init?.headers);
    // URL controls authority; do not let caller headers override routing/identity.
    for (const name of ["host", "connection", "transfer-encoding", "content-length", "proxy-authorization"]) headers.delete(name);
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate, br");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Fee-source request timed out", "TimeoutError")), timeoutMs);
    const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    try {
      for (let hop = 0; ; hop++) {
        if (signal.aborted) aborted(signal);
        const lookup = await pinnedLookup(url, resolve, signal);
        if (signal.aborted) aborted(signal);
        const response = await new Promise<IncomingMessage>((resolveResponse, reject) => {
          // agent:false creates a one-use native agent. The original URL preserves
          // Host, SNI and certificate hostname checks; only DNS is overridden.
          const req = request(url, {
            method, headers: Object.fromEntries(headers), lookup, agent: false,
            autoSelectFamily: true, maxHeaderSize: 16 * 1024, signal,
            rejectUnauthorized: true, checkServerIdentity, insecureHTTPParser: false,
          }, resolveResponse);
          req.on("error", reject);
          req.end();
        });
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (REDIRECTS.has(status) && location && init?.redirect !== "manual") {
          // Do not download redirect bodies, including a malicious endless body.
          response.destroy();
          if (init?.redirect === "error") throw new TypeError("Fee-source redirect refused");
          if (hop >= maxRedirects) throw new FeeSourceFetchError("redirect_limit", "Fee-source redirect limit exceeded");
          const next = sourceUrl(new URL(location, url));
          if (next.origin !== url.origin) for (const name of CROSS_ORIGIN_HEADERS) headers.delete(name);
          url = next;
          continue;
        }
        const responseHeaders = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        const noBody = method === "HEAD" || [204, 205, 304].includes(status);
        let bytes: ArrayBuffer | null = null;
        if (noBody) response.destroy();
        else bytes = await bodyBytes(response, maxBytes, signal);
        return new FeeSourceResponse(bytes, { status, statusText: response.statusMessage, headers: responseHeaders }, url.href, hop > 0);
      }
    } catch (error) {
      if (signal.aborted) aborted(signal);
      throw error;
    } finally { clearTimeout(timeout); }
  };
}

export const feeSourceFetch = createFeeSourceFetch();
