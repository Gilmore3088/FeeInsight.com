import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  url: "https://api.fdic.gov/banks/institutions?reviewed=1",
  body: JSON.stringify({ meta: { total: 3, index: { name: "frozen-test" } }, data: [
    { data: { CERT: 42, LEI: "2549002H3CEW0748X068", FED_RSSD: "000798512" } },
    { data: { CERT: 43, LEI: "2549002H3CEW0748X068", FED_RSSD: "-1" } },
    { data: { CERT: 44, LEI: "", FED_RSSD: "42" } },
  ] }),
}));
vi.mock("./hmda-repair-manifest", async () => ({ HMDA_REPAIR_MANIFEST: {
  sourceUrl: fixture.url, sourceSha256: (await import("node:crypto")).createHash("sha256").update(fixture.body).digest("hex"),
} }));
import { HMDA_REPAIR_SOURCE_MAX_BYTES, readHmdaRepairSource } from "./hmda-repair-source";

describe("bounded pinned HMDA source capture", () => {
  it("reads only the fixed URL with a request deadline, preserving competing source owners", async () => {
    const fetchImpl = vi.fn(async () => new Response(fixture.body));
    const out = await readHmdaRepairSource(fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(fixture.url, expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "error" }));
    expect(out.sha256).toBe(createHash("sha256").update(fixture.body).digest("hex"));
    expect(out.identities).toEqual([
      { certificate: "42", lei: "2549002H3CEW0748X068", rssdId: "798512" },
      { certificate: "43", lei: "2549002H3CEW0748X068", rssdId: null },
    ]);
  });
  it("refuses a changed source before parsing or using new identities", async () => {
    await expect(readHmdaRepairSource(vi.fn(async () => new Response(fixture.body + " ")) as typeof fetch)).rejects.toThrow(/digest drift/);
  });
  it("refuses an oversized declared response", async () => {
    await expect(readHmdaRepairSource(vi.fn(async () => new Response("x", { headers: { "content-length": String(HMDA_REPAIR_SOURCE_MAX_BYTES + 1) } })) as typeof fetch)).rejects.toThrow(/byte bound/);
  });
  it("enforces the streamed cap when content-length is missing", async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(HMDA_REPAIR_SOURCE_MAX_BYTES + 1)); } }));
    await expect(readHmdaRepairSource(vi.fn(async () => response) as typeof fetch)).rejects.toThrow(/byte bound/);
  });
  it("refuses unavailable or empty response bodies", async () => {
    await expect(readHmdaRepairSource(vi.fn(async () => new Response(null, { status: 403 })) as typeof fetch)).rejects.toThrow(/unavailable/);
  });
});
