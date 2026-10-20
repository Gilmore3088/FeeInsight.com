import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * The document vault: every fee document Magellan downloads is kept in Cloudflare R2,
 * so Rosetta reads our copy instead of downloading again, and every published fee can
 * point at the exact file it came from.
 *
 * Keys are content-addressed (`<first 2 hex>/<sha256>`), the layout the earlier crawler
 * used, so identical bytes are stored once across banks and versions. The vault is
 * optional: without R2 credentials the pipeline runs as before and reports
 * `not_configured`.
 */

export const DEFAULT_DOCUMENTS_BUCKET = "bank-fee-index-documents";
const PRESIGN_TTL_SECONDS = 3600;

export type VaultStoreStatus = "stored" | "already_stored" | "not_configured" | "failed";

export interface DocumentVault {
  configured: boolean;
  store(bytes: Uint8Array, contentHash: string, contentType: string | null, options?: { signal?: AbortSignal }): Promise<{ status: VaultStoreStatus; key: string | null; error?: string }>;
  read(key: string): Promise<Uint8Array>;
  presign(key: string): Promise<string>;
}

export function documentKey(contentHash: string): string {
  return `${contentHash.slice(0, 2)}/${contentHash}`;
}

/** Keys from the vault, as opposed to the retired crawler's local `data/documents/...` paths. */
export function isVaultKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{2}\/[0-9a-f]{64}$/.test(value);
}

export function documentsBucket(): string {
  return process.env.R2_DOCUMENTS_BUCKET?.trim() || DEFAULT_DOCUMENTS_BUCKET;
}

let cachedClient: S3Client | null = null;

/** The shared R2 client (S3 API), or null without R2 credentials. Also used by Hoovie's cold files. */
export function r2Client(): S3Client | null {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  cachedClient ??= new S3Client({
    endpoint,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return cachedClient;
}

function isNotFound(error: unknown): boolean {
  const meta = (error as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
  return meta.$metadata?.httpStatusCode === 404 || meta.name === "NotFound" || meta.name === "NoSuchKey";
}

/** Builds a vault over an S3-compatible client; pass `null` for "not configured". */
export function createDocumentVault(client: S3Client | null, bucket: string = documentsBucket()): DocumentVault {
  return {
    configured: client != null,
    async store(bytes, contentHash, contentType, options) {
      if (!client) return { status: "not_configured", key: null };
      if(options?.signal?.aborted)return {status:"failed",key:null,error:"Document vault operation cancelled"};
      const key = documentKey(contentHash);
      try {
        try {
          const command=new HeadObjectCommand({ Bucket: bucket, Key: key });
          await vaultAbortable(options?.signal ? client.send(command,{abortSignal:options.signal}) : client.send(command),options?.signal);
          if(options?.signal?.aborted)throw new Error("Document vault operation cancelled");
          return { status: "already_stored", key };
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
        if(options?.signal?.aborted)throw new Error("Document vault operation cancelled");
        const command=new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType ?? "application/octet-stream",
          });
        await vaultAbortable(options?.signal ? client.send(command,{abortSignal:options.signal}) : client.send(command),options?.signal);
        return { status: "stored", key };
      } catch (error) {
        return { status: "failed", key: null, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async read(key) {
      if (!client) throw new Error("Document vault is not configured");
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`Vault object ${key} has no body`);
      return response.Body.transformToByteArray();
    },
    async presign(key) {
      if (!client) throw new Error("Document vault is not configured");
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: PRESIGN_TTL_SECONDS });
    },
  };
}

/** SDK cancellation plus a finite await even for an injected client ignoring abortSignal. */
async function vaultAbortable<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return work;
  if(signal.aborted)throw new Error("Document vault operation cancelled");
  let abort:()=>void=()=>undefined;
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new Error("Document vault operation cancelled"));signal.addEventListener("abort",abort,{once:true});});
  try{return await Promise.race([work,cancelled]);}finally{signal.removeEventListener("abort",abort);}
}

export function getDocumentVault(): DocumentVault {
  return createDocumentVault(r2Client());
}

/**
 * Removes one stored document from the vault (#1041). Only Atlas's vault retention calls it, and
 * only for a key its lineage check cleared and only while `VAULT_RETENTION_LIVE` is on
 * (`src/lib/agents/atlas/vault-retention.ts`). Refuses anything that is not a vault key, so a
 * cold file or another object in the same bucket can never be removed through it.
 */
export async function deleteVaultObject(client: S3Client, key: string, bucket: string = documentsBucket()): Promise<void> {
  if (!isVaultKey(key)) throw new Error(`Not a document vault key: ${key}`);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

const readyCache = new WeakMap<object, boolean>();

/** True once the document-vault migration is applied (catalog query, safe in a transaction). */
export async function documentVaultSchemaReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  const [row] = await db`
    SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'source_documents' AND column_name = 'document_r2_key'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'institution_source_profiles' AND column_name = 'rejected_source_urls'
      )
    ) AS vault_schema_ready
  `;
  const ready = row?.vault_schema_ready === true;
  if (ready) readyCache.set(db, true);
  return ready;
}
