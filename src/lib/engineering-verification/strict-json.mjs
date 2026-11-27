/** Bounded JSON only: decoded duplicate keys and non-finite numbers are refused. */
import { TextDecoder, types } from 'node:util';

const DEFAULTS = Object.freeze({ maxBytes: 2097152, maxDepth: 64, maxNodes: 100000,
  maxStringLength: 262144, maxCollectionEntries: 4096 });

export function parseStrictJson(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !Object.hasOwn(DEFAULTS, key))) throw new Error('Unknown strict JSON bound');
  const bounds = { ...DEFAULTS, ...options };
  if (options.maxStringLength === undefined) bounds.maxStringLength = Math.min(bounds.maxStringLength, bounds.maxBytes);
  for (const [key, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > (key === 'maxStringLength' ? bounds.maxBytes : DEFAULTS[key])) {
      throw new Error('Invalid strict JSON bound');
    }
  }
  let text;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > bounds.maxBytes) throw new Error('JSON bytes exceed bound');
    text = input;
  } else if (types.isUint8Array(input)) {
    if (input.byteLength > bounds.maxBytes) throw new Error('JSON bytes exceed bound');
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } else throw new Error('JSON must be text or UTF-8 bytes');
  let index = 0, nodes = 0;
  const fail = message => { throw new Error('Invalid strict JSON: ' + message); };
  const space = () => { while (index < text.length && /[\x20\t\n\r]/.test(text[index])) index++; };
  const string = () => {
    if (text[index] !== '"') fail('expected string');
    const start = index++;
    let closed = false;
    while (index < text.length) {
      const code = text.charCodeAt(index++);
      if (code === 34) { closed = true; break; }
      if (code < 32) fail('control character in string');
      if (code === 92) {
        const escape = text[index++];
        if (escape === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(text.slice(index, index + 4))) fail('invalid unicode escape');
          index += 4;
        } else if (typeof escape !== 'string' || !'"\\/bfnrt'.includes(escape)) fail('invalid escape');
      }
      if (index - start > bounds.maxBytes) fail('string source exceeds bound');
    }
    if (!closed) fail('unterminated string');
    const value = JSON.parse(text.slice(start, index));
    if (value.length > bounds.maxStringLength) fail('decoded string exceeds bound');
    return value;
  };
  const value = depth => {
    if (depth > bounds.maxDepth || ++nodes > bounds.maxNodes) fail('depth or node bound exceeded');
    space();
    const first = text[index];
    if (first === '"') return string();
    if (first === '{' || first === '[') {
      const object = first === '{', result = object ? {} : [], seen = new Set();
      const close = object ? '}' : ']';
      index++; space();
      if (text[index] === close) { index++; return result; }
      let length = 0;
      while (index < text.length) {
        if (++length > bounds.maxCollectionEntries) fail('collection bound exceeded');
        let key;
        if (object) {
          key = string();
          if (seen.has(key)) fail('duplicate decoded object key');
          seen.add(key); space();
          if (text[index++] !== ':') fail('expected colon');
        }
        const item = value(depth + 1);
        if (object) Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true, writable: true });
        else result.push(item);
        space();
        if (text[index] === close) { index++; return result; }
        if (text[index++] !== ',') fail('expected comma');
        space();
      }
      fail('unterminated collection');
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.slice(index, index + literal.length) === literal) { index += literal.length; return result; }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!number) fail('expected value');
    index += number[0].length;
    const result = Number(number[0]);
    if (!Number.isFinite(result)) fail('non-finite number');
    return result;
  };
  const result = value(0);
  space();
  if (index !== text.length) fail('trailing data');
  return result;
}
