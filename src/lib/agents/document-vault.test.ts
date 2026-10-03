import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createDocumentVault, documentKey, isVaultKey } from "./document-vault";

const HASH = "3b9e92a4b6c123245053249d4bf58f4e531c8ce2dba7b66819e6fa7c237ba168";

function client(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

describe("document vault", () => {
  it("uses the content-addressed key layout the earlier crawler used", () => {
    expect(documentKey(HASH)).toBe(`3b/${HASH}`);
    expect(isVaultKey(`3b/${HASH}`)).toBe(true);
    expect(isVaultKey("data/documents/24/fee_schedule.pdf")).toBe(false);
    expect(isVaultKey(null)).toBe(false);
  });

  it("uploads a new document once", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }))
      .mockResolvedValueOnce({});
    const vault = createDocumentVault(client(send), "docs");

    const result = await vault.store(new Uint8Array([1, 2, 3]), HASH, "application/pdf");

    expect(result).toEqual({ status: "stored", key: `3b/${HASH}` });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    const put = send.mock.calls[1][0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: "docs", Key: `3b/${HASH}`, ContentType: "application/pdf" });
  });

  it("skips the upload when identical bytes are already stored", async () => {
    const send = vi.fn().mockResolvedValueOnce({});
    const result = await createDocumentVault(client(send), "docs").store(new Uint8Array([1]), HASH, null);
    expect(result).toEqual({ status: "already_stored", key: `3b/${HASH}` });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports a failure without throwing", async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Access Denied"), { $metadata: { httpStatusCode: 403 } }));
    const result = await createDocumentVault(client(send), "docs").store(new Uint8Array([1]), HASH, null);
    expect(result).toMatchObject({ status: "failed", key: null, error: "Access Denied" });
  });

  it("is a no-op when R2 is not configured", async () => {
    const vault = createDocumentVault(null);
    expect(vault.configured).toBe(false);
    expect(await vault.store(new Uint8Array([1]), HASH, null)).toEqual({ status: "not_configured", key: null });
    await expect(vault.read(`3b/${HASH}`)).rejects.toThrow("not configured");
  });

  it("reads stored bytes", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([37, 80, 68, 70]) } });
    const bytes = await createDocumentVault(client(send), "docs").read(`3b/${HASH}`);
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  });
});
