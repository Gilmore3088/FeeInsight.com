// @vitest-environment node
/** Trusted stream-only tests. No candidate or loader execution on the host. */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MAX_BYTES, readInput } from './board-brief-protocol.mjs';

async function readChunks(chunks: Buffer[], consumed: Buffer[] = []): Promise<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  if (!descriptor?.configurable) throw new Error('Test requires a restorable stdin descriptor');
  // Object mode preserves each exact Buffer. The wrapper observes what readInput
  // consumes, rather than assuming producer chunks survive stream coalescing.
  const stream = Readable.from(chunks, { objectMode: true });
  const originalIterator = stream[Symbol.asyncIterator].bind(stream);
  Object.defineProperty(stream, Symbol.asyncIterator, { configurable: true, value: async function* () {
    for await (const piece of { [Symbol.asyncIterator]: originalIterator }) {
      consumed.push(Buffer.from(piece));
      yield piece;
    }
  } });
  Object.defineProperty(process, 'stdin', { configurable: true, enumerable: descriptor.enumerable, get: () => stream });
  try { return await readInput(); }
  finally {
    Object.defineProperty(process, 'stdin', descriptor);
    stream.destroy();
  }
}

describe('independent bounded JSON UTF-8 stream decoding', () => {
  it('positive control: consumes two exact ASCII buffers and preserves ordinary JSON', async () => {
    const chunks = [Buffer.from('{"message":'), Buffer.from('"ordinary ASCII"}')], consumed: Buffer[] = [];
    const result = await readChunks(chunks, consumed);
    expect(consumed).toEqual(chunks);
    expect(result).toEqual({ message: 'ordinary ASCII' });
  });

  it('preserves a three-byte code point split after its first byte', async () => {
    const chunks = [
      Buffer.concat([Buffer.from('{"message":"'), Buffer.from([0xe2])]),
      Buffer.concat([Buffer.from([0x82, 0xac]), Buffer.from('"}')]),
    ], consumed: Buffer[] = [];
    const result = await readChunks(chunks, consumed);
    expect(consumed).toEqual(chunks);
    expect(result).toEqual({ message: '€' });
  });

  it('preserves a four-byte code point split between its two middle bytes', async () => {
    const chunks = [
      Buffer.concat([Buffer.from('{"message":"'), Buffer.from([0xf0, 0x9f])]),
      Buffer.concat([Buffer.from([0x92, 0xb3]), Buffer.from('"}')]),
    ], consumed: Buffer[] = [];
    const result = await readChunks(chunks, consumed);
    expect(consumed).toEqual(chunks);
    expect(result).toEqual({ message: '💳' });
  });

  it('accepts exactly the two-MiB byte limit with a shorter decoded UTF-16 string', async () => {
    expect(MAX_BYTES).toBe(2097152);
    const value = '€'.repeat((2097152 - 2) / 3);
    const bytes = Buffer.from(JSON.stringify(value));
    expect(bytes.byteLength).toBe(2097152);
    expect(value.length).toBeLessThan(2097152);
    // 1024 is an aligned character boundary after the opening JSON quote.
    const chunks = [bytes.subarray(0, 1024), bytes.subarray(1024)], consumed: Buffer[] = [];
    expect(await readChunks(chunks, consumed)).toBe(value);
    expect(consumed).toHaveLength(2);
    for (const [index, chunk] of chunks.entries()) {
      expect(Buffer.isBuffer(consumed[index])).toBe(true);
      expect(consumed[index].byteLength).toBe(chunk.byteLength);
      expect(consumed[index].equals(chunk)).toBe(true);
    }
  });

  it('rejects one byte above the limit even when decoded character count is below it', async () => {
    const value = '€'.repeat((2097152 - 2) / 3) + 'x';
    const bytes = Buffer.from(JSON.stringify(value));
    expect(bytes.byteLength).toBe(2097153);
    expect(value.length).toBeLessThan(2097152);
    const chunks = [bytes.subarray(0, 1024), bytes.subarray(1024)], consumed: Buffer[] = [];
    await expect(readChunks(chunks, consumed)).rejects.toThrow(/Input exceeds bound/);
    expect(consumed).toHaveLength(2);
    for (const [index, chunk] of chunks.entries()) {
      expect(Buffer.isBuffer(consumed[index])).toBe(true);
      expect(consumed[index].byteLength).toBe(chunk.byteLength);
      expect(consumed[index].equals(chunk)).toBe(true);
    }
  });

  it('rejects malformed JSON after consuming the two exact chunks', async () => {
    const chunks = [Buffer.from('{"message":'), Buffer.from('}')], consumed: Buffer[] = [];
    await expect(readChunks(chunks, consumed)).rejects.toThrow();
    expect(consumed).toEqual(chunks);
  });

  it('rejects invalid UTF-8 rather than changing it to replacement-character JSON', async () => {
    const chunks = [Buffer.from('{"message":"'), Buffer.concat([Buffer.from([0xc3, 0x28]), Buffer.from('"}')])], consumed: Buffer[] = [];
    await expect(readChunks(chunks, consumed)).rejects.toThrow();
    expect(consumed).toEqual(chunks);
  });

  it('rejects an empty input stream', async () => {
    const consumed: Buffer[] = [];
    await expect(readChunks([], consumed)).rejects.toThrow();
    expect(consumed).toEqual([]);
  });

  it('restores the original stdin descriptor after both successful and rejected reads', async () => {
    const before = Object.getOwnPropertyDescriptor(process, 'stdin');
    expect(await readChunks([Buffer.from('{"ok":true}')])).toEqual({ ok: true });
    expect(Object.getOwnPropertyDescriptor(process, 'stdin')).toEqual(before);
    await expect(readChunks([Buffer.from('{')])).rejects.toThrow();
    expect(Object.getOwnPropertyDescriptor(process, 'stdin')).toEqual(before);
  });
});
