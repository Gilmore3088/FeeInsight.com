import { createHash } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Gzip, gunzipSync } from "fflate";

import { documentsBucket, r2Client } from "@/lib/agents/document-vault";

/**
 * Cold files for public data (#1870): older periods of a large public-data table written as one
 * compressed file each, in the Cloudflare R2 account the document vault already uses (no new
 * provider). Each file has one index row in `public_data_cold_files`.
 *
 * Format `jsonl.gz`: gzip of a first line holding the column names as a JSON array, then one JSON
 * array of values per row. Values are written as Postgres returned them (numerics and bigints as
 * text, so no precision is lost); dates become ISO strings. The SHA-256 is of the gzip bytes.
 */

export const COLD_KEY_PREFIX = "public-data-cold";
export const COLD_FORMAT = "jsonl.gz";

/** The bucket for cold files: `R2_COLD_BUCKET`, else the document vault's bucket under its own prefix. */
export function coldBucket(): string {
  return process.env.R2_COLD_BUCKET?.trim() || documentsBucket();
}

/** Object key for one table's period from one source. Inputs are our own constants and dates. */
export function coldObjectKey(table: string, source: string, period: string): string {
  const safe = (part: string) => part.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${COLD_KEY_PREFIX}/${safe(table)}/${safe(source)}/${safe(period)}.${COLD_FORMAT}`;
}

export interface ColdStore {
  configured: boolean;
  bucket: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

/** A store over an S3-compatible client; `null` means R2 is not configured. */
export function createColdStore(client: S3Client | null, bucket: string = coldBucket()): ColdStore {
  return {
    configured: client != null,
    bucket,
    async put(key, bytes) {
      if (!client) throw new Error("Cold file storage is not configured (R2 credentials missing)");
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/gzip" }));
    },
    async get(key) {
      if (!client) throw new Error("Cold file storage is not configured (R2 credentials missing)");
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`Cold file ${key} has no body`);
      return response.Body.transformToByteArray();
    },
  };
}

export function getColdStore(): ColdStore {
  return createColdStore(r2Client());
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value ?? null;
}

/** Streams rows into a gzip file, one batch at a time, so the uncompressed text is never held whole. */
export class ColdFileWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly gzip: Gzip;
  private readonly encoder = new TextEncoder();
  private rows = 0;

  constructor(private readonly columns: readonly string[]) {
    this.gzip = new Gzip({ level: 6 }, (chunk) => this.chunks.push(chunk));
    this.gzip.push(this.encoder.encode(`${JSON.stringify(columns)}\n`));
  }

  push(batch: ReadonlyArray<Record<string, unknown>>): void {
    if (batch.length === 0) return;
    let text = "";
    for (const row of batch) text += `${JSON.stringify(this.columns.map((column) => cell(row[column])))}\n`;
    this.gzip.push(this.encoder.encode(text));
    this.rows += batch.length;
  }

  finish(): { bytes: Uint8Array; rowCount: number; sha256: string } {
    this.gzip.push(new Uint8Array(0), true);
    const size = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { bytes, rowCount: this.rows, sha256: sha256Hex(bytes) };
  }
}

export interface DecodedColdFile {
  columns: string[];
  /** Rows that passed the line filter, as objects keyed by column. */
  rows: Array<Record<string, unknown>>;
  /** Every data line in the file, filtered or not. */
  totalRows: number;
}

/**
 * Reads a cold file. With `expected`, the checksum and row count must match or it throws. The
 * optional `lineFilter` sees each raw line before it is parsed, so a reader looking for one line
 * item skips the rest cheaply; it must only drop lines that cannot match.
 */
export function decodeColdFile(
  bytes: Uint8Array,
  options: { expected?: { sha256: string; rowCount: number }; lineFilter?: (line: string) => boolean } = {},
): DecodedColdFile {
  if (options.expected && sha256Hex(bytes) !== options.expected.sha256) throw new Error("Cold file checksum does not match its index row");
  const text = new TextDecoder().decode(gunzipSync(bytes));
  const lines = text.split("\n");
  const header = lines[0] ? JSON.parse(lines[0]) : null;
  if (!Array.isArray(header) || header.some((c) => typeof c !== "string")) throw new Error("Cold file has no column header");
  const columns = header as string[];
  const rows: Array<Record<string, unknown>> = [];
  let totalRows = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    totalRows += 1;
    if (options.lineFilter && !options.lineFilter(line)) continue;
    const values = JSON.parse(line) as unknown[];
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      row[column] = values[index] ?? null;
    });
    rows.push(row);
  }
  if (options.expected && totalRows !== options.expected.rowCount) {
    throw new Error(`Cold file holds ${totalRows} rows; its index row says ${options.expected.rowCount}`);
  }
  return { columns, rows, totalRows };
}
