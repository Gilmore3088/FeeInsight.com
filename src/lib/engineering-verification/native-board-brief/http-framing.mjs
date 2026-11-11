/** Incremental observation only: no header/body rewriting or replacement bytes. */
export function createHttpFraming({ direction, limits, requestMethod, onHeaders }) {
  let state = 'headers', line = [], remaining = 0, trailerBytes = 0;
  let wireBytes = 0, bodyBytes = 0, complete = false, error = null;
  const wire = [], body = [];
  const fail = reason => { error ??= reason; complete = false; };
  const entity = bytes => {
    if (!bytes.length) return;
    const admitted = Math.min(bytes.length, limits.maxBodyBytesPerDirection - bodyBytes);
    if (admitted > 0) { body.push(Buffer.from(bytes.subarray(0, admitted))); bodyBytes += admitted; }
    if (admitted !== bytes.length) fail('body_limit');
  };
  const header = bytes => {
    const lines = bytes.toString('latin1').slice(0, -4).split('\r\n');
    const start = lines.shift(), fields = new Map();
    for (const item of lines) {
      const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):([\t\x20-\x7e\x80-\xff]*)$/.exec(item);
      if (!match) return fail('malformed_headers');
      const name = match[1].toLowerCase(), value = match[2].trim();
      if (fields.has(name) && ['content-length', 'transfer-encoding', 'host'].includes(name)) return fail('ambiguous_framing');
      fields.set(name, fields.has(name) ? `${fields.get(name)},${value}` : value);
    }
    let metadata;
    if (direction === 'request') {
      const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+) ([^\x00-\x20\x7f]+) HTTP\/1\.1$/.exec(start ?? '');
      if (!match || !fields.has('host') || !fields.get('host')) return fail('unsupported_protocol');
      if (match[1] === 'CONNECT' || fields.has('upgrade')) return fail('unsupported_protocol');
      metadata = { method: match[1], target: match[2] };
    } else {
      const match = /^HTTP\/1\.1 ([0-9]{3})(?: [\x20-\x7e\x80-\xff]*)?$/.exec(start ?? '');
      if (!match || Number(match[1]) < 200 || Number(match[1]) > 599 || fields.has('upgrade')) return fail('unsupported_protocol');
      metadata = { status: Number(match[1]) };
    }
    const transfer = fields.get('transfer-encoding'), length = fields.get('content-length');
    if (transfer !== undefined && length !== undefined) return fail('ambiguous_framing');
    if (transfer !== undefined && transfer.toLowerCase() !== 'chunked') return fail('unsupported_transfer_encoding');
    if (length !== undefined && !/^(0|[1-9][0-9]*)$/.test(length)) return fail('ambiguous_framing');
    const count = length === undefined ? null : Number(length);
    if (count !== null && (!Number.isSafeInteger(count) || count > limits.maxBodyBytesPerDirection)) return fail('body_limit');
    if (direction === 'response' && (requestMethod() === 'HEAD' || [204, 304].includes(metadata.status))) {
      state = 'done'; complete = true;
    } else if (transfer !== undefined) state = 'chunk_size';
    else if (count !== null) { remaining = count; state = count ? 'fixed' : 'done'; complete = !count; }
    else if (direction === 'request') { state = 'done'; complete = true; }
    else state = 'until_close';
    onHeaders(metadata);
  };
  function lineByte(byte, kind) {
    line.push(byte);
    if (line.length > limits.maxHeaderBytes) return fail(kind === 'headers' ? 'header_limit' : 'chunk_framing_limit');
    if (kind === 'headers') {
      if (line.length >= 4 && line.at(-4) === 13 && line.at(-3) === 10 && line.at(-2) === 13 && line.at(-1) === 10) {
        const bytes = Buffer.from(line); line = []; header(bytes);
      }
      return;
    }
    if (line.length < 2 || line.at(-2) !== 13 || line.at(-1) !== 10) return;
    const bytes = Buffer.from(line); line = [];
    if (kind === 'chunk_size') {
      // RFC 9112 chunk extensions remain on the wire; only their syntax is inspected.
      const text = bytes.toString('latin1').slice(0, -2);
      const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
      const quoted = '"(?:[\\t\\x20-\\x21\\x23-\\x5b\\x5d-\\x7e\\x80-\\xff]|\\\\[\\t\\x20-\\x7e\\x80-\\xff])*"';
      const pattern = new RegExp(`^([0-9A-Fa-f]+)(?:[ \\t]*;[ \\t]*${token}(?:[ \\t]*=[ \\t]*(?:${token}|${quoted}))?)*[ \\t]*$`);
      const match = pattern.exec(text);
      if (!match || match[1].length > 16) return fail('malformed_chunk');
      remaining = Number.parseInt(match[1], 16);
      if (!Number.isSafeInteger(remaining) || remaining > limits.maxBodyBytesPerDirection - bodyBytes) return fail('body_limit');
      state = remaining ? 'chunk_body' : 'trailers';
    } else {
      trailerBytes += bytes.length;
      if (trailerBytes > limits.maxHeaderBytes) return fail('trailer_limit');
      if (bytes.length === 2) { state = 'done'; complete = true; }
      else if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t\x20-\x7e\x80-\xff]*\r\n$/.test(bytes.toString('latin1')) || /^(?:content-length|transfer-encoding|host):/i.test(bytes.toString('latin1'))) fail('malformed_trailer');
    }
  }
  return {
    feed(bytes) {
      if (!Buffer.isBuffer(bytes) || error) return;
      const admitted = Math.min(bytes.length, limits.maxWireBytesPerDirection - wireBytes);
      if (admitted > 0) { wire.push(Buffer.from(bytes.subarray(0, admitted))); wireBytes += admitted; }
      if (admitted !== bytes.length) { fail('wire_limit'); return; }
      let offset = 0;
      while (offset < bytes.length && !error) {
        if (['headers', 'chunk_size', 'trailers'].includes(state)) lineByte(bytes[offset++], state);
        else if (state === 'fixed' || state === 'chunk_body') {
          const count = Math.min(remaining, bytes.length - offset);
          entity(bytes.subarray(offset, offset + count)); offset += count; remaining -= count;
          if (!remaining) {
            if (state === 'fixed') { state = 'done'; complete = true; }
            else { state = 'chunk_cr'; }
          }
        } else if (state === 'chunk_cr') {
          if (bytes[offset++] !== 13) fail('malformed_chunk'); else state = 'chunk_lf';
        } else if (state === 'chunk_lf') {
          if (bytes[offset++] !== 10) fail('malformed_chunk'); else state = 'chunk_size';
        } else if (state === 'until_close') { entity(bytes.subarray(offset)); offset = bytes.length; }
        else { fail('multiple_messages_or_extra_bytes'); }
      }
    },
    eof() {
      if (!error && state === 'until_close') { state = 'done'; complete = true; }
      if (!complete && !error) fail('incomplete_message');
      return !error && complete;
    },
    get error() { return error; },
    get complete() { return complete && !error; },
    get headerRetained() { return line.length; },
    observation() {
      return { wireHex: Buffer.concat(wire, wireBytes).toString('hex'), bodyHex: Buffer.concat(body, bodyBytes).toString('hex'), wireBytes, bodyBytes, framingComplete: complete && !error };
    },
  };
}
