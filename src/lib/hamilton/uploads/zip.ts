import { inflateRawSync } from "node:zlib";
import { MAX_EXPANDED_BYTES, MAX_UPLOAD_BYTES, MAX_XML_BYTES, MAX_ZIP_ENTRIES, invalidFile, workbookLimit } from "./limits";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  start: number;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
export function decodeUtf8(bytes: Uint8Array): string {
  try { return utf8.decode(bytes); } catch { return invalidFile(); }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function bounds(offset: number, length: number, end: number): void {
  if (offset < 0 || length < 0 || offset + length > end) invalidFile();
}

function checkExtra(buf: Buffer, start: number, size: number): void {
  const end = start + size;
  for (let cursor = start; cursor < end;) {
    bounds(cursor, 4, end);
    const id = buf.readUInt16LE(cursor);
    const length = buf.readUInt16LE(cursor + 2);
    bounds(cursor + 4, length, end);
    // ZIP64 and Unicode-path overrides are unsupported; use the actual directory name.
    if (id === 1 || id === 0x7075) invalidFile();
    cursor += 4 + length;
  }
}

/** Validate the entire directory and all local ranges before expanding any part. */
export function openWorkbook(buf: Buffer): { entries: Map<string, ZipEntry>; read: (entry: ZipEntry) => string } {
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("The file is over 2 MB. Export a smaller data range and upload it again.");
  let eocd = -1;
  for (let cursor = buf.length - 22; cursor >= Math.max(0, buf.length - 65_557); cursor--) {
    if (buf.readUInt32LE(cursor) === 0x06054b50 && cursor + 22 + buf.readUInt16LE(cursor + 20) === buf.length) {
      eocd = cursor;
      break;
    }
  }
  if (eocd < 0) invalidFile();
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirStart = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) workbookLimit("up to 128 parts are accepted.");
  if (count === 0 || buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0 ||
      buf.readUInt16LE(eocd + 8) !== count || dirStart + dirSize !== eocd) invalidFile();
  bounds(dirStart, dirSize, eocd);
  const entries = new Map<string, ZipEntry>();
  const ranges: [number, number][] = [];
  let declaredBytes = 0;
  let cursor = dirStart;
  for (let index = 0; index < count; index++) {
    bounds(cursor, 46, eocd);
    if (buf.readUInt32LE(cursor) !== 0x02014b50) invalidFile();
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const crc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const local = buf.readUInt32LE(cursor + 42);
    bounds(cursor + 46, nameLength + extraLength + commentLength, eocd);
    if ((method !== 0 && method !== 8) || (flags & ~0x080e) !== 0 || (method === 0 && (flags & 6)) ||
        buf.readUInt16LE(cursor + 34) !== 0 || compressedSize === 0xffffffff || local === 0xffffffff) invalidFile();
    if (size > MAX_XML_BYTES) workbookLimit("each expanded part must be 8 MB or smaller.");
    if ((declaredBytes += size) > MAX_EXPANDED_BYTES) workbookLimit("the expanded parts must total 16 MB or less.");
    if (method === 0 && compressedSize !== size) invalidFile();
    const name = decodeUtf8(buf.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) => part === ".." || part === ".") || entries.has(name)) invalidFile();
    checkExtra(buf, cursor + 46 + nameLength, extraLength);
    bounds(local, 30, dirStart);
    if (buf.readUInt32LE(local) !== 0x04034b50 || buf.readUInt16LE(local + 6) !== flags || buf.readUInt16LE(local + 8) !== method) invalidFile();
    const localNameLength = buf.readUInt16LE(local + 26);
    const localExtraLength = buf.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    bounds(local + 30, localNameLength + localExtraLength, dirStart);
    bounds(start, compressedSize, dirStart);
    if (decodeUtf8(buf.subarray(local + 30, local + 30 + localNameLength)) !== name) invalidFile();
    checkExtra(buf, local + 30 + localNameLength, localExtraLength);
    let end = start + compressedSize;
    if (flags & 8) {
      // Streaming ZIP writers put sizes/CRC in a descriptor after the compressed data.
      bounds(end, 12, dirStart);
      const descriptor = buf.readUInt32LE(end) === 0x08074b50 ? end + 4 : end;
      bounds(descriptor, 12, dirStart);
      if (buf.readUInt32LE(descriptor) !== crc || buf.readUInt32LE(descriptor + 4) !== compressedSize || buf.readUInt32LE(descriptor + 8) !== size) invalidFile();
      end = descriptor + 12;
    } else if (buf.readUInt32LE(local + 14) !== crc || buf.readUInt32LE(local + 18) !== compressedSize || buf.readUInt32LE(local + 22) !== size) invalidFile();
    ranges.push([local, end]);
    entries.set(name, { name, method, compressedSize, size, crc, start });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== eocd) invalidFile();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) if (ranges[index][0] < ranges[index - 1][1]) invalidFile();
  let expandedBytes = 0;
  const read = (entry: ZipEntry): string => {
    const data = buf.subarray(entry.start, entry.start + entry.compressedSize);
    let bytes: Buffer;
    try {
      bytes = entry.method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) });
    } catch { return invalidFile(); }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) invalidFile();
    if ((expandedBytes += bytes.length) > MAX_EXPANDED_BYTES) workbookLimit("the expanded parts must total 16 MB or less.");
    return decodeUtf8(bytes);
  };
  return { entries, read };
}
