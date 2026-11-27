import { describe, expect, it } from 'vitest';
import { parseStrictJson } from './strict-json.mjs';

describe('strict parent JSON data parsing', () => {
  it.each([
    '{"id":1,"id":2}', '{"id":1,"\\u0069d":2}',
    '{"wrapper":{"requestCount":1,"\\u0072equestCount":2}}',
    '{"requestCount":1e999}', '{"value":-1e999}',
    '{"a":[{"key":1,"k\\u0065y":2}]}',
  ])('refuses ambiguous or non-finite data before comparison: %s', raw => {
    expect(() => parseStrictJson(raw)).toThrow();
  });
  it('accepts ordinary strings, distinct decoded keys and finite exponent numbers', () => {
    expect(parseStrictJson('{"message":"1e999","id":1,"other":2,"finite":1e3}')).toEqual({ message: '1e999', id: 1, other: 2, finite: 1000 });
    expect(parseStrictJson('{"key":"quote\\\" slash\\\\ unicode\\u0061"}')).toEqual({ key: 'quote" slash\\ unicodea' });
  });
  it('keeps API claims as values without creating runtime authority', () => {
    const value = parseStrictJson('{"provenanceKind":"authenticated-github-api","inProcessEvidenceClaim":true}');
    expect(value).toEqual({ provenanceKind: 'authenticated-github-api', inProcessEvidenceClaim: true });
  });
  it('treats prototype-like keys as inert own data properties', () => {
    const value = parseStrictJson('{"__proto__":{"polluted":true},"constructor":1}') as Record<string, unknown>;
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it.each(['', 'undefined', 'NaN', 'Infinity', '01', '+1', '1.', '[1,]', '{"a":1,}', 'true false', '"\\x01"', '"\u0000"', '\ufeff{}'])('refuses malformed JSON grammar: %s', raw => {
    expect(() => parseStrictJson(raw)).toThrow();
  });
  it('decodes bytes with fatal UTF-8 and rejects a byte-order mark', () => {
    expect(parseStrictJson(Buffer.from('{"ok":true}'))).toEqual({ ok: true });
    expect(() => parseStrictJson(Buffer.from([123, 34, 97, 34, 58, 34, 0xff, 34, 125]))).toThrow();
    expect(() => parseStrictJson(Buffer.from([0xef, 0xbb, 0xbf, 123, 125]))).toThrow();
  });
  it('enforces byte, depth, node, decoded string and collection bounds separately', () => {
    expect(() => parseStrictJson('"é"', { maxBytes: 3 })).toThrow();
    expect(() => parseStrictJson('[[[0]]]', { maxDepth: 2 })).toThrow();
    expect(() => parseStrictJson('[0,1]', { maxNodes: 2 })).toThrow();
    expect(() => parseStrictJson('"\\u0061\\u0062"', { maxStringLength: 1 })).toThrow();
    expect(() => parseStrictJson('{"a":1,"b":2}', { maxCollectionEntries: 1 })).toThrow();
    expect(() => parseStrictJson('[]', { maxBytes: 2097153 })).toThrow();
    expect(() => parseStrictJson('[]', { maxDepth: Number.NaN })).toThrow();
    expect(() => parseStrictJson('{}', Object.assign({ maxBytes: 1024 }, { toString: 1 }))).toThrow();
    expect(parseStrictJson('0', { maxBytes: 1 })).toBe(0);
  });
});
