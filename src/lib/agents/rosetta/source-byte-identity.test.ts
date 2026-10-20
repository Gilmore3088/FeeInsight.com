// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DocumentVault } from "../document-vault";
import { isPermanentForInput } from "../learning/outcomes";
import { loadDocumentBytes } from "./read";

const a = new TextEncoder().encode("<h1>Schedule of Fees</h1><p>Overdraft fee $30</p>");
const b = new TextEncoder().encode("<h1>Schedule of Fees</h1><p>Overdraft fee $35</p>");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const selectedHash = hash(a);
const sourceUrl = "https://fixture.invalid/fees.html";
const vaultKey = `${selectedHash.slice(0, 2)}/${selectedHash}`;
const fetchBytes = (bytes = a) => vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/html" } }));
const stored = (bytes = a): DocumentVault => ({ configured: true,
  read: vi.fn(async () => bytes), store: vi.fn(async () => { throw new Error("No storage write expected"); }),
  presign: vi.fn(async () => { throw new Error("No presign expected"); }) });

describe("selected raw source bytes", () => {
  it.each([selectedHash, selectedHash.toUpperCase()])("accepts matching HTTP bytes for valid hash %s", async (expected) => {
    const fetch = fetchBytes();
    const result = await loadDocumentBytes({ sourceUrl, selectedHash: expected }, fetch, null);
    expect(result).toMatchObject({ ok: true, bytes: a, fromVault: false,
      byteIdentity: { status: "verified", selectedHash: expected, observedHash: selectedHash } });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(sourceUrl, expect.any(Object));
  });

  it("refuses changed HTTP bytes as retryable access evidence, without returning them for conversion", async () => {
    const result = await loadDocumentBytes({ sourceUrl, selectedHash }, fetchBytes(b), null);
    expect(result).toMatchObject({ ok: false, outcome: "evidence_mismatch",
      byteIdentity: { status: "mismatch", selectedHash, observedHash: hash(b) } });
    expect(result).not.toHaveProperty("bytes");
    if (!result.ok) expect(isPermanentForInput(result.outcome)).toBe(false);
  });

  it("uses matching stored bytes without HTTP", async () => {
    const vault = stored(); const fetch = fetchBytes(b);
    expect(await loadDocumentBytes({ sourceUrl, selectedHash, vaultKey }, fetch, vault))
      .toMatchObject({ ok: true, bytes: a, fromVault: true, byteIdentity: { status: "verified" } });
    expect(vault.read).toHaveBeenCalledExactlyOnceWith(vaultKey); expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses corrupt stored bytes without replacing them by a second HTTP fetch", async () => {
    const vault = stored(b); const fetch = fetchBytes();
    expect(await loadDocumentBytes({ sourceUrl, selectedHash, vaultKey }, fetch, vault))
      .toMatchObject({ ok: false, outcome: "evidence_mismatch", fromVault: true,
        byteIdentity: { status: "mismatch", selectedHash, observedHash: hash(b) } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([a, b])("validates the actual HTTP fallback when a stored read fails", async (bytes) => {
    const vault = stored(); vi.mocked(vault.read).mockRejectedValueOnce(new Error("Owned missing object"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetch = fetchBytes(bytes);
      const result = await loadDocumentBytes({ sourceUrl, selectedHash, vaultKey }, fetch, vault);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(bytes === a);
      expect(result.byteIdentity?.status).toBe(bytes === a ? "verified" : "mismatch");
      expect(result).toHaveProperty("fromVault", false);
    } finally { error.mockRestore(); }
  });

  it("checks HTTP when storage is unconfigured, without trying storage operations", async () => {
    const vault = stored(); vault.configured = false;
    const result = await loadDocumentBytes({ sourceUrl, selectedHash, vaultKey }, fetchBytes(), vault);
    expect(result).toMatchObject({ ok: true, fromVault: false, byteIdentity: { status: "verified" } });
    expect(vault.read).not.toHaveBeenCalled(); expect(vault.store).not.toHaveBeenCalled();
  });

  it.each(["", "source-hash", "a".repeat(63), "g".repeat(64), ` ${selectedHash}`])
    ("refuses malformed selected hashes before any transport: %j", async (invalid) => {
      const fetch = fetchBytes(); const vault = stored();
      const result = await loadDocumentBytes({ sourceUrl, selectedHash: invalid, vaultKey }, fetch, vault);
      expect(result).toMatchObject({ ok: false, outcome: "evidence_mismatch",
        byteIdentity: { status: "invalid_selected_hash", selectedHash: null, observedHash: null } });
      expect(fetch).not.toHaveBeenCalled(); expect(vault.read).not.toHaveBeenCalled();
      if (!result.ok) expect(isPermanentForInput(result.outcome)).toBe(false);
    });

  it.each([null, undefined])("keeps missing legacy hashes explicit, without inventing original identity", async (missing) => {
    const result = await loadDocumentBytes({ sourceUrl, selectedHash: missing }, fetchBytes(), null);
    expect(result).toMatchObject({ ok: true, bytes: a,
      byteIdentity: { status: "unbound", selectedHash: null, observedHash: selectedHash } });
  });

  it("preserves ordinary HTTP failure classification", async () => {
    const result = await loadDocumentBytes({ sourceUrl, selectedHash }, vi.fn(async () => new Response(null, { status: 404 })), null);
    expect(result).toMatchObject({ ok: false, outcome: "http_404" });
    expect(result.byteIdentity).toBeUndefined();
  });
});
