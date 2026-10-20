// @vitest-environment node
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpRequest, HttpResponse } from "@smithy/protocol-http";
import { parseXML, XmlNode, XmlText } from "@aws-sdk/xml-builder";
import { createDocumentVault } from "./agents/document-vault";
import { createColdStore } from "./agents/hoovie/cold-files";
import { generatePresignedUrl } from "./report-engine/presign";

type Fixture = { status: number; headers?: Record<string, string>; body?: string | Uint8Array };
const clients: S3Client[] = [];
function fixtureClient(...fixtures: Fixture[]) {
  const requests: HttpRequest[] = [];
  const client = new S3Client({
    endpoint: "https://storage.fixture.invalid", region: "auto", forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: "synthetic-key", secretAccessKey: "synthetic-secret" },
    requestHandler: { async handle(request: HttpRequest) {
      requests.push(request);
      const fixture = fixtures.shift();
      if (!fixture) throw new Error("Unplanned in-memory S3 request");
      return { response: new HttpResponse({ statusCode: fixture.status, headers: fixture.headers ?? {},
        body: Readable.from([fixture.body ?? ""]) }) };
    } },
  });
  clients.push(client);
  return { client, requests, remaining: () => fixtures.length };
}
afterEach(() => { for (const client of clients.splice(0)) client.destroy(); vi.unstubAllEnvs(); });

describe("actual AWS XML and injected S3 protocol compatibility", () => {
  it("preserves namespaced structures, arrays, zero strings and empty elements", () => {
    expect(parseXML('<Root xmlns="urn:fixture"><Zero>0</Zero><Empty/><Items><Item>x</Item><Item>y</Item></Items></Root>'))
      .toEqual({ Root: { xmlns: "urn:fixture", Zero: "0", Empty: "", Items: { Item: ["x", "y"] } } });
  });
  it("preserves AWS character references, CRLF, Unicode and text whitespace", () => {
    const parsed = parseXML('<Root><Name> Fee &amp; Café </Name><Line>A&#13;&#10;B&#xD;&#xA;C</Line><Price>&dollar;0 &euro;0</Price></Root>');
    expect(parsed.Root).toEqual({ Name: " Fee & Café ", Line: "A\r\nB\r\nC", Price: "$0 €0" });
  });
  it("retains the AWS wrapper's own escaped attributes and text", () => {
    const value = '" fixture="value & <0>';
    const text = "fee <0> & text";
    const xml = XmlNode.of("Root").addAttribute("value", value).addChildNode(new XmlText(text)).toString();
    expect(parseXML(xml).Root).toEqual({ value, "#text": text });
    expect(xml).not.toContain('value="" fixture=');
  });
  it("rejects malformed XML", () => {
    expect(() => parseXML("<Root><Broken></Root>")).toThrow();
  });
  it("keeps zero ContentLength and ETag from HeadObject", async () => {
    const { client, requests } = fixtureClient({ status: 200, headers: { "content-length": "0", etag: '"fixture-etag"' } });
    expect(await client.send(new HeadObjectCommand({ Bucket: "fixture-bucket", Key: "zero" })))
      .toMatchObject({ ContentLength: 0, ETag: '"fixture-etag"', $metadata: { httpStatusCode: 200 } });
    expect(requests[0]).toMatchObject({ method: "HEAD", hostname: "storage.fixture.invalid", path: "/fixture-bucket/zero" });
  });
  it("keeps HeadObject's body-free 404 as NotFound", async () => {
    const { client } = fixtureClient({ status: 404 });
    await expect(client.send(new HeadObjectCommand({ Bucket: "fixture-bucket", Key: "missing" })))
      .rejects.toMatchObject({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
  });
  it("preserves raw binary GetObject bytes rather than parsing an object as XML", async () => {
    const bytes = new Uint8Array([0, 37, 80, 68, 70, 255]);
    const { client } = fixtureClient({ status: 200, headers: { "content-type": "application/octet-stream" }, body: bytes });
    const result = await client.send(new GetObjectCommand({ Bucket: "fixture-bucket", Key: "raw" }));
    expect(await result.Body?.transformToByteArray()).toEqual(bytes);
  });
  it("decodes a real S3 XML error, status and request metadata", async () => {
    const { client } = fixtureClient({ status: 404, headers: { "content-type": "application/xml", "x-amz-request-id": "fixture-id" },
      body: "<Error><Code>NoSuchKey</Code><Message>missing &amp; synthetic &#13;&#10; key</Message></Error>" });
    await expect(client.send(new GetObjectCommand({ Bucket: "fixture-bucket", Key: "missing" })))
      .rejects.toMatchObject({ name: "NoSuchKey", message: "missing & synthetic \r\n key", $metadata: { httpStatusCode: 404, requestId: "fixture-id" } });
  });
  it("keeps malformed XML errors as errors instead of successful objects", async () => {
    const { client } = fixtureClient({ status: 403, headers: { "content-type": "application/xml" }, body: "<Error><Broken></Error>" });
    await expect(client.send(new GetObjectCommand({ Bucket: "fixture-bucket", Key: "bad" }))).rejects.toBeInstanceOf(Error);
  });
  it("keeps PutObject's zero-byte request, headers and successful metadata", async () => {
    const { client, requests } = fixtureClient({ status: 200, headers: { etag: '"written"' } });
    expect(await client.send(new PutObjectCommand({ Bucket: "fixture-bucket", Key: "zero", Body: new Uint8Array(0), ContentType: "application/pdf" })))
      .toMatchObject({ ETag: '"written"', $metadata: { httpStatusCode: 200 } });
    expect(requests[0]).toMatchObject({ method: "PUT", body: new Uint8Array(0), headers: { "content-type": "application/pdf", "content-length": "0" } });
  });
  it("keeps a typed PutObject XML refusal", async () => {
    const { client } = fixtureClient({ status: 403, headers: { "content-type": "application/xml" },
      body: "<Error><Code>AccessDenied</Code><Message><![CDATA[synthetic <denied>]]></Message></Error>" });
    await expect(client.send(new PutObjectCommand({ Bucket: "fixture-bucket", Key: "denied", Body: "fixture" })))
      .rejects.toMatchObject({ name: "AccessDenied", message: "synthetic <denied>", $metadata: { httpStatusCode: 403 } });
  });
  it("keeps vault missing-object detection, upload, duplicate skip and raw reads on the actual client", async () => {
    const bytes = new Uint8Array([0, 1, 2]);
    const { client, requests, remaining } = fixtureClient({ status: 404 }, { status: 200 }, { status: 200 }, { status: 200, body: bytes });
    const vault = createDocumentVault(client, "fixture-bucket");
    const hash = "a".repeat(64);
    expect(await vault.store(bytes, hash, "application/pdf")).toEqual({ status: "stored", key: `aa/${hash}` });
    expect(await vault.store(bytes, hash, "application/pdf")).toEqual({ status: "already_stored", key: `aa/${hash}` });
    expect(await vault.read(`aa/${hash}`)).toEqual(bytes);
    expect(requests.map((request) => request.method)).toEqual(["HEAD", "PUT", "HEAD", "GET"]);
    expect(remaining()).toBe(0);
  });
  it("keeps vault failure handling with a parsed XML service refusal", async () => {
    const { client } = fixtureClient({ status: 403, body: "<Error><Code>AccessDenied</Code><Message>synthetic &lt;denied&gt;</Message></Error>" });
    expect(await createDocumentVault(client, "fixture-bucket").store(new Uint8Array(0), "b".repeat(64), null))
      .toMatchObject({ status: "failed", key: null });
  });
  it("keeps the cold-file store's compressed body and raw-byte round trip", async () => {
    const bytes = new Uint8Array([31, 139, 0, 255]);
    const { client, requests } = fixtureClient({ status: 200 }, { status: 200, body: bytes });
    const store = createColdStore(client, "fixture-bucket");
    await store.put("cold.gz", bytes);
    expect(await store.get("cold.gz")).toEqual(bytes);
    expect(requests[0]).toMatchObject({ method: "PUT", body: bytes, headers: { "content-type": "application/gzip" } });
  });
  it("presigns via the real SDK without sending a storage request", async () => {
    const { client, requests } = fixtureClient();
    const url = new URL(await getSignedUrl(client, new GetObjectCommand({ Bucket: "fixture-bucket", Key: "a b" }), { expiresIn: 60, signingDate: new Date("2026-10-19T00:00:00Z") }));
    expect(url.hostname).toBe("storage.fixture.invalid");
    expect(url.pathname).toBe("/fixture-bucket/a%20b");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(requests).toEqual([]);
  });
  it("keeps the application's report-download signing contract with synthetic credentials", async () => {
    vi.stubEnv("R2_ENDPOINT", "https://storage.fixture.invalid");
    vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic-key"); vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic-secret");
    vi.stubEnv("R2_BUCKET", "fixture-reports");
    const url = new URL(await generatePresignedUrl("reports/zero.html", 120));
    expect(url.hostname).toBe("storage.fixture.invalid");
    expect(url.pathname).toBe("/fixture-reports/reports/zero.html");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
  });
});
