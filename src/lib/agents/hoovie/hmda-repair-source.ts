import { createHash } from "node:crypto";
import { normalizeLei } from "@/lib/regulatory/gleif";
import { normalizeHmdaRssd } from "@/lib/regulatory/hmda-identity";
import { HMDA_REPAIR_MANIFEST } from "./hmda-repair-manifest";

export const HMDA_REPAIR_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export interface HmdaRepairSource {
  url: string;
  sha256: string;
  identities: Array<{ certificate: string; lei: string; rssdId: string | null }>;
  index: unknown;
}

/** Fixed public endpoint, byte cap and whole-request deadline; never fetch a caller URL. */
export async function readHmdaRepairSource(fetchImpl: typeof fetch = fetch): Promise<HmdaRepairSource> {
  const response = await fetchImpl(HMDA_REPAIR_MANIFEST.sourceUrl, {
    signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error(`HMDA repair source unavailable (${response.status})`);
  if (Number(response.headers.get("content-length")) > HMDA_REPAIR_SOURCE_MAX_BYTES) {
    await response.body.cancel();
    throw new Error("HMDA repair source exceeds byte bound");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > HMDA_REPAIR_SOURCE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("HMDA repair source exceeds byte bound");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== HMDA_REPAIR_MANIFEST.sourceSha256) throw new Error("HMDA repair source digest drift: refresh review");
  const payload = JSON.parse(body.toString("utf8")) as {
    meta?: { total?: number; index?: unknown }; data?: Array<{ data?: Record<string, unknown> }>;
  };
  if (!Array.isArray(payload.data) || payload.data.length > 10_000 || payload.data.length !== payload.meta?.total) {
    throw new Error("HMDA repair source is incomplete");
  }
  const identities = payload.data.flatMap(({ data }) => {
    const lei = normalizeLei(data?.LEI);
    const certificate = String(data?.CERT ?? "").trim();
    return lei && /^\d+$/.test(certificate) ? [{ certificate, lei, rssdId: normalizeHmdaRssd(data?.FED_RSSD) }] : [];
  });
  return { url: HMDA_REPAIR_MANIFEST.sourceUrl, sha256, identities, index: payload.meta?.index ?? null };
}
